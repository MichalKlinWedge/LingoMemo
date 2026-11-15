-- Import lekcji z JSON-a: kto może, co powstaje i co się dzieje przy ponownym wklejeniu.

begin;
select plan(14);

create or replace function pg_temp.make_user(p_email text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'test-nie-do-logowania', now(), '{}'::jsonb,
    jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create or replace function pg_temp.lekcja(p_slug text, p_title text, p_exercises jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'course', 'pl-en-starter',
    'unit', jsonb_build_object('slug', 'importowany', 'title', 'Importowany dział', 'sortOrder', 9),
    'lesson', jsonb_build_object('slug', p_slug, 'title', p_title, 'sortOrder', 1,
                                 'xpReward', 40, 'passThreshold', 0.75, 'isPublished', true),
    'concepts', jsonb_build_array(
      jsonb_build_object('key', 'food.apple', 'tags', jsonb_build_array('🍎'),
        'terms', jsonb_build_object(
          'pl', jsonb_build_array(jsonb_build_object('text', 'jabłko', 'pos', 'noun')),
          'en', jsonb_build_array(jsonb_build_object('text', 'apple', 'pos', 'noun',
                  'forms', jsonb_build_array(jsonb_build_object('label', 'plural', 'text', 'apples')))))),
      jsonb_build_object('key', 'food.bread',
        'terms', jsonb_build_object(
          'pl', jsonb_build_array(jsonb_build_object('text', 'chleb')),
          'en', jsonb_build_array(jsonb_build_object('text', 'bread'))))),
    'exercises', p_exercises);
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-import@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-import@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
grant select on t_ids to authenticated;

-- --- uczeń nie importuje ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  'select public.admin_import_lesson(''{}''::jsonb)',
  '42501',
  null,
  'uczeń nie zaimportuje lekcji'
);

select set_config('role', 'postgres', true);
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

-- --- odporność na byle co ---
select throws_ok(
  'select public.admin_import_lesson(jsonb_build_object(''schemaVersion'', 99))',
  '22023',
  null,
  'nieznana wersja formatu jest odrzucana'
);

select throws_ok(
  $$select public.admin_import_lesson(jsonb_set(pg_temp.lekcja('x','X','[]'::jsonb), '{course}', '"nie-ma-takiego"'))$$,
  '22023',
  null,
  'import do nieistniejącego kursu jest odrzucany'
);

-- --- właściwy import ---
create temporary table t_run as
  select public.admin_import_lesson(pg_temp.lekcja('jedzenie', 'Jedzenie', jsonb_build_array(
    jsonb_build_object('type', 'translate_ab', 'conceptKey', 'food.apple', 'points', 10,
      'payload', jsonb_build_object('prompt', 'jabłko', 'accepted', jsonb_build_array('apple'))),
    jsonb_build_object('type', 'translate_ba', 'conceptKey', 'food.bread',
      'payload', jsonb_build_object('prompt', 'bread', 'accepted', jsonb_build_array('chleb')))
  ))) as report;
grant select on t_run to authenticated;

select is((select (report ->> 'concepts')::integer from t_run), 2, 'zaimportowano oba słówka');
select is((select (report ->> 'terms')::integer from t_run), 4, 'zaimportowano zapis w obu językach');
select is((select (report ->> 'exercises')::integer from t_run), 2, 'zaimportowano oba zadania');

select is(
  (select title from public.lessons where id = (select (report ->> 'lessonId')::uuid from t_run)),
  'Jedzenie',
  'lekcja ma tytuł z pliku'
);

select is(
  (select count(*)::integer from public.term_forms tf
    join public.terms t on t.id = tf.term_id
    join public.concepts c on c.id = t.concept_id
   where c.key = 'food.apple' and tf.form_label = 'plural'),
  1,
  'odmiany słowa też wchodzą'
);

select is(
  (select count(*)::integer from public.lesson_items
    where lesson_id = (select (report ->> 'lessonId')::uuid from t_run)),
  2,
  'słówka są przypisane do lekcji'
);

-- --- ponowny import tego samego pliku ---
create temporary table t_again as
  select public.admin_import_lesson(pg_temp.lekcja('jedzenie', 'Jedzenie po poprawce', jsonb_build_array(
    jsonb_build_object('type', 'translate_ab', 'conceptKey', 'food.apple',
      'payload', jsonb_build_object('prompt', 'jabłko', 'accepted', jsonb_build_array('apple')))
  ))) as report;
grant select on t_again to authenticated;

select is(
  (select (report ->> 'lessonId') from t_again),
  (select (report ->> 'lessonId') from t_run),
  'ponowny import trafia w tę samą lekcję, nie zakłada drugiej'
);

select is(
  (select title from public.lessons where id = (select (report ->> 'lessonId')::uuid from t_again)),
  'Jedzenie po poprawce',
  'ponowny import aktualizuje tytuł'
);

select is(
  (select count(*)::integer from public.exercises
    where lesson_id = (select (report ->> 'lessonId')::uuid from t_again)),
  1,
  'zadania są wymieniane w całości, a nie dokładane'
);

select is(
  (select count(*)::integer from public.concepts where key = 'food.apple'),
  1,
  'słówko nie jest dublowane przy ponownym imporcie'
);

-- Zapis słowa wymieniany w całości: poprawiona literówka nie zostaje jako „synonim”.
select is(
  (select count(*)::integer from public.terms t
    join public.concepts c on c.id = t.concept_id
   where c.key = 'food.apple'),
  2,
  'po ponownym imporcie słówko ma dokładnie dwa zapisy, po jednym na język'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
