-- Rodzic poprawia dane dziecka: imię i strefę czasową.
--
-- Sprawdzamy dwie rzeczy naraz: że rodzic naprawdę może (bo polityka na `profiles` puszcza do
-- zapisu tylko własny wiersz, więc bez funkcji nie mógłby) i że nikt poza nim nie może — ani
-- dziecko na cudzym profilu, ani dziecko na swoim.

begin;
select plan(15);

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

/**
 * Wejście w skórę danego użytkownika. Claim składamy PRZED zmianą roli: `auth.users` jest
 * niedostępne dla roli `authenticated`, więc odwrotna kolejność wywala się na odczycie.
 */
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

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('rodzic-dane@test.local'));
insert into t_ids values ('zosia', pg_temp.make_user('zosia-dane@test.local'));
insert into t_ids values ('janek', pg_temp.make_user('janek-dane@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

update public.profiles set display_name = 'zosia-dane', time_zone = 'Europe/Warsaw'
 where id = (select id from t_ids where name = 'zosia');

grant select on t_ids to authenticated;

-- --- 1. Rodzic poprawia ---

select pg_temp.jako((select id from t_ids where name = 'admin'));

select lives_ok(
  format('select public.admin_update_profile(%L, %L)',
         (select id from t_ids where name = 'zosia'), 'Zosia'),
  'rodzic zmienia imię dziecka');

reset role;

select is(
  (select display_name from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'Zosia',
  'imię zapisane');

select pg_temp.jako((select id from t_ids where name = 'admin'));

select lives_ok(
  format('select public.admin_update_profile(%L, %L, %L)',
         (select id from t_ids where name = 'zosia'), 'Zosia', 'Europe/London'),
  'rodzic zmienia strefę czasową dziecka');

reset role;

select is(
  (select time_zone from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'Europe/London',
  'strefa zapisana');

-- Puste pole strefy znaczy „zostaw jak było". Kolumna jest `not null`, więc wyczyszczenie
-- jej wywaliłoby start lekcji, a nie ten formularz.
select pg_temp.jako((select id from t_ids where name = 'admin'));

select lives_ok(
  format('select public.admin_update_profile(%L, %L, null)',
         (select id from t_ids where name = 'zosia'), 'Zofia'),
  'zapis bez podanej strefy przechodzi');

reset role;

select is(
  (select time_zone from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'Europe/London',
  'pusta strefa zostawia poprzednią');

select is(
  (select display_name from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'Zofia',
  'a imię mimo to się zmieniło');

-- --- 2. Czego rodzicowi nie wolno wpisać ---

select pg_temp.jako((select id from t_ids where name = 'admin'));

select throws_ok(
  format('select public.admin_update_profile(%L, %L)',
         (select id from t_ids where name = 'zosia'), '   '),
  '22023',
  null,
  'puste imię odpada');

select throws_ok(
  format('select public.admin_update_profile(%L, %L)',
         (select id from t_ids where name = 'zosia'), repeat('a', 41)),
  '22023',
  null,
  'imię dłuższe niż czterdzieści znaków odpada');

select throws_ok(
  format('select public.admin_update_profile(%L, %L, %L)',
         (select id from t_ids where name = 'zosia'), 'Zofia', 'Warszawa'),
  '22023',
  null,
  'zmyślona strefa odpada tutaj, a nie przy starcie lekcji');

select throws_ok(
  format('select public.admin_update_profile(%L, %L)', gen_random_uuid(), 'Ktoś'),
  '22023',
  null,
  'nie ma takiego ucznia');

reset role;

select is(
  (select display_name || ' / ' || time_zone from public.profiles
    where id = (select id from t_ids where name = 'zosia')),
  'Zofia / Europe/London',
  'po odrzuconych zapisach dane zostały nietknięte');

-- --- 3. Dziecko nie poprawia niczyich danych ---

select pg_temp.jako((select id from t_ids where name = 'janek'));

select throws_ok(
  format('select public.admin_update_profile(%L, %L)',
         (select id from t_ids where name = 'zosia'), 'wlamywacz'),
  '42501',
  null,
  'dziecko nie zmieni danych innego dziecka');

select throws_ok(
  format('select public.admin_update_profile(%L, %L)',
         (select id from t_ids where name = 'janek'), 'Superbohater'),
  '42501',
  null,
  'dziecko nie przepisze sobie imienia tą funkcją');

reset role;

select is(
  (select display_name from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'Zofia',
  'po próbach dziecka imię zostało takie, jakie ustawił rodzic');

select * from finish();
rollback;
