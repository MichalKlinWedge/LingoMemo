-- Powtórka działu: dobrowolny kafelek na końcu działu, do zrobienia ile razy się chce.
--
-- Bierze słówka z CAŁEGO działu, także te, których dziecko nigdy nie powtarzało — po to jest
-- (`…_unit_practice.sql`). Otwiera się razem z testem działu, czyli po komplecie lekcji,
-- a sama niczego nie otwiera: następny dział nadal czeka na zdany test.

begin;
select plan(12);

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

create temporary table t_next as
  select u.id from public.units u
  join public.courses c on c.id = u.course_id
  where c.slug = 'pl-en-starter' and u.sort_order = 2;

-- Powtórka DZIAŁU, nie test powtórkowy kursu: ten drugi też ma `kind = 'review'`, ale wiesza się
-- na kursie (`review_scope_course_id`) i rządzi się kolejką zaległych.
create temporary table t_review as
  select l.id from public.lessons l
  where l.kind = 'review' and l.review_scope_unit_id = (select id from t_unit);

create temporary table t_first as
  select l.id from public.lessons l
  where l.unit_id = (select id from t_unit) and l.kind = 'standard' and l.sort_order = 1;

-- Ile słówek ma cały dział — tyle zadań powinna wydać powtórka, dopóki mieści się w limicie.
create temporary table t_words as
  select count(distinct li.concept_id)::integer as n
    from public.lesson_items li
    join public.lessons l on l.id = li.lesson_id
   where l.unit_id = (select id from t_unit);

-- Nauka wymaga zapisu na kurs (`…_course_access_request.sql`), więc dziecko z tego pliku
-- musi go mieć — bez zapisu lekcja jest zamknięta, zanim zacznie się to, co sprawdzamy.
insert into public.enrollments (user_id, course_id)
select (select id from t_user), u.course_id
  from public.lessons l
  join public.units u on u.id = l.unit_id
 where l.id = (select id from t_review)
on conflict do nothing;

grant select on t_user, t_unit, t_next, t_review, t_first, t_words to authenticated;

select is((select count(*)::integer from t_review), 1, 'dział ma jedną powtórkę, założoną wyzwalaczem');

-- --- pierwsza lekcja zaliczona, reszta działu jeszcze nie ---
insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars)
values ((select id from t_user), (select id from t_first), 'completed', 1.0, 3);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select is_unlocked from public.v_my_lessons where id = (select id from t_review)),
  false,
  'jedna zaliczona lekcja to za mało — powtórka czeka na komplet, tak jak test działu'
);

select throws_ok(
  'select public.get_lesson_exercises((select id from t_review))',
  '42501',
  null,
  'zamkniętej powtórki nie da się otworzyć'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

-- --- cały dział zaliczony, ani jednego słówka w kolejce powtórek ---
--
-- `srs_state` zostaje puste celowo: powtórka ma działać także tuż po przerobieniu działu, gdy
-- zaległych nie ma jeszcze wcale. Wcześniejsza wersja brała słówka wyłącznie stamtąd i wydawała
-- wtedy pustą lekcję.
insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars)
select (select id from t_user), l.id, 'completed', 1.0, 3
  from public.lessons l
 where l.unit_id = (select id from t_unit) and l.kind = 'standard'
on conflict (user_id, lesson_id) do nothing;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select is_unlocked from public.v_my_lessons where id = (select id from t_review)),
  true,
  'po komplecie lekcji działu powtórka się otwiera'
);

select is(
  (select count(*)::integer from public.get_lesson_exercises((select id from t_review))),
  (select n from t_words),
  'powtórka bierze słówka z całego działu, także te nigdy nie powtarzane'
);

select cmp_ok(
  (select count(*)::integer from public.get_lesson_exercises((select id from t_review))),
  '<=',
  public.unit_practice_limit(),
  'powtórka nie przekracza swojego limitu zadań'
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
           when 'listen_match'      then jsonb_build_object('pairs', ex.payload -> 'pairs')
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
  (select n from t_words),
  'sesja powtórki zna liczbę swoich zadań'
);

-- --- drugie podejście: powtórkę wolno robić wielokrotnie ---
select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars)
values ((select id from t_user), (select id from t_review), 'completed', 1.0, 3)
on conflict (user_id, lesson_id) do update set status = 'completed';

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

-- Sesję zakładamy osobnym poleceniem: `start_lesson_session` dopisuje wiersz, a zapytanie,
-- które ją woła w swoim własnym `where`, tego wiersza jeszcze nie widzi.
create temporary table t_sess2 as
  select public.start_lesson_session((select id from t_review), 'powtorka-2') as id;

select is(
  (select total_exercises from public.lesson_sessions where id = (select id from t_sess2)),
  (select n from t_words),
  'zrobiona powtórka otwiera się po raz drugi z pełnym zestawem'
);

-- Powtórka jest dobrowolna: zaliczona nie zastępuje testu, więc następny dział nadal czeka.
select is(
  public.is_unit_unlocked((select id from t_next), (select id from t_user)),
  false,
  'zrobiona powtórka nie otwiera następnego działu — to robi dopiero zdany test działu'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
