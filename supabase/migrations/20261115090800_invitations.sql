-- Rejestracja wyłącznie z zaproszenia.
--
-- Publiczne zapisy w Supabase Auth zostają włączone, ale przechodzą przez hook
-- `before_user_created`: konto powstaje tylko wtedy, gdy w metadanych rejestracji jest ważny
-- token zaproszenia. Dzięki temu aplikacja webowa nie potrzebuje klucza `service_role`.
--
-- W bazie leży WYŁĄCZNIE sha256 tokenu. Wyciek kopii bazy nie daje działających linków.
-- Token (32 bajty losowe, 256 bitów entropii) widzi administrator raz, w chwili wygenerowania.

create table app_private.invitations (
  id           uuid primary key default gen_random_uuid(),
  token_hash   bytea not null unique,
  -- Osiem pierwszych znaków tokenu, żeby administrator poznał swój link na liście.
  token_prefix text not null,
  role         text not null default 'student' check (role in ('student', 'admin')),
  email        text,
  display_name text,
  course_id    uuid references public.courses(id) on delete set null,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  max_uses     integer not null default 1 check (max_uses >= 1),
  used_count   integer not null default 0,
  consumed_by  uuid references auth.users(id),
  consumed_at  timestamptz,
  revoked_at   timestamptz
);
create index invitations_created_idx on app_private.invitations (created_at desc);

-- Nieudane próby odczytania zaproszenia. Entropia tokenu i tak czyni zgadywanie niemożliwym;
-- to jest zabezpieczenie przed zasypaniem bazy zapytaniami.
create table app_private.invite_attempts (
  id           bigint generated always as identity primary key,
  ip           text,
  token_prefix text,
  ok           boolean not null,
  at           timestamptz not null default now()
);
create index invite_attempts_ip_idx on app_private.invite_attempts (ip, at desc);

create or replace function app_private.token_digest(p_token text)
returns bytea
language sql immutable set search_path = ''
as $fn$
  select extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');
$fn$;

-- Wygenerowanie zaproszenia. Token wraca RAZ — nie da się go później odczytać z bazy.
create or replace function public.create_invite(
  p_role text default 'student',
  p_days integer default 14,
  p_max_uses integer default 1,
  p_course uuid default null,
  p_display_name text default null,
  p_email text default null
)
returns text
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text;
begin
  perform app_private.assert_admin();

  if p_role not in ('student', 'admin') then
    raise exception 'Nieznana rola: %', p_role using errcode = '22023';
  end if;

  -- 32 bajty w base64url: bez znaków, które psują adres.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into app_private.invitations (
    token_hash, token_prefix, role, email, display_name, course_id, created_by, expires_at, max_uses
  )
  values (
    app_private.token_digest(v_token), left(v_token, 8), p_role, p_email, p_display_name, p_course,
    (select auth.uid()), now() + make_interval(days => greatest(p_days, 1)), greatest(p_max_uses, 1)
  );

  return v_token;
end;
$fn$;

-- Lista zaproszeń dla panelu. app_private nie jest wystawiony przez PostgREST, więc dostęp
-- idzie przez funkcję, która sama sprawdza rolę.
create or replace function public.list_invites()
returns table (
  id uuid, token_prefix text, role text, display_name text, email text,
  course_title text, created_at timestamptz, expires_at timestamptz,
  max_uses integer, used_count integer, revoked_at timestamptz, status text
)
language plpgsql security definer set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return query
    select i.id, i.token_prefix, i.role, i.display_name, i.email, c.title,
           i.created_at, i.expires_at, i.max_uses, i.used_count, i.revoked_at,
           case
             when i.revoked_at is not null then 'cofnięte'
             when i.used_count >= i.max_uses then 'wykorzystane'
             when i.expires_at <= now() then 'wygasłe'
             else 'aktywne'
           end
    from app_private.invitations i
    left join public.courses c on c.id = i.course_id
    order by i.created_at desc;
end;
$fn$;

create or replace function public.revoke_invite(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  update app_private.invitations set revoked_at = now() where id = p_id and revoked_at is null;
end;
$fn$;

-- Podgląd zaproszenia przed rejestracją: pokazuje imię i kurs, nigdy identyfikatorów.
-- Komunikat przy odmowie jest ZAWSZE taki sam — nie zdradzamy, czy token istnieje, wygasł,
-- został zużyty czy cofnięty.
create or replace function public.invite_preview(p_token text, p_ip text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_inv    app_private.invitations%rowtype;
  v_failed integer;
  v_ok     boolean;
begin
  select count(*) into v_failed
    from app_private.invite_attempts a
   where a.ip is not null and a.ip = p_ip and not a.ok and a.at > now() - interval '15 minutes';

  if v_failed >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limit');
  end if;

  select * into v_inv from app_private.invitations i
   where i.token_hash = app_private.token_digest(p_token)
     and i.revoked_at is null
     and i.expires_at > now()
     and i.used_count < i.max_uses;

  -- FOUND trzeba zapamiętać TERAZ: poniższy INSERT ustawia je na nowo i bez tego każdy token
  -- wyglądałby na ważny.
  v_ok := found;

  insert into app_private.invite_attempts (ip, token_prefix, ok)
  values (p_ip, left(coalesce(p_token, ''), 8), v_ok);

  if not v_ok then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  return jsonb_build_object(
    'ok', true,
    'displayName', v_inv.display_name,
    'email', v_inv.email,
    'courseTitle', (select c.title from public.courses c where c.id = v_inv.course_id)
  );
end;
$fn$;

-- Hook Auth „Before User Created". Zwrócenie pustego obiektu przepuszcza rejestrację,
-- zwrócenie `error` ją odrzuca.
--
-- Zaproszenie jest zużywane TUTAJ, jednym `update ... returning`, więc dwie równoczesne
-- rejestracje z tego samego linku nie przejdą obie. Ceną jest to, że gdy tworzenie konta padnie
-- z innego powodu (np. zajęty adres e-mail), zaproszenie przepada — administrator generuje nowe.
create or replace function public.before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text := event -> 'user' -> 'user_metadata' ->> 'invite';
  v_id    uuid;
begin
  -- Furtka na pierwszego administratora: `app_metadata` ustawia wyłącznie service_role.
  if coalesce((event -> 'user' -> 'app_metadata' ->> 'bootstrap')::boolean, false) then
    return '{}'::jsonb;
  end if;

  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Konto zakłada się z linku z zaproszeniem.'
    ));
  end if;

  update app_private.invitations
     set used_count = used_count + 1
   where token_hash = app_private.token_digest(v_token)
     and revoked_at is null
     and expires_at > now()
     and used_count < max_uses
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Zaproszenie jest nieprawidłowe lub wygasło.'
    ));
  end if;

  return '{}'::jsonb;
end;
$fn$;

-- Po założeniu konta: dopisanie uczestnika do zaproszenia, zapisanie na kurs, ewentualna rola
-- administratora.
--
-- Tokenu NIE da się tu usunąć z metadanych konta: Auth zapisuje wiersz użytkownika jeszcze raz
-- po tym triggerze, własną kopią metadanych, i nadpisuje każdą zmianę. Czyści go akcja
-- `acceptInvite` w aplikacji, już po założeniu konta.
create or replace function public.apply_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text := new.raw_user_meta_data ->> 'invite';
  v_inv   app_private.invitations%rowtype;
begin
  if v_token is null or btrim(v_token) = '' then
    return new;
  end if;

  select * into v_inv from app_private.invitations i
   where i.token_hash = app_private.token_digest(v_token);
  if not found then
    return new;
  end if;

  update app_private.invitations
     set consumed_by = coalesce(consumed_by, new.id), consumed_at = coalesce(consumed_at, now())
   where id = v_inv.id;

  if v_inv.course_id is not null then
    insert into public.enrollments (user_id, course_id) values (new.id, v_inv.course_id)
    on conflict do nothing;
  end if;

  if v_inv.role = 'admin' then
    insert into app_private.admin_users (user_id, granted_by) values (new.id, v_inv.created_by)
    on conflict do nothing;
  end if;

  return new;
end;
$fn$;

-- Po create_profile: profil ma już istnieć, zanim dopiszemy zapis na kurs.
drop trigger if exists trg_apply_invitation on auth.users;
create trigger trg_apply_invitation
after insert on auth.users
for each row execute function public.apply_invitation();

-- Pierwszy administrator. Działa TYLKO wtedy, gdy nie ma jeszcze żadnego — drugi raz się nie uda.
create or replace function public.bootstrap_admin(p_email text)
returns boolean
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  if exists (select 1 from app_private.admin_users) then
    raise exception 'Administrator już istnieje — kolejnych nadaje się zaproszeniem' using errcode = '22023';
  end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Nie ma konta o adresie %', p_email using errcode = '22023';
  end if;
  insert into app_private.admin_users (user_id) values (v_id);
  return true;
end;
$fn$;

-- Nadania.
revoke execute on function public.create_invite(text, integer, integer, uuid, text, text) from anon, public;
revoke execute on function public.list_invites() from anon, public;
revoke execute on function public.revoke_invite(uuid) from anon, public;
revoke execute on function public.invite_preview(text, text) from public;
revoke execute on function public.bootstrap_admin(text) from anon, authenticated, public;
revoke execute on function public.before_user_created(jsonb) from anon, authenticated, public;
revoke execute on function public.apply_invitation() from anon, authenticated, public;

grant execute on function public.create_invite(text, integer, integer, uuid, text, text) to authenticated;
grant execute on function public.list_invites() to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
-- Podgląd zaproszenia działa przed zalogowaniem.
grant execute on function public.invite_preview(text, text) to anon, authenticated;
grant execute on function public.bootstrap_admin(text) to service_role;

-- Hook wywołuje Auth własną rolą.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.before_user_created(jsonb) to supabase_auth_admin;
