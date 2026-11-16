-- Statystyki panelu: widoki `v_stats_*`.
--
-- Najważniejsza własność tych widoków nie jest arytmetyczna, tylko dostępowa: to JEDEN zestaw
-- widoków dla wszystkich, a zakres robi RLS. Administrator ma w nich całość, dziecko wyłącznie
-- siebie. Gdyby `security_invoker` kiedyś z nich zniknęło, dziecko zobaczyłoby w swojej
-- przeglądarce liczby wszystkich innych dzieci — i właśnie to sprawdza ten plik.

begin;
select plan(9);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-staty@test.local'));
insert into t_ids values ('zosia', pg_temp.make_user('zosia-staty@test.local'));
insert into t_ids values ('janek', pg_temp.make_user('janek-staty@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-staty', 'pl', 'en', 'Kurs statystyczny', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

insert into public.enrollments (user_id, course_id)
select id, (select course_id from t_ctx) from t_ids where name in ('zosia', 'janek');

grant select on t_ids, t_ctx to authenticated;

-- --- jako administrator: słówko w lekcji ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');

reset role;

create temporary table t_slowko as
  select li.concept_id as id from public.lesson_items li where li.lesson_id = (select lesson_id from t_ctx);
grant select on t_slowko to authenticated;

-- Historia nauki wprost do tabel: ten plik sprawdza widoki, a nie drogę, którą dane tam trafiły.
-- Sesja musi być prawdziwa, bo `attempts.session_id` jest obowiązkowe.
create temporary table t_sesje as
with w as (
  insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises, stage_nr)
  select t.id, (select lesson_id from t_ctx), 'staty-' || t.name, 3, 1
  from t_ids t where t.name in ('zosia', 'janek')
  returning user_id, id
)
select * from w;

insert into public.attempts (session_id, user_id, exercise_id, concept_id, exercise_type, is_correct, raw_answer)
select ses.id, ses.user_id, e.id, e.concept_id, e.type, g.poprawna, '{}'::jsonb
from t_sesje ses
join public.exercises e on e.lesson_id = (select lesson_id from t_ctx) and e.type = 'translate_ba'
join (values (true), (true), (false)) as g(poprawna) on true;

insert into public.srs_state (user_id, concept_id, course_id, stability, lapses, reps)
select t.id, (select id from t_slowko), (select course_id from t_ctx), 30, 2, 3
from t_ids t where t.name in ('zosia', 'janek');

insert into public.lesson_progress (user_id, lesson_id, status, best_score, last_score, stars, attempts_count, completed_at)
select t.id, (select lesson_id from t_ctx), 'completed', 1, 1, 3, 1, now()
from t_ids t where t.name = 'zosia';

-- --- jako administrator: całość ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select is((select learners::integer from public.v_stats_summary), 2,
          'administrator widzi oboje zapisanych');
select is((select answers::integer from public.v_stats_summary), 6,
          'odpowiedzi liczone ze wszystkich dzieci');
select is((select answers_correct::integer from public.v_stats_summary), 4,
          'trafione liczone osobno od wszystkich');
select is((select words_mastered::integer from public.v_stats_summary), 2,
          'umiane słówko liczy się każdemu dziecku z osobna');

select is((select learners::integer from public.v_stats_courses where course_title = 'Kurs statystyczny'), 2,
          'kurs pokazuje liczbę zapisanych dzieci');
select is((select lessons_done::integer from public.v_stats_courses where course_title = 'Kurs statystyczny'), 1,
          'kurs pokazuje zaliczone lekcje wszystkich dzieci razem');

select is((select lapses::integer from public.v_stats_hard_words where concept_id = (select id from t_slowko)), 4,
          'pomyłki na słówku sumują się po dzieciach');

select is(
  (select correct::integer from public.v_stats_exercise_types where exercise_type = 'translate_ba'),
  4,
  'celność liczona po typie zadania'
);

reset role;

-- --- jako dziecko: tylko swoje ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'zosia')), true);

select is((select answers::integer from public.v_stats_summary), 3,
          'dziecko widzi w tych samych widokach wyłącznie swoje odpowiedzi');

reset role;

select * from finish();
rollback;
