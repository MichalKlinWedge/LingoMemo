-- Łatwy wariant zdania: rozsypanka z dystraktorami.
--
-- Zadanie „wpisz całe zdanie" jest dla dziecka na poziomie 1 nie do zrobienia, więc do każdego
-- takiego zadania dorabia się rozsypanka: te same słowa jako klocki plus kilka niepasujących.
-- Sprawdzamy, że powstaje sama, że jest zadaniem na klikanie i że da się ją zaliczyć.

begin;
select plan(11);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-zdania@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-zdania@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-zdania', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

grant select on t_ids, t_ctx to authenticated;

-- Trzy słówka działu: z nich wezmą się dystraktory.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lesson_id from t_ctx), 'school.book', 'książka', 'book');
select public.admin_add_word((select lesson_id from t_ctx), 'school.pen', 'długopis', 'pen');
select public.admin_add_word((select lesson_id from t_ctx), 'school.bag', 'plecak', 'bag');

reset role;

-- Zdanie do wpisania. Wyzwalacz ma dorobić do niego rozsypankę.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select lesson_id, 'translate_ab', 100,
       jsonb_build_object('prompt', 'Otwórz książki.',
                          'accepted', jsonb_build_array('Open your books.')),
       10
  from t_ctx;

create temporary table t_uklad as
  select id, payload, level from public.exercises
   where lesson_id = (select lesson_id from t_ctx) and type = 'sentence_order';
grant select on t_uklad to authenticated;

select is((select count(*)::integer from t_uklad), 1,
          'zdanie do wpisania dostaje swoją rozsypankę');

select is((select level from t_uklad), 1::smallint,
          'rozsypanka to zadanie na klikanie, czyli poziom pierwszy');

select is((select payload -> 'solution' from t_uklad),
          jsonb_build_array('Open', 'your', 'books.'),
          'rozwiązaniem jest zdanie podzielone na słowa');

select ok(
  (select jsonb_array_length(payload -> 'tokens') from t_uklad)
    > (select jsonb_array_length(payload -> 'solution') from t_uklad),
  'klocków jest więcej niż słów w zdaniu — to są dystraktory');

select is(
  (select count(*)::integer
     from jsonb_array_elements_text((select payload -> 'tokens' from t_uklad)) tk
    where tk not in ('Open', 'your', 'books.')
      and tk not in (select t.text from public.terms t where t.lang = 'en' and t.is_primary)),
  0,
  'dystraktory to słowa z tego samego działu, a nie przypadkowe ciągi znaków');

select is(public.build_sentence_order((select lesson_id from t_ctx)), 0,
          'drugi przebieg nie dokłada rozsypanki po raz drugi');

-- Walidacja: zdania musi dać się ułożyć z klocków, które dostaje dziecko.
select throws_ok(
  format($q$
    insert into public.exercises (lesson_id, type, sort_order, payload, points)
    values (%L, 'sentence_order', 200,
            jsonb_build_object('tokens', jsonb_build_array('Open', 'your', 'pen'),
                               'solution', jsonb_build_array('Open', 'your', 'books.')), 10)
  $q$, (select lesson_id from t_ctx)),
  '23514',
  null,
  'rozsypanka bez jednego ze słów zdania nie przechodzi walidacji');

-- --- jako uczeń na poziomie 1 ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select ok(
  (select id from t_uklad) in (
    select exercise_id from public.visible_exercises(
      (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  'na poziomie pierwszym dziecko dostaje rozsypankę zamiast wpisywania zdania');

create temporary table t_sesja as
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'test-zdania-1') as id;

select is(
  (select public.submit_attempt(
            (select id from t_sesja),
            (select id from t_uklad),
            jsonb_build_object('tokens', jsonb_build_array('Open', 'your', 'books.'))) ->> 'correct'),
  'true',
  'ułożone zdanie jest zaliczone, choć część klocków została nieużyta');

-- --- ten sam materiał, ale dziecko z sufitem 3 ---
reset role;
update public.profiles set level = 3 where id = (select id from t_ids where name = 'uczen');

create temporary table t_pisanie as
  select id from public.exercises
   where lesson_id = (select lesson_id from t_ctx) and type = 'translate_ab' and sort_order = 100;

select ok(
  (select id from t_pisanie) in (
    select exercise_id from public.visible_exercises(
      (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  'na poziomie trzecim dziecko dostaje zdanie do wpisania');

select ok(
  (select id from t_uklad) not in (
    select exercise_id from public.visible_exercises(
      (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  'łatwa wersja ustępuje oryginałowi, więc zdania nie robi się dwa razy');

select * from finish();
rollback;
