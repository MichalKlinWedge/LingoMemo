-- Punkty odblokowania: skąd się biorą i czego nie otwierają.
--
-- Plik pilnuje czterech rzeczy, na których stoi uczciwość tej waluty: punkt daje wyłącznie
-- zaliczony poziom TRUDNY (średni dokłada podpowiedź i nic więcej), odblokowanie kosztuje
-- dokładnie jeden punkt, kupić da się tylko zwykłą lekcję w dziale już otwartym, a sam wpis
-- do tabeli odblokowań jest dla ucznia niedostępny.

begin;
select plan(17);

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
insert into t_ids values ('uczen', pg_temp.make_user('uczen-odblok@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-odblok@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Dwa działy. W pierwszym: lekcja otwarta, lekcja zamknięta warunkiem wstępnym i test działu.
-- W drugim: lekcja, do której nie ma jak dojść, bo test pierwszego działu nie jest zdany.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-odblokowania', 'pl', 'en', 'Kurs testowy', true) returning id
), d1 as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial-1', 'Dział 1', 1, true from k returning id, course_id
), d2 as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial-2', 'Dział 2', 2, true from k returning id
), l1 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-1', 'Lekcja 1', 1, true from d1 returning id
), l2 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published, prerequisite_lesson_id)
  select d1.id, 'lekcja-2', 'Lekcja 2', 2, true, l1.id from d1, l1 returning id
), t1 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published, kind)
  select id, 'test-dzialu', 'Test działu', 3, true, 'test' from d1 returning id
), l3 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-3', 'Lekcja 3', 1, true from d2 returning id
)
select (select course_id from d1) as course_id,
       (select id from l1) as lekcja_otwarta,
       (select id from l2) as lekcja_zamknieta,
       (select id from t1) as test_dzialu,
       (select id from l3) as lekcja_z_dalszego_dzialu;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

-- Claimy obu kont układamy raz, jeszcze jako rola bazy: po przełączeniu na `authenticated`
-- nie da się już czytać `auth.users`.
create temporary table t_claims as
select
  (select json_build_object('sub', u.id, 'role', 'authenticated',
          'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
     from auth.users u where u.id = (select id from t_ids where name = 'uczen')) as uczen,
  (select json_build_object('sub', u.id, 'role', 'authenticated',
          'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
     from auth.users u where u.id = (select id from t_ids where name = 'admin')) as admin;

grant select on t_ids, t_ctx, t_claims to authenticated;

create or replace function pg_temp.jako_uczen() returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', (select uczen from t_claims), true);
end;
$$;

-- --- punkt 0: zamknięta lekcja, pusty portfel ---
select pg_temp.jako_uczen();

select is(
  public.is_lesson_unlocked((select lekcja_zamknieta from t_ctx), (select id from t_ids where name = 'uczen')),
  false,
  'lekcja z niezrobionym warunkiem wstępnym jest zamknięta');

select is(
  public.can_unlock_lesson((select lekcja_zamknieta from t_ctx), (select id from t_ids where name = 'uczen')),
  true,
  'zwykłą zamkniętą lekcję w otwartym dziale da się otworzyć punktem');

select is(
  (public.unlock_status((select id from t_ids where name = 'uczen')) ->> 'left')::integer,
  0,
  'bez zaliczonego poziomu trudnego nie ma ani jednego punktu');

select throws_ok(
  format('select public.unlock_lesson(%L)', (select lekcja_zamknieta from t_ctx)),
  '42501',
  null,
  'bez punktu lekcja zostaje zamknięta');

-- --- poziom średni: podpowiedź, nie punkt ---
reset role;
insert into public.lesson_level_progress (user_id, lesson_id, level, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lekcja_otwarta, 2, 'completed', 1.0, 3, now() from t_ctx;

select pg_temp.jako_uczen();

select is(
  (public.unlock_status((select id from t_ids where name = 'uczen')) ->> 'left')::integer,
  0,
  'poziom średni nie daje punktu odblokowania');

select is(
  public.hints_left(),
  public.hint_limit() + 1,
  'poziom średni dokłada jedną podpowiedź do dzisiejszej puli');

-- --- poziom trudny: punkt ---
reset role;
insert into public.lesson_level_progress (user_id, lesson_id, level, status, best_score, stars, completed_at)
select (select id from t_ids where name = 'uczen'), lekcja_otwarta, 3, 'completed', 1.0, 3, now() from t_ctx;

select pg_temp.jako_uczen();

select is(
  (public.unlock_status((select id from t_ids where name = 'uczen')) ->> 'left')::integer,
  1,
  'zaliczony poziom trudny daje jeden punkt odblokowania');

-- --- czego punkt nie otwiera (portfel pełny, więc odmowa jest o lekcji, nie o pieniądzach) ---
select is(
  public.can_unlock_lesson((select lekcja_z_dalszego_dzialu from t_ctx), (select id from t_ids where name = 'uczen')),
  false,
  'lekcji z działu zamkniętego testem nie da się kupić');

select throws_ok(
  format('select public.unlock_lesson(%L)', (select lekcja_z_dalszego_dzialu from t_ctx)),
  '42501',
  null,
  'punkt nie przeskakuje testu działu');

select is(
  public.can_unlock_lesson((select test_dzialu from t_ctx), (select id from t_ids where name = 'uczen')),
  false,
  'testu działu nie da się kupić — to jedyna droga do następnego działu');

-- --- wydanie punktu ---
select is(
  (public.unlock_lesson((select lekcja_zamknieta from t_ctx)) ->> 'charged')::boolean,
  true,
  'odblokowanie zabiera punkt');

select is(
  public.is_lesson_unlocked((select lekcja_zamknieta from t_ctx), (select id from t_ids where name = 'uczen')),
  true,
  'kupiona lekcja jest otwarta');

select lives_ok(
  format('select public.start_lesson_session(%L, ''klucz-odblok'')', (select lekcja_zamknieta from t_ctx)),
  'na kupionej lekcji da się zacząć sesję');

select is(
  (public.unlock_status((select id from t_ids where name = 'uczen')) ->> 'left')::integer,
  0,
  'po odblokowaniu portfel jest pusty');

-- Lekcja otwarta nie kosztuje: mapa mogła stać otwarta sprzed zaliczenia poprzedniej lekcji.
select is(
  (public.unlock_lesson((select lekcja_otwarta from t_ctx)) ->> 'charged')::boolean,
  false,
  'za lekcję już otwartą punkt się nie pobiera');

select throws_ok(
  'insert into public.lesson_unlocks (user_id, lesson_id) '
  'values (auth.uid(), (select lekcja_z_dalszego_dzialu from t_ctx))',
  '42501',
  null,
  'uczeń nie odblokuje sobie lekcji wpisem do tabeli');

-- --- stan konta w karcie ucznia ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims', (select admin from t_claims), true);

select is(
  (public.unlock_status((select id from t_ids where name = 'uczen')) ->> 'spent')::integer,
  1,
  'karta ucznia pokazuje, ile punktów dziecko już wydało');

reset role;

select * from finish();
rollback;
