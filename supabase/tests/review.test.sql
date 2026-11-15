-- Lekcje powtórkowe: co się w nich pojawia i kiedy w ogóle są dostępne.
--
-- Powtórka ma pokazywać słówka zaległe według FSRS i te, na których dziecko się myli — a nie
-- losowy zestaw z całego działu.

begin;
select plan(10);

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
    jsonb_build_object('display_name', 'zosia'), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_user as select pg_temp.make_user('zosia-powtorka@test.local') as id;

create temporary table t_unit as
  select u.id from public.units u
  join public.courses c on c.id = u.course_id
  where c.slug = 'pl-en-starter' and u.sort_order = 1;

create temporary table t_review as
  select l.id from public.lessons l
  where l.kind = 'review' and l.review_scope_unit_id = (select id from t_unit);

create temporary table t_first as
  select l.id from public.lessons l
  where l.unit_id = (select id from t_unit) and l.kind = 'standard' and l.sort_order = 1;

grant select on t_user, t_unit, t_review, t_first to authenticated;

select is((select count(*)::integer from t_review), 1, 'dział ma jedną lekcję powtórkową');

-- --- zanim cokolwiek zaliczono ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select is_unlocked from public.v_my_lessons where id = (select id from t_review)),
  false,
  'powtórka jest zamknięta, dopóki w dziale nic nie jest zaliczone'
);

select throws_ok(
  'select public.get_lesson_exercises((select id from t_review))',
  '42501',
  null,
  'zamkniętej powtórki nie da się otworzyć'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

-- --- pierwsza lekcja zaliczona, dwa słówka zaległe, jedno na przyszłość ---
insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars)
values ((select id from t_user), (select id from t_first), 'completed', 1.0, 3);

create temporary table t_concepts as
  select li.concept_id, row_number() over (order by li.sort_order) as nr
  from public.lesson_items li where li.lesson_id = (select id from t_first);

insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, lapses, reps)
select (select id from t_user), c.concept_id,
       (select id from public.courses where slug = 'pl-en-starter'),
       5, 5,
       case when c.nr <= 2 then current_date - 1 else current_date + 30 end,
       case when c.nr = 1 then 4 else 0 end,
       3
from t_concepts c;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select is_unlocked from public.v_my_lessons where id = (select id from t_review)),
  true,
  'po zaliczeniu lekcji powtórka się otwiera'
);

select is(
  (select count(*)::integer from public.get_lesson_exercises((select id from t_review))),
  4,
  'powtórka bierze wszystkie przerobione słówka działu'
);

-- Najpierw zaległe: dwa pierwsze zadania dotyczą słówek z terminem w przeszłości.
select is(
  (select count(*)::integer
     from (select concept_id from public.get_lesson_exercises((select id from t_review))
            order by sort_order limit 2) g
     join public.srs_state s on s.concept_id = g.concept_id and s.user_id = (select id from t_user)
    where s.due_on <= current_date),
  2,
  'zaległe słówka idą na początek powtórki'
);

select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select id from t_review)) g
    where g.payload ? 'accepted' or g.payload ? 'answer' or g.payload ? 'solution'),
  0,
  'powtórka też nie zdradza poprawnych odpowiedzi'
);

select is(
  (select count(distinct concept_id)::integer from public.get_lesson_exercises((select id from t_review))),
  (select count(*)::integer from public.get_lesson_exercises((select id from t_review))),
  'każde słówko pojawia się w powtórce najwyżej raz'
);

-- --- odpowiedź w powtórce przechodzi, choć zadanie pochodzi z innej lekcji ---
create temporary table t_sess as
  select public.start_lesson_session((select id from t_review), 'powtorka-1') as id;
grant select on t_sess to authenticated;

select set_config('role', 'postgres', true);

-- Zadanie i oczekiwaną odpowiedź wybieramy jako postgres: uczeń nie ma wglądu w `exercises`,
-- i właśnie o to chodzi.
--
-- Typ zadania w powtórce jest losowany, więc NIE wolno filtrować po typie — test padałby raz na
-- kilka uruchomień bez żadnej zmiany w kodzie. Bierzemy pierwsze z brzegu i układamy odpowiedź
-- pasującą do jego typu.
create temporary table t_pick as
  select ex.id,
         case ex.type
           when 'translate_ab'      then jsonb_build_object('choice', ex.payload -> 'accepted' ->> 0)
           when 'fill_blank_choice' then jsonb_build_object('choice', ex.payload ->> 'answer')
           when 'match_pairs'       then jsonb_build_object('pairs', ex.payload -> 'pairs')
           when 'sentence_order'    then jsonb_build_object('tokens', ex.payload -> 'solution')
           else jsonb_build_object('text', ex.payload -> 'accepted' ->> 0)
         end as answer
  from public.pick_review_exercises((select id from t_review), (select id from t_user)) r
  join public.exercises ex on ex.id = r.exercise_id
  limit 1;
grant select on t_pick to authenticated;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select (public.submit_attempt(
      (select id from t_sess),
      (select id from t_pick),
      (select answer from t_pick),
      3000, false) ->> 'correct')::boolean),
  true,
  'odpowiedź w powtórce jest przyjmowana, mimo że zadanie należy do innej lekcji'
);

select is(
  (select total_exercises from public.lesson_sessions where id = (select id from t_sess)),
  4,
  'sesja powtórki zna liczbę swoich zadań'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
