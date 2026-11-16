-- Dodatkowa podpowiedź za poziom średni.
--
-- Sprawdzamy to, na czym stoi uczciwość dokładki: że liczy się wejście na średni zrobione
-- DZISIAJ, że wczorajsze już nie, że powtórzone nie daje drugiej podpowiedzi, że dokładka
-- naprawdę przedłuża pulę (czwarte użycie przechodzi) i że data liczy się w strefie dziecka,
-- a nie serwera.

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
    jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-dokladka@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-dokladka@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Strefa z grubsza po drugiej stronie globu: po niej, a nie po zegarze serwera, ma lecieć doba.
update public.profiles set time_zone = 'Pacific/Auckland'
 where id = (select id from t_ids where name = 'uczen');

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-dokladka', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l1 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-1', 'Lekcja 1', 1, true from d returning id
), l2 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-2', 'Lekcja 2', 2, true from d returning id
)
select (select course_id from d) as course_id,
       (select id from l1) as lesson_one,
       (select id from l2) as lesson_two;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

-- Claimy obu kont układamy raz, jeszcze jako rola bazy: po przełączeniu na `authenticated`
-- nie da się już czytać `auth.users` (opisane w DECYZJE jako pułapka drugiej zmiany konta).
create temporary table t_claims as
select
  (select json_build_object('sub', u.id, 'role', 'authenticated',
          'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
     from auth.users u where u.id = (select id from t_ids where name = 'uczen')) as uczen,
  (select json_build_object('sub', u.id, 'role', 'authenticated',
          'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
     from auth.users u where u.id = (select id from t_ids where name = 'admin')) as admin;

grant select on t_ids, t_ctx, t_claims to authenticated;

/** Pula widziana oczami dziecka: `hints_left()` liczy dla tego, kto pyta. */
create or replace function pg_temp.zostalo() returns integer language plpgsql as $$
declare
  v integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', (select uczen from t_claims), true);
  v := public.hints_left();
  reset role;
  return v;
end;
$$;

/** Dzisiejsza data w strefie dziecka — do wstawiania użyć i zaliczeń „na dziś". */
create or replace function pg_temp.dzis() returns date language sql as $$
  select public.learner_today((select id from t_ids where name = 'uczen'));
$$;

-- --- pusty dzień ---
select is(pg_temp.zostalo(), public.hint_limit(), 'bez poziomu średniego zostaje sama pula dzienna');

-- --- jedno wejście na średni zrobione dzisiaj ---
insert into public.lesson_level_progress (user_id, lesson_id, level, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lesson_one, 2, 'completed', 1.0, 3, now() from t_ctx;

select is(pg_temp.zostalo(), public.hint_limit() + 1, 'poziom średni zrobiony dzisiaj dokłada jedną podpowiedź');
select is(
  (select public.hint_bonus((select id from t_ids where name = 'uczen'))),
  1,
  'dokładka to jedna podpowiedź za jedno wejście na średni'
);

-- --- drugie wejście tego samego dnia ---
insert into public.lesson_level_progress (user_id, lesson_id, level, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lesson_two, 2, 'completed', 1.0, 3, now() from t_ctx;

select is(pg_temp.zostalo(), public.hint_limit() + 2, 'drugie wejście dokłada drugą podpowiedź');

-- --- powtórzenie wejścia ---
-- `finish_lesson_session` trzyma `completed_at` na `coalesce`, więc ponowne przejście nie
-- rusza daty. Tu robimy to samo ręcznie: zmienia się wynik, data zostaje.
update public.lesson_level_progress
   set last_score = 0.9, attempts_count = attempts_count + 1, updated_at = now()
 where user_id = (select id from t_ids where name = 'uczen')
   and lesson_id = (select lesson_one from t_ctx);

select is(pg_temp.zostalo(), public.hint_limit() + 2, 'powtórzone wejście nie dokłada kolejnej podpowiedzi');

-- --- wczorajsze wejście ---
update public.lesson_level_progress
   set completed_at = now() - interval '2 days'
 where user_id = (select id from t_ids where name = 'uczen')
   and lesson_id = (select lesson_two from t_ctx);

select is(pg_temp.zostalo(), public.hint_limit() + 1, 'wejście zrobione wcześniej nie dokłada nic do dzisiejszej puli');

-- --- dokładka naprawdę przedłuża pulę ---
-- Tyle użyć z dzisiaj, ile wynosi pula dzienna: sama pula jest już zjedzona, więc to, co
-- zostaje, może pochodzić wyłącznie z dokładki za średni.
insert into public.hint_uses (user_id, session_id, exercise_id, easier_id, used_on)
select (select id from t_ids where name = 'uczen'), null, null, null, pg_temp.dzis()
  from generate_series(1, public.hint_limit());

select is(pg_temp.zostalo(), 1, 'po zjedzeniu całej puli zostaje jeszcze ta za średni');

insert into public.hint_uses (user_id, session_id, exercise_id, easier_id, used_on)
values ((select id from t_ids where name = 'uczen'), null, null, null, pg_temp.dzis());

select is(pg_temp.zostalo(), 0, 'użycie ponad pulę z dokładką zamyka pulę');

-- Ujemnej puli nie ma: dwa wejścia mniej niż użyć i dalej zero.
update public.lesson_level_progress
   set completed_at = now() - interval '2 days'
 where user_id = (select id from t_ids where name = 'uczen');

select is(pg_temp.zostalo(), 0, 'pula nie schodzi poniżej zera');

-- --- stan dla rodzica ---
update public.lesson_level_progress
   set completed_at = now()
 where user_id = (select id from t_ids where name = 'uczen')
   and lesson_id = (select lesson_one from t_ctx);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', (select admin from t_claims), true);

select is(
  (select (public.hint_status((select id from t_ids where name = 'uczen')) ->> 'bonus')::integer),
  1,
  'karta ucznia pokazuje dokładkę osobno od puli dziennej'
);

reset role;

select * from finish();
rollback;
