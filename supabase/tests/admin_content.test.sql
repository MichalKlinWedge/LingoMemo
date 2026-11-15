-- Panel treści: dodawanie słówek z zadaniami i zapisy na kurs robione przez administratora.
--
-- Kursy, działy i lekcje idą zwykłymi zapytaniami pod politykami `*_admin`, więc tutaj
-- sprawdzamy to, co ma własną funkcję albo własną politykę.

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

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-content@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-content@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Pusta lekcja w nowym dziale: dodawanie słówek nie miesza się z treścią z seeda.
create temporary table t_ctx as
select c.id as course_id from public.courses c where c.slug = 'pl-en-starter';

with u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select course_id, 'test-owoce', 'Owoce (test)', 50, true from t_ctx
  returning id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, 'test-lekcja', 'Lekcja testowa', 1, true from u;

create temporary table t_lesson as
select l.id from public.lessons l
  join public.units un on un.id = l.unit_id
 where un.slug = 'test-owoce' and l.slug = 'test-lekcja';

grant select on t_ids, t_ctx, t_lesson to authenticated;

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_add_word(%L, ''food.apple'', ''jabłko'', ''apple'')', (select id from t_lesson)),
  '42501',
  null,
  'uczeń nie doda słówka'
);

select throws_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'admin'), (select course_id from t_ctx)),
  '42501',
  null,
  'uczeń nie zapisze na kurs kogoś innego'
);

select lives_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'uczen'), (select course_id from t_ctx)),
  'uczeń zapisuje na kurs sam siebie'
);

reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  format('select public.admin_add_word(%L, ''Food Apple'', ''jabłko'', ''apple'')', (select id from t_lesson)),
  '22023',
  null,
  'klucz z wielkimi literami i spacją nie przechodzi'
);

select throws_ok(
  format('select public.admin_add_word(%L, ''food.apple'', ''jabłko'', ''  '')', (select id from t_lesson)),
  '22023',
  null,
  'puste słowo w drugim języku nie przechodzi'
);

select throws_ok(
  'select public.admin_add_word(''00000000-0000-0000-0000-000000000009''::uuid, ''food.apple'', ''jabłko'', ''apple'')',
  '22023',
  null,
  'nie da się dodać słówka do nieistniejącej lekcji'
);

select is(
  (select (public.admin_add_word((select id from t_lesson), 'food.apple', 'jabłko', 'apple') ->> 'exercises')::integer),
  3,
  'słówko wchodzi razem z trzema zadaniami'
);

-- Administrator wypisuje i zapisuje innych.
select lives_ok(
  format('delete from public.enrollments where user_id = %L', (select id from t_ids where name = 'uczen')),
  'administrator wypisuje ucznia z kursu'
);

select lives_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'uczen'), (select course_id from t_ctx)),
  'administrator zapisuje ucznia na kurs'
);

reset role;

-- --- co powstało ---
select is(
  (select count(*)::integer from public.terms t
     join public.concepts c on c.id = t.concept_id
    where c.key = 'food.apple' and t.text in ('jabłko', 'apple')),
  2,
  'powstały terminy w obu językach kursu'
);

select is(
  (select count(*)::integer from public.lesson_items li where li.lesson_id = (select id from t_lesson)),
  1,
  'słówko jest przypięte do lekcji'
);

select is(
  (select array_agg(e.type::text order by e.sort_order)
     from public.exercises e where e.lesson_id = (select id from t_lesson)),
  array['translate_ab', 'translate_ba', 'listening'],
  'zadania to tłumaczenie w obie strony i ze słuchu'
);

select is(
  (select e.payload ->> 'lang' from public.exercises e
    where e.lesson_id = (select id from t_lesson) and e.type = 'listening'),
  'en-GB',
  'zadanie ze słuchu bierze język z tabeli języków'
);

-- Drugie wywołanie z tym samym kluczem: aktualizacja, nie duplikat.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);
select public.admin_add_word((select id from t_lesson), 'food.apple', 'jabłuszko', 'apple');
reset role;

select is(
  (select count(*)::integer from public.exercises e where e.lesson_id = (select id from t_lesson)),
  3,
  'powtórne dodanie tego samego słówka nie dubluje zadań'
);

select * from finish();
rollback;
