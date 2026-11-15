-- Statystyki dziecka: czas nauki, liczniki i widoczność.
--
-- Liczby sprawdzamy na własnym kursie, nie na seedzie — inaczej każda nowa lekcja w kursie
-- startowym psułaby test. Widoczność sprawdzamy z trzech stron: właściciel, inne dziecko
-- i administrator; widoki mają `security_invoker`, więc to RLS, a nie zapytanie, decyduje.

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

-- Claimy układamy raz, jeszcze jako rola bazy: `authenticated` nie czyta `auth.users`, więc
-- druga zmiana użytkownika w teście padałaby na „permission denied for table users”.
create or replace function pg_temp.as_user(p_name text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', (select claims from t_claims where name = p_name), true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('uczen', pg_temp.make_user('uczen-stats@test.local'));
insert into t_ids values ('drugi', pg_temp.make_user('drugi-stats@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-stats@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;

grant select on t_ids, t_claims to authenticated;

-- Kurs tylko na potrzeby testu: dwie lekcje widoczne i jedna ukryta.
with c as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-stat', 'pl', 'en', 'Kurs testowy', true)
  returning id
), u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'test-dzial', 'Dział testowy', 1, true from c
  returning id, course_id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, x.slug, x.title, x.ord, x.pub from u,
  (values ('l1', 'Lekcja 1', 1, true), ('l2', 'Lekcja 2', 2, true), ('l3', 'Lekcja 3', 3, false))
    as x(slug, title, ord, pub);

create temporary table t_ctx as
select c.id as course_id,
       (select l.id from public.lessons l join public.units un on un.id = l.unit_id
         where un.course_id = c.id and l.slug = 'l1') as lesson1,
       (select l.id from public.lessons l join public.units un on un.id = l.unit_id
         where un.course_id = c.id and l.slug = 'l2') as lesson2
  from public.courses c where c.slug = 'test-stat';
grant select on t_ctx to authenticated;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

-- Trzy podejścia do lekcji: krótkie dzisiaj, bardzo długie dziesięć dni temu i porzucone.
insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, started_at, finished_at)
select (select id from t_ids where name = 'uczen'), lesson1, 'k1', now() - interval '5 minutes', now() from t_ctx;
insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, started_at, finished_at)
select (select id from t_ids where name = 'uczen'), lesson2, 'k2',
       now() - interval '10 days', now() - interval '10 days' + interval '2 hours' from t_ctx;
insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, started_at, finished_at)
select (select id from t_ids where name = 'uczen'), lesson2, 'k3', now() - interval '1 hour', null from t_ctx;

insert into public.lesson_progress (user_id, lesson_id, status, best_score, stars)
select (select id from t_ids where name = 'uczen'), lesson1, 'completed', 1.0, 3 from t_ctx;

-- Dwa słówka, jedno utrwalone na tyle, żeby liczyć się jako umiane (stabilność >= 21 dni).
with k as (
  insert into public.concepts (course_id, key)
  select course_id, x.key from t_ctx, (values ('stat.one'), ('stat.two')) as x(key)
  returning id, key, course_id
)
insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on)
select (select id from t_ids where name = 'uczen'), k.id, k.course_id,
       case when k.key = 'stat.one' then 40 else 3 end, 5,
       case when k.key = 'stat.one' then current_date + 20 else current_date end
  from k;

-- --- sama funkcja od czasu ---
select is(public.session_seconds(now() - interval '5 minutes', now()), 300, 'pięć minut to 300 sekund');
select is(public.session_seconds(now() - interval '2 hours', now()), 1800, 'dłuższa sesja przycina się do pół godziny');
select is(public.session_seconds(now() - interval '5 minutes', null), 0, 'porzucona sesja nie liczy się wcale');

-- --- widok podsumowania oczami dziecka ---
select pg_temp.as_user('uczen');

select is(
  (select s.seconds_total::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  2100,
  'czas nauki to suma dokończonych sesji, z przyciętą długą'
);

select is(
  (select s.seconds_week::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  300,
  'czas w tym tygodniu pomija sesję sprzed dziesięciu dni'
);

select is(
  (select s.sessions_done::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  2,
  'dokończone podejścia liczą się bez porzuconego'
);

select is(
  (select s.words_seen::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  2,
  'poznane słówka to wiersze stanu powtórek'
);

select is(
  (select s.words_mastered::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  1,
  'umiane słówko to takie ze stabilnością co najmniej 21 dni'
);

select is(
  (select count(*)::integer from public.v_my_stats),
  1,
  'dziecko widzi w podsumowaniu wyłącznie swój wiersz'
);

-- --- widok kursów ---
select is(
  (select c.lessons_total::integer from public.v_my_courses c where c.course_id = (select course_id from t_ctx)),
  2,
  'lekcje w kursie liczą się tylko opublikowane'
);

select is(
  (select c.lessons_done::integer from public.v_my_courses c where c.course_id = (select course_id from t_ctx)),
  1,
  'zaliczone lekcje to te z ukończonym postępem'
);

select is(
  (select c.seconds_total::integer from public.v_my_courses c where c.course_id = (select course_id from t_ctx)),
  2100,
  'czas w kursie liczy się z sesji jego lekcji'
);

reset role;

-- --- cudze dane ---
select pg_temp.as_user('drugi');

select is(
  (select count(*)::integer from public.v_my_courses c where c.user_id = (select id from t_ids where name = 'uczen')),
  0,
  'inne dziecko nie zobaczy cudzych kursów'
);

reset role;

select pg_temp.as_user('admin');

select is(
  (select s.seconds_total::integer from public.v_my_stats s where s.user_id = (select id from t_ids where name = 'uczen')),
  2100,
  'administrator czyta czas nauki dziecka tym samym widokiem'
);

reset role;

select * from finish();
rollback;
