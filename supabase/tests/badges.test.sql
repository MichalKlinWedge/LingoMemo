-- Odznaki: liczniki reguł, przyznawanie i pokazywanie, ile brakuje.
--
-- Wszystkie liczby stawiamy na własnym kursie i własnym dziecku, nie na seedzie — inaczej
-- każda nowa lekcja w kursie startowym psułaby test. Postęp wstawiamy wprost do tabel, bo tu
-- sprawdzamy liczenie odznak, a nie przechodzenie lekcji (to robi `lessons.test.sql`).

begin;
select plan(21);

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

-- Claimy układamy raz, jeszcze jako rola bazy: `authenticated` nie czyta `auth.users`.
create or replace function pg_temp.as_user(p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', (select claims from t_claims where name = p_name), true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('uczen', pg_temp.make_user('uczen-badge@test.local'));

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;

grant select on t_ids, t_claims to authenticated;

-- Kurs testowy: dwie zwykłe lekcje i jeden sprawdzian.
with c as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-badge', 'pl', 'en', 'Kurs odznakowy', true)
  returning id
), u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from c
  returning id, course_id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published, kind)
select id, x.slug, x.title, x.ord, true, x.kind::public.lesson_kind from u,
  (values ('b1', 'Lekcja 1', 1, 'standard'), ('b2', 'Lekcja 2', 2, 'standard'),
          ('b3', 'Sprawdzian', 3, 'test')) as x(slug, title, ord, kind);

create temporary table t_ctx as
select c.id as course_id,
       (select l.id from public.lessons l join public.units un on un.id = l.unit_id
         where un.course_id = c.id and l.slug = 'b1') as lekcja1,
       (select l.id from public.lessons l join public.units un on un.id = l.unit_id
         where un.course_id = c.id and l.slug = 'b2') as lekcja2,
       (select l.id from public.lessons l join public.units un on un.id = l.unit_id
         where un.course_id = c.id and l.slug = 'b3') as sprawdzian
  from public.courses c where c.slug = 'test-badge';
grant select on t_ctx to authenticated;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

-- Postęp łatwego poziomu: trzy ukończone lekcje, jedna bezbłędnie i na trzy gwiazdki.
insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lekcja1, 'completed'::public.progress_status, 1.000, 3::smallint, now() from t_ctx
union all
select (select id from t_ids where name = 'uczen'), lekcja2, 'completed'::public.progress_status, 0.900, 2::smallint, now() from t_ctx
union all
select (select id from t_ids where name = 'uczen'), sprawdzian, 'completed'::public.progress_status, 0.850, 2::smallint, now() from t_ctx;

-- Trudniejsze wejścia: średni poziom zdany na jedną gwiazdkę, trudny na dwie.
insert into public.lesson_level_progress (user_id, lesson_id, level, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lekcja1, 2::smallint, 'completed'::public.progress_status, 0.820, 1::smallint, now() from t_ctx
union all
select (select id from t_ids where name = 'uczen'), lekcja1, 3::smallint, 'completed'::public.progress_status, 0.910, 2::smallint, now() from t_ctx;

-- Dziesięć minut nauki: jedna dokończona sesja, jedna porzucona (liczy się jako zero).
insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, started_at, finished_at)
select (select id from t_ids where name = 'uczen'), lekcja1, 'badge-1', now() - interval '10 minutes', now()
  from t_ctx
union all
select (select id from t_ids where name = 'uczen'), lekcja2, 'badge-2', now() - interval '2 hours', null
  from t_ctx;

-- Jedna odpowiedź dobra, jedna zła.
insert into public.attempts (session_id, user_id, exercise_type, is_correct, raw_answer)
select s.id, s.user_id, 'translate_ab', x.ok, '{"text":"dog"}'::jsonb
  from public.lesson_sessions s, (values (true), (false)) as x(ok)
 where s.idempotency_key = 'badge-1';

-- Dwa słówka umiane na dłużej (stabilność ponad trzy tygodnie).
with k as (
  insert into public.concepts (course_id, key)
  select course_id, x.key from t_ctx, (values ('pies'), ('kot')) as x(key)
  returning id, course_id
)
insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on)
select (select id from t_ids where name = 'uczen'), k.id, k.course_id, 25, 5, current_date + 25 from k;

insert into public.user_stats (user_id, streak_days, best_streak, lessons_done, last_active_on)
values ((select id from t_ids where name = 'uczen'), 5, 5, 3, current_date);

-- Trzysta punktów z nauki. Dobrane tak, że sama nauka nie wystarcza na „Pięćset punktów”,
-- ale punkty z przyznanych odznak już tak — to sprawdza drugie przejście `award_badges`.
insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
values ((select id from t_ids where name = 'uczen'), 300, 'manual', 'test', null);

-- --- liczniki reguł ---
create temporary table t_vals as
select public.badge_values((select id from t_ids where name = 'uczen')) as v;

select is((select (v ->> 'lessons_completed')::integer from t_vals), 3, 'ukończone lekcje');
select is((select (v ->> 'perfect_lessons')::integer from t_vals), 1, 'bezbłędne przejścia');
select is((select (v ->> 'three_star_lessons')::integer from t_vals), 1, 'lekcje na trzy gwiazdki');
select is((select (v ->> 'stars_total')::integer from t_vals), 10,
  'gwiazdki ze wszystkich poziomów razem: 3 + 2 + 2 z łatwego, 1 + 2 z trudniejszych');
select is((select (v ->> 'levels_passed')::integer from t_vals), 2, 'zdane trudniejsze wejścia');
select is((select (v ->> 'hard_levels')::integer from t_vals), 1, 'zdane poziomy trudne');
select is((select (v ->> 'tests_passed')::integer from t_vals), 1, 'zdane sprawdziany');
select is((select (v ->> 'streak_days')::integer from t_vals), 5, 'seria dni');
select is((select (v ->> 'words_learned')::integer from t_vals), 2, 'słówka umiane na dłużej');
select is((select (v ->> 'answers_correct')::integer from t_vals), 1, 'dobre odpowiedzi');
select is((select (v ->> 'learning_minutes')::integer from t_vals), 10,
  'minuty nauki — porzucona sesja nie liczy się wcale');
select is((select (v ->> 'points_total')::integer from t_vals), 300, 'punkty');

-- --- przyznawanie ---
create temporary table t_awarded as
select public.award_badges((select id from t_ids where name = 'uczen')) as codes;

select is(
  (select array_length(codes, 1) from t_awarded),
  6,
  'sześć odznak za ten postęp'
);

select ok(
  (select 'points_500' = any(codes) from t_awarded),
  'odznaka za punkty wchodzi w drugim przejściu, bo punkty dały ją wcześniejsze odznaki'
);

select ok(
  (select not ('words_10' = any(codes)) from t_awarded),
  'dwa umiane słówka to jeszcze nie dziesięć'
);

select is(
  array_length(public.award_badges((select id from t_ids where name = 'uczen')), 1),
  null::integer,
  'drugie wywołanie nie przyznaje niczego po raz wtóry'
);

select is(
  (select count(*)::integer from public.points_ledger pl
    where pl.user_id = (select id from t_ids where name = 'uczen') and pl.reason = 'badge'),
  6,
  'każda odznaka zapłaciła dokładnie raz'
);

-- --- ile brakuje ---
select pg_temp.as_user('uczen');

select is(
  (select p.value || ' z ' || p.target from public.my_badge_progress() p where p.code = 'lessons_10'),
  '3 z 10',
  'dziecko widzi, ile mu brakuje do odznaki'
);

select is(
  (select p.value || ' z ' || p.target from public.my_badge_progress() p where p.code = 'first_lesson'),
  '1 z 1',
  'postęp przycięty do progu — nigdy „3 z 1”'
);

select throws_ok(
  'select public.badge_values((select id from t_ids where name = ''uczen''))',
  '42501',
  null,
  'liczniki reguł nie są wystawione zalogowanemu'
);

reset role;
set local role anon;

select throws_ok(
  'select * from public.my_badge_progress()',
  '42501',
  null,
  'postępu odznak nie czyta nikt niezalogowany'
);

reset role;

select * from finish();
rollback;
