-- Konta w panelu: kto widzi listę i kto może zmienić cudze hasło.
--
-- Zmiana hasła omija Admin API Supabase i zapisuje skrót wprost w `auth.users`, więc test
-- sprawdza nie tylko uprawnienia, ale i to, że skrót jest w formacie, który GoTrue zweryfikuje
-- (bcrypt `$2a$`), oraz że stare sesje konta znikają.

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
    p_email, extensions.crypt('stare-haslo', extensions.gen_salt('bf', 10)),
    now(), '{}'::jsonb, jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('zosia', pg_temp.make_user('zosia-acc@test.local'));
insert into t_ids values ('janek', pg_temp.make_user('janek-acc@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-acc@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
grant select on t_ids to authenticated;

-- Otwarta sesja ucznia: po zmianie hasła ma zniknąć.
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), (select id from t_ids where name = 'zosia'), now(), now());

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'janek')), true);

select throws_ok(
  'select public.list_accounts()',
  '42501',
  null,
  'uczeń nie zobaczy listy kont'
);

select throws_ok(
  format('select public.set_user_password(%L, ''nowe-haslo-123'')', (select id from t_ids where name = 'zosia')),
  '42501',
  null,
  'uczeń nie zmieni cudzego hasła'
);

select throws_ok(
  format('select public.set_user_password(%L, ''nowe-haslo-123'')', (select id from t_ids where name = 'janek')),
  '42501',
  null,
  'uczeń nie zmieni nawet własnego hasła tą drogą'
);

-- Claimy czyta się z auth.users, a rola `authenticated` jej nie widzi — stąd powrót do roli bazy.
reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select is(
  (select count(*)::integer from public.list_accounts() a
    where a.email in ('zosia-acc@test.local', 'janek-acc@test.local', 'admin-acc@test.local')),
  3,
  'administrator widzi wszystkie konta'
);

select is(
  (select a.is_admin from public.list_accounts() a where a.email = 'admin-acc@test.local'),
  true,
  'lista kont pokazuje rolę administratora'
);

select throws_ok(
  format('select public.set_user_password(%L, ''krotkie'')', (select id from t_ids where name = 'zosia')),
  '22023',
  null,
  'hasło krótsze niż osiem znaków nie przechodzi'
);

select throws_ok(
  'select public.set_user_password(''00000000-0000-0000-0000-000000000001''::uuid, ''nowe-haslo-123'')',
  '22023',
  null,
  'nie da się ustawić hasła nieistniejącemu kontu'
);

select lives_ok(
  format('select public.set_user_password(%L, ''nowe-haslo-123'')', (select id from t_ids where name = 'zosia')),
  'administrator ustawia hasło uczniowi'
);

-- --- skutki zmiany ---
reset role;

select is(
  (select u.encrypted_password = extensions.crypt('nowe-haslo-123', u.encrypted_password)
     from auth.users u where u.id = (select id from t_ids where name = 'zosia')),
  true,
  'nowe hasło pasuje do zapisanego skrótu'
);

select matches(
  (select u.encrypted_password from auth.users u where u.id = (select id from t_ids where name = 'zosia')),
  '^\$2[aby]\$10\$',
  'skrót jest bcrypt w formacie, który czyta GoTrue'
);

select is(
  (select count(*)::integer from auth.sessions s where s.user_id = (select id from t_ids where name = 'zosia')),
  0,
  'sesje konta są kasowane razem ze zmianą hasła'
);

select is(
  (select r.changed_by from app_private.password_resets r
    where r.user_id = (select id from t_ids where name = 'zosia')),
  (select id from t_ids where name = 'admin'),
  'ślad w password_resets wskazuje administratora, który zmienił hasło'
);

select * from finish();
rollback;
