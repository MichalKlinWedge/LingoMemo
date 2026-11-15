-- Usunięcie kursu zależy od tego, czy ktoś się już z niego uczył.
--
-- Kurs nietknięty znika naprawdę. Kurs, w którym jest ślad nauki, tylko schodzi dzieciom
-- z oczu — razem z nim zostaje wszystko, czego nie dałoby się odtworzyć: sesje, wyniki podejść
-- i harmonogram powtórek. O tym, która gałąź zadziała, decyduje baza, nie przeglądarka.

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

/** Claim składamy PRZED zmianą roli: `auth.users` jest niedostępne dla `authenticated`. */
create or replace function pg_temp.jako(p_user uuid) returns void
language plpgsql as $$
declare
  v_claims text;
begin
  select json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
    into v_claims
    from auth.users u where u.id = p_user;

  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

/** Kurs z jednym działem i jedną lekcją. Zwraca id kursu i id lekcji. */
create or replace function pg_temp.kurs(p_slug text, out course_id uuid, out lesson_id uuid)
language plpgsql as $$
declare
  v_unit uuid;
begin
  insert into public.courses (slug, title, source_lang, target_lang, sort_order, is_published)
  values (p_slug, 'Kurs ' || p_slug, 'pl', 'en', 1, true)
  returning id into course_id;

  insert into public.units (course_id, slug, title, sort_order, is_published)
  values (course_id, 'dzial', 'Dział', 1, true)
  returning id into v_unit;

  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  values (v_unit, 'lekcja', 'Lekcja', 1, true)
  returning id into lesson_id;
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('rodzic-kasuj@test.local'));
insert into t_ids values ('zosia', pg_temp.make_user('zosia-kasuj@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_kursy as
  select 'pusty' as name, course_id, lesson_id from pg_temp.kurs('kurs-pusty')
  union all
  select 'zaczety', course_id, lesson_id from pg_temp.kurs('kurs-zaczety');

grant select on t_ids, t_kursy to authenticated;

-- Oba kursy mają zapisane dziecko: sam zapis to jeszcze nie nauka.
insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'zosia'), course_id from t_kursy;

-- --- 1. Co liczy się jako „zaczęty" ---

select ok(
  not public.course_started((select course_id from t_kursy where name = 'pusty')),
  'sam zapis na kurs to jeszcze nie jest nauka');

insert into public.lesson_sessions (user_id, lesson_id, idempotency_key)
select (select id from t_ids where name = 'zosia'),
       (select lesson_id from t_kursy where name = 'zaczety'),
       'test-1';

select ok(
  public.course_started((select course_id from t_kursy where name = 'zaczety')),
  'rozpoczęta lekcja robi z kursu kurs zaczęty');

select ok(
  not public.course_started((select course_id from t_kursy where name = 'pusty')),
  'a sąsiedni kurs zostaje nietknięty');

-- --- 2. Kurs nietknięty znika naprawdę ---

select pg_temp.jako((select id from t_ids where name = 'admin'));

select is(
  (select public.admin_delete_course((select course_id from t_kursy where name = 'pusty')) ->> 'action'),
  'deleted',
  'kurs bez śladu nauki jest kasowany');

reset role;

select is(
  (select count(*)::integer from public.courses
    where id = (select course_id from t_kursy where name = 'pusty')),
  0,
  'kursu nie ma już w tabeli');

select is(
  (select count(*)::integer from public.units
    where course_id = (select course_id from t_kursy where name = 'pusty')),
  0,
  'działy poszły razem z nim');

select is(
  (select count(*)::integer from public.enrollments
    where course_id = (select course_id from t_kursy where name = 'pusty')),
  0,
  'zapis dziecka też zniknął');

-- --- 3. Kurs zaczęty jest tylko ukrywany ---

select pg_temp.jako((select id from t_ids where name = 'admin'));

select is(
  (select public.admin_delete_course((select course_id from t_kursy where name = 'zaczety')) ->> 'action'),
  'hidden',
  'kurs ze śladem nauki jest ukrywany, nie kasowany');

reset role;

select is(
  (select count(*)::integer from public.courses
    where id = (select course_id from t_kursy where name = 'zaczety')),
  1,
  'kurs został w tabeli');

select is(
  (select is_published from public.courses
    where id = (select course_id from t_kursy where name = 'zaczety')),
  false,
  'ale zszedł dzieciom z oczu');

select is(
  (select count(*)::integer from public.lesson_sessions
    where lesson_id = (select lesson_id from t_kursy where name = 'zaczety')),
  1,
  'sesja lekcji została nietknięta');

select is(
  (select count(*)::integer from public.lessons
    where id = (select lesson_id from t_kursy where name = 'zaczety')),
  1,
  'lekcja została nietknięta');

-- Powtórzone kliknięcie nic nie psuje: kurs już jest ukryty i taki zostaje.
select pg_temp.jako((select id from t_ids where name = 'admin'));

select is(
  (select public.admin_delete_course((select course_id from t_kursy where name = 'zaczety')) ->> 'action'),
  'hidden',
  'drugie kliknięcie nadal tylko ukrywa');

-- --- 4. Kto może to zrobić ---

-- Wracamy do roli bazowej, zanim wejdziemy w skórę dziecka: `jako` czyta `auth.users`,
-- a `authenticated` nie ma do tej tabeli dostępu.
reset role;

select pg_temp.jako((select id from t_ids where name = 'zosia'));

select throws_ok(
  format('select public.admin_delete_course(%L)', (select course_id from t_kursy where name = 'zaczety')),
  '42501',
  null,
  'dziecko nie skasuje ani nie ukryje kursu');

select throws_ok(
  'select * from public.list_courses_started()',
  '42501',
  null,
  'dziecko nie dowie się, które kursy są zaczęte');

select throws_ok(
  format('select public.course_started(%L)', (select course_id from t_kursy where name = 'zaczety')),
  null,
  null,
  'funkcji wewnętrznej dziecko w ogóle nie wywoła');

reset role;

select is(
  (select count(*)::integer from public.courses
    where id = (select course_id from t_kursy where name = 'zaczety')),
  1,
  'po próbach dziecka kurs nadal jest');

select * from finish();
rollback;
