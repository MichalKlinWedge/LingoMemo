-- Rejestracja z zaproszenia: kto może wygenerować link, co się dzieje przy jego użyciu
-- i czego nie da się obejść.
--
-- Hook `before_user_created` testujemy, wołając go wprost z ładunkiem w takim kształcie,
-- w jakim przysyła go Supabase Auth.

begin;
select plan(17);

create or replace function pg_temp.make_user(p_email text, p_token text default null) returns uuid
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
    case when p_token is null then '{}'::jsonb else jsonb_build_object('invite', p_token) end,
    now(), now()
  );
  return v_id;
end;
$$;

-- Ładunek w kształcie, jaki przysyła Supabase Auth.
create or replace function pg_temp.hook_event(p_token text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('user', jsonb_build_object(
    'user_metadata', case when p_token is null then '{}'::jsonb else jsonb_build_object('invite', p_token) end,
    'app_metadata', '{}'::jsonb
  ));
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-inv@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-inv@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_course as select id from public.courses where slug = 'pl-en-starter';
create temporary table t_tok (name text primary key, token text);
grant select on t_ids, t_course to authenticated;
grant select, insert on t_tok to authenticated;

-- --- kto może generować ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  'select public.create_invite()',
  '42501',
  null,
  'uczeń nie wygeneruje zaproszenia'
);

select throws_ok(
  'select public.list_invites()',
  '42501',
  null,
  'uczeń nie zobaczy listy zaproszeń'
);

-- Powrót do postgresa: odczyt auth.users przy budowaniu claimów wymaga uprawnień, których
-- rola `authenticated` nie ma.
select set_config('role', 'postgres', true);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

insert into t_tok
select 'ok', public.create_invite('student', 14, 1, (select id from t_course), 'Zosia', null);

select ok(
  (select char_length(token) from t_tok where name = 'ok') >= 40,
  'token zaproszenia ma co najmniej 40 znaków'
);

select is(
  (select count(*)::integer from public.list_invites()),
  1,
  'administrator widzi wygenerowane zaproszenie'
);

select is(
  (select status from public.list_invites() limit 1),
  'aktywne',
  'świeże zaproszenie jest aktywne'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

-- --- w bazie nie ma jawnego tokenu ---
select is(
  (select count(*)::integer from app_private.invitations i
    where encode(i.token_hash, 'hex') = (select token from t_tok where name = 'ok')),
  0,
  'w bazie leży skrót tokenu, nie sam token'
);

select is(
  (select count(*)::integer from app_private.invitations i
    where i.token_hash = app_private.token_digest((select token from t_tok where name = 'ok'))),
  1,
  'zaproszenie odnajduje się po skrócie tokenu'
);

-- --- podgląd ---
select is(
  ((public.invite_preview((select token from t_tok where name = 'ok'), '10.0.0.1') ->> 'ok')::boolean),
  true,
  'podgląd ważnego zaproszenia działa przed zalogowaniem'
);

select is(
  (public.invite_preview((select token from t_tok where name = 'ok'), '10.0.0.1') ->> 'displayName'),
  'Zosia',
  'podgląd podaje imię z zaproszenia'
);

select is(
  (public.invite_preview('zupelnie-wymyslony-token', '10.0.0.1') ->> 'reason'),
  'invalid',
  'nieistniejące zaproszenie daje ten sam powód odmowy co zużyte'
);

-- --- hook rejestracji ---
select is(
  pg_temp.hook_event(null) is not null and (public.before_user_created(pg_temp.hook_event(null)) ? 'error'),
  true,
  'rejestracja bez tokenu jest odrzucona'
);

select is(
  public.before_user_created(pg_temp.hook_event('token-ktorego-nie-ma')) ? 'error',
  true,
  'rejestracja z wymyślonym tokenem jest odrzucona'
);

select is(
  public.before_user_created(pg_temp.hook_event((select token from t_tok where name = 'ok'))),
  '{}'::jsonb,
  'rejestracja z ważnym tokenem przechodzi'
);

-- Hook zużył zaproszenie, więc drugi raz ten sam link nie zadziała.
select is(
  public.before_user_created(pg_temp.hook_event((select token from t_tok where name = 'ok'))) ? 'error',
  true,
  'ten sam link nie zadziała drugi raz'
);

-- --- co się dzieje po założeniu konta ---
select pg_temp.make_user('zosia-inv@test.local', (select token from t_tok where name = 'ok'));

select is(
  (select count(*)::integer from public.enrollments e
    join auth.users u on u.id = e.user_id
   where u.email = 'zosia-inv@test.local' and e.course_id = (select id from t_course)),
  1,
  'konto z zaproszenia jest od razu zapisane na kurs'
);

select is(
  (select count(*)::integer from app_private.invitations i
    join auth.users u on u.id = i.consumed_by
   where u.email = 'zosia-inv@test.local'),
  1,
  'zaproszenie zapamiętuje, kto z niego skorzystał'
);

-- --- pierwszy administrator tylko raz ---
select throws_ok(
  'select public.bootstrap_admin(''uczen-inv@test.local'')',
  '22023',
  null,
  'bootstrap administratora nie zadziała, gdy administrator już jest'
);

select * from finish();
rollback;
