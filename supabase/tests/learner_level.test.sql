-- Poziom trudności: co dziecko dostaje do zrobienia.
--
-- Dwa niezależne ograniczenia: sufit konta (`profiles.level`, ustawia rodzic) i rampa słówka
-- (stabilność z FSRS). Dziecko widzi zadania o poziomie nie wyższym niż minimum z tych dwóch,
-- a słówko, dla którego nic się nie zmieściło, i tak dostaje swoje najłatwiejsze zadanie.

begin;
select plan(16);

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

-- --- 1. Domyślny poziom z typu i treści zadania ---

select is(public.default_exercise_level('image_choice', '{}'::jsonb), 1::smallint,
          'wskazanie obrazka to klikanie');

select is(
  public.default_exercise_level('translate_ab',
    jsonb_build_object('prompt', 'kot', 'accepted', jsonb_build_array('cat'),
                       'options', jsonb_build_array('cat', 'dog'))),
  1::smallint,
  'tłumaczenie z gotowymi kafelkami to klikanie');

select is(public.default_exercise_level('sentence_order',
            jsonb_build_object('tokens', jsonb_build_array('a', 'b'))),
          2::smallint,
          'układanie zdania z kafelków jest trudniejsze niż wskazanie');

select is(
  public.default_exercise_level('translate_ba',
    jsonb_build_object('prompt', 'cat', 'accepted', jsonb_build_array('kot'))),
  2::smallint,
  'wpisanie jednego słowa to poziom drugi');

select is(
  public.default_exercise_level('translate_ab',
    jsonb_build_object('prompt', 'mam kota', 'accepted', jsonb_build_array('i have a cat'))),
  3::smallint,
  'wpisanie całego zdania to poziom trzeci');

select is(
  public.default_exercise_level('listening',
    jsonb_build_object('speak', 'cat', 'lang', 'en-GB', 'accepted', jsonb_build_array('cat'))),
  3::smallint,
  'pisanie ze słuchu to poziom trzeci');

-- --- 2. Dane do reszty testu: kurs, lekcja, słówko i komplet zadań ---

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-poziom@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-poziom@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-poziomy', 'pl', 'en', 'Kurs testowy', true) returning id
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

-- Jedno słówko: `admin_add_word` robi do niego tłumaczenie w obie strony (wpisywanie, bo nie ma
-- z czego ułożyć kafelków) i zadanie ze słuchu.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');

reset role;

create temporary table t_concept as
  select distinct concept_id as id from public.exercises
   where lesson_id = (select lesson_id from t_ctx) and concept_id is not null;
grant select on t_concept to authenticated;

-- Zadanie na klikanie dokładamy ręcznie: wygenerowane zadania są wszystkie na wpisywanie.
insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
values (
  (select lesson_id from t_ctx), 'image_choice', 50, (select id from t_concept),
  jsonb_build_object('prompt', 'jabłko',
                     'options', jsonb_build_array('2026/jablko.png', '2026/gruszka.png'),
                     'answer', '2026/jablko.png'),
  10
);

select is(
  (select level from public.exercises
    where lesson_id = (select lesson_id from t_ctx) and type = 'image_choice'),
  1::smallint,
  'wyzwalacz nadaje poziom zadaniu wstawionemu bez podanego poziomu');

insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points, level)
values (
  (select lesson_id from t_ctx), 'image_choice', 51, (select id from t_concept),
  jsonb_build_object('prompt', 'jabłko',
                     'options', jsonb_build_array('2026/jablko.png', '2026/sliwka.png'),
                     'answer', '2026/jablko.png'),
  10, 3
);

select is(
  (select level from public.exercises
    where lesson_id = (select lesson_id from t_ctx) and sort_order = 51),
  3::smallint,
  'poziom podany wprost zostaje — administrator wie lepiej niż reguła');

-- --- 3. Dobór zadań ---

select is(
  (select count(*)::integer from public.visible_exercises(
     (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  1,
  'na poziomie pierwszym zostaje samo klikanie');

-- Sufit w górę, ale słówko jest wciąż nowe — rampa trzyma zadania przy ziemi.
select public.set_learner_level((select id from t_ids where name = 'uczen'), 3::smallint);

select is(
  (select count(*)::integer from public.visible_exercises(
     (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  1,
  'sam sufit nie otwiera trudniejszych zadań przy świeżym słówku');

-- Słówko rozpoznawane: stabilność między progiem „rozpoznaję" a „umiem".
insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, reps)
values ((select id from t_ids where name = 'uczen'), (select id from t_concept),
        (select course_id from t_ctx), 10, 5, current_date + 365, 3);

select is(
  (select count(*)::integer from public.visible_exercises(
     (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  3,
  'rozpoznawane słówko dokłada wpisywanie pojedynczych słów');

update public.srs_state set stability = 60
 where user_id = (select id from t_ids where name = 'uczen');

select is(
  (select count(*)::integer from public.visible_exercises(
     (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  5,
  'umiane słówko dostaje komplet zadań razem z pisaniem ze słuchu');

-- Zasada ratunkowa: słówko, dla którego nic się nie mieści, i tak wchodzi do lekcji.
delete from public.exercises
 where lesson_id = (select lesson_id from t_ctx) and level = 1;
delete from public.srs_state where user_id = (select id from t_ids where name = 'uczen');
select public.set_learner_level((select id from t_ids where name = 'uczen'), 1::smallint);

select is(
  (select count(*)::integer from public.visible_exercises(
     (select lesson_id from t_ctx), (select id from t_ids where name = 'uczen'))),
  1,
  'słówko bez zadania w poziomie dostaje swoje najłatwiejsze, a nie znika z lekcji');

-- --- 4. Kto może zmieniać poziom ---

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('update public.profiles set level = 3 where id = %L', (select id from t_ids where name = 'uczen')),
  '42501',
  null,
  'uczeń nie podniesie sobie poziomu — kolumny nie ma w grant update');

select throws_ok(
  format('select public.set_learner_level(%L, 3::smallint)', (select id from t_ids where name = 'uczen')),
  null,
  null,
  'uczeń nie wywoła funkcji od ustawiania poziomu');

reset role;

select is(
  (select level from public.profiles where id = (select id from t_ids where name = 'uczen')),
  1::smallint,
  'po próbach ucznia poziom został taki, jaki ustawił rodzic');

select * from finish();
rollback;
