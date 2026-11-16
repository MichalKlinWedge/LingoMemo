-- Ustawienia aplikacji: kto je czyta, kto zapisuje i czego baza nie przyjmie.
--
-- Tabela trzyma pokrętła całej aplikacji, więc zapis ma być dokładnie jeden: funkcja
-- `admin_set_setting`. Dziecko ma je czytać (przeglądarka potrzebuje czasu odliczania),
-- ale nie zmieniać — inaczej wystarczyłoby jedno zapytanie z konsoli, żeby lekcja
-- przeskakiwała do następnego zadania w dwie sekundy.

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
insert into t_ids values ('admin', pg_temp.make_user('admin-ustawienia@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-ustawienia@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
grant select on t_ids to authenticated;

select is(public.setting_int('auto_next_seconds', 99), 6,
          'domyślny czas przejścia to sześć sekund');
select is(public.setting_int('nie-ma-takiego', 42), 42,
          'nieznane ustawienie oddaje wartość domyślną zamiast błędu');

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is((select count(*)::integer from public.app_settings where key = 'auto_next_seconds'), 1,
          'dziecko czyta ustawienia, bo przeglądarka ich potrzebuje');

select throws_ok(
  'select public.admin_set_setting(''auto_next_seconds'', to_jsonb(3))',
  'Tylko administrator',
  'dziecko nie przestawi pokrętła funkcją'
);

-- Brak polityki UPDATE znaczy: zapytanie przechodzi, ale nie rusza ani jednego wiersza.
update public.app_settings set value = to_jsonb(2) where key = 'auto_next_seconds';
reset role;
select is((select (value #>> '{}')::integer from public.app_settings where key = 'auto_next_seconds'), 6,
          'zapis wprost do tabeli nic nie zmienia');

-- --- jako administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select lives_ok(
  'select public.admin_set_setting(''auto_next_seconds'', to_jsonb(8))',
  'administrator przestawia czas przejścia'
);
select is(public.setting_int('auto_next_seconds', 6), 8,
          'nowa wartość obowiązuje od razu');

select throws_ok(
  'select public.admin_set_setting(''auto_next_seconds'', to_jsonb(1))',
  'Czas przejścia to od 2 do 30 sekund',
  'poniżej dwóch sekund baza nie przyjmie'
);
select throws_ok(
  'select public.admin_set_setting(''auto_next_seconds'', to_jsonb(''dużo''::text))',
  'Czas przejścia podaje się w sekundach',
  'tekst zamiast liczby baza nie przyjmie'
);
select throws_ok(
  'select public.admin_set_setting(''kolor_tla'', to_jsonb(''czerwony''::text))',
  'Nie ma ustawienia o nazwie kolor_tla',
  'nieznanego klucza nie da się dopisać'
);

reset role;

select * from finish();
rollback;
