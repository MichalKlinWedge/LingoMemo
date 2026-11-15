-- Etapy lekcji: podział zadań, szczelność etapu i zaliczanie całej lekcji.
--
-- Lekcja testowa ma 36 zadań, czyli trzy etapy po 12. Sprawdzamy to, co dla dziecka jest
-- widoczne: że dostaje krótki kawałek zamiast wszystkiego naraz, że nie da się odpowiedzieć
-- na zadanie z dalszego etapu i że lekcja zapala się na zielono dopiero po ostatnim etapie.

begin;
select plan(19);

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
    p_email, 'test-nie-do-logowania',
    now(), '{}'::jsonb, jsonb_build_object('display_name', 'zosia'), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_user as select pg_temp.make_user('zosia-etapy@test.local') as id;
create temporary table t_lesson (id uuid);

-- Lekcja bez warunku wstępnego, za to z kompletem 36 zadań.
do $setup$
declare
  v_course uuid;
  v_unit   uuid;
  v_lesson uuid;
  i        integer;
begin
  select c.id into v_course from public.courses c where c.slug = 'pl-en-starter';

  -- Dział na samym początku kursu (`sort_order` 0), bo dalsze działy czekają na zdany test
  -- działu wcześniejszego, a ten plik sprawdza etapy, nie zamki. Własnych słówek dział nie
  -- ma — same zadania bez `concept_id` — więc sam testu nie dostaje i niczego nie blokuje.
  insert into public.units (course_id, slug, title, sort_order, is_published)
  values (v_course, 'etapy-test', 'Etapy', 0, true)
  returning id into v_unit;

  insert into public.lessons (unit_id, slug, title, kind, sort_order, is_published, xp_reward, pass_threshold)
  values (v_unit, 'dluga', 'Długa lekcja', 'standard', 1, true, 50, 0.8)
  returning id into v_lesson;

  insert into t_lesson values (v_lesson);

  for i in 1..36 loop
    insert into public.exercises (lesson_id, type, sort_order, payload, points)
    values (
      v_lesson, 'translate_ba', i,
      jsonb_build_object('prompt', 'word' || i, 'accepted', jsonb_build_array('slowo' || i)), 10
    );
  end loop;
end;
$setup$;

create temporary table t_ex as
  select ex.id, ex.sort_order, ex.payload,
         public.exercise_stage(ex.id, (select id from t_lesson)) as stage
  from public.exercises ex
  where ex.lesson_id = (select id from t_lesson);

create temporary table t_sess (stage integer primary key, id uuid);
create temporary table t_fin (stage integer primary key, result jsonb);

grant select on t_user, t_lesson, t_ex to authenticated;
grant select, insert on t_sess, t_fin to authenticated;

-- --- podział liczony w bazie ---
select is(
  public.lesson_stage_count((select id from t_lesson), (select id from t_user)),
  3,
  '36 zadań to trzy etapy'
);

select is(
  (select max(c)::integer from (select count(*) as c from t_ex group by stage) x),
  12,
  'najdłuższy etap ma 12 zadań, czyli mieści się w limicie 15'
);

select is(
  (select min(c)::integer from (select count(*) as c from t_ex group by stage) x),
  12,
  'etapy są równe — nie ma ogona z jednym zadaniem'
);

select is(
  (select count(distinct stage)::integer from t_ex),
  3,
  'każde zadanie trafiło do jednego z trzech etapów'
);

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select count(*)::integer from public.get_lesson_exercises((select id from t_lesson), 1)),
  12,
  'pierwszy etap wydaje 12 zadań, a nie całą lekcję'
);

select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select id from t_lesson), 1) a
     join public.get_lesson_exercises((select id from t_lesson), 2) b on b.id = a.id),
  0,
  'etapy nie zachodzą na siebie'
);

select throws_ok(
  'select * from public.get_lesson_exercises((select id from t_lesson), 4)',
  '22023',
  null,
  'nie ma czwartego etapu w trzyetapowej lekcji'
);

insert into t_sess select 1, public.start_lesson_session((select id from t_lesson), 'etap-1', 1);

select is(
  (select total_exercises from public.lesson_sessions where id = (select id from t_sess where stage = 1)),
  12,
  'sesja liczy zadania swojego etapu'
);

-- Zadanie z drugiego etapu przysłane w sesji pierwszego etapu.
select throws_ok(
  format(
    'select public.submit_attempt(%L, %L, ''{"text":"cokolwiek"}''::jsonb)',
    (select id from t_sess where stage = 1),
    (select id from t_ex where stage = 2 order by sort_order limit 1)
  ),
  '42501',
  null,
  'nie da się odpowiedzieć na zadanie z dalszego etapu'
);

-- Pierwszy etap w całości poprawnie.
do $run$
declare
  r record;
begin
  for r in select * from t_ex where stage = 1 order by sort_order loop
    perform public.submit_attempt(
      (select id from t_sess where stage = 1), r.id,
      jsonb_build_object('text', r.payload -> 'accepted' ->> 0), 9000, false
    );
  end loop;
end;
$run$;

insert into t_fin select 1, public.finish_lesson_session((select id from t_sess where stage = 1));

select is((select (result ->> 'stages')::integer from t_fin where stage = 1), 3,
          'podsumowanie wie, ile etapów ma lekcja');
select is((select (result ->> 'passed')::boolean from t_fin where stage = 1), true,
          'etap zaliczony');
select is((select (result ->> 'lessonPassed')::boolean from t_fin where stage = 1), false,
          'jeden etap to jeszcze nie cała lekcja');
select is(
  (select status::text from public.lesson_progress
    where user_id = (select id from t_user) and lesson_id = (select id from t_lesson)),
  'in_progress',
  'lekcja zostaje w toku, dopóki zostały etapy'
);

-- Drugi i trzeci etap.
do $run$
declare
  r       record;
  s       integer;
  v_sess  uuid;
begin
  for s in 2..3 loop
    v_sess := public.start_lesson_session((select id from t_lesson), 'etap-' || s, s);
    insert into t_sess values (s, v_sess);
    for r in select * from t_ex where stage = s order by sort_order loop
      perform public.submit_attempt(v_sess, r.id, jsonb_build_object('text', r.payload -> 'accepted' ->> 0), 9000, false);
    end loop;
    insert into t_fin select s, public.finish_lesson_session(v_sess);
  end loop;
end;
$run$;

select is((select (result ->> 'lessonPassed')::boolean from t_fin where stage = 3), true,
          'po ostatnim etapie lekcja jest zaliczona');

select is(
  (select status::text from public.lesson_progress
    where user_id = (select id from t_user) and lesson_id = (select id from t_lesson)),
  'completed',
  'komplet etapów zalicza lekcję'
);

select is(
  (select stars::integer from public.lesson_progress
    where user_id = (select id from t_user) and lesson_id = (select id from t_lesson)),
  3,
  'wszystkie etapy bezbłędnie to trzy gwiazdki za lekcję'
);

-- Nagroda za lekcję rozłożona na etapy sumuje się do `xp_reward`, nie do jej trzykrotności.
select is(
  (select sum(delta)::integer from public.points_ledger
    where user_id = (select id from t_user) and reason = 'lesson_completed'),
  50,
  'punkty za lekcję nie mnożą się przez liczbę etapów'
);

select is(
  (select count(*)::integer from public.lesson_stage_progress
    where user_id = (select id from t_user) and lesson_id = (select id from t_lesson) and status = 'completed'),
  3,
  'każdy etap ma własny zapis postępu'
);

-- --- regresja: treść lekcji zmienia się przy otwartej sesji ---
--
-- To wywaliło lekcję na produkcji. Podział na etapy przeliczał się przy każdej odpowiedzi,
-- a zbiór zadań zmienia się w trakcie nauki: filtr poziomu zależy od stabilności FSRS, która
-- rośnie z każdą odpowiedzią, a import wymienia zadania w całości. Dziecko dostawało wtedy
-- „Zadanie należy do innego etapu lekcji" i nie mogło przejść dalej.
--
-- Od migracji 094200 sesja pamięta wydane zadania, więc późniejsza zmiana treści jej nie rusza.
create temporary table t_regr (id uuid);
grant select, insert on t_regr to authenticated;

insert into t_regr select public.start_lesson_session((select id from t_lesson), 'regresja', 1);

select set_config('role', 'postgres', true);

insert into public.exercises (lesson_id, type, sort_order, payload, points)
select (select id from t_lesson), 'translate_ba', 500 + g,
       jsonb_build_object('prompt', 'extra' || g, 'accepted', jsonb_build_array('dodatkowe' || g)), 10
  from generate_series(1, 10) g;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

select is(
  (select (public.submit_attempt(
      (select id from t_regr),
      (select id from t_ex where stage = 1 order by sort_order limit 1),
      jsonb_build_object('text', (select payload -> 'accepted' ->> 0 from t_ex where stage = 1 order by sort_order limit 1)),
      9000, false) ->> 'correct')::boolean),
  true,
  'dołożenie zadań do lekcji nie blokuje sesji, która już trwa'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
