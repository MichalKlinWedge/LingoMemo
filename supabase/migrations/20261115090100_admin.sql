-- Administrator.
--
-- Rola NIE leży w tabeli, którą użytkownik może zapisywać — tam nadałby ją sobie sam. Źródłem
-- prawdy jest `app_private.admin_users`, niewidoczna przez PostgREST. Dla polityk RLS rola jest
-- mirrorowana do `auth.users.raw_app_meta_data`, skąd trafia do JWT jako `app_metadata`:
-- `is_admin()` czyta wtedy claim z tokenu i nie wykonuje ani jednego zapytania do bazy.
-- `app_metadata` może zapisywać wyłącznie `service_role` (inaczej niż `user_metadata`, które
-- użytkownik zmienia sam przez `auth.updateUser()`).

create table app_private.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

-- Szybka ścieżka dla RLS: zero wejść do bazy.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

comment on function public.is_admin() is
  'Czy bieżący użytkownik jest administratorem — z claimu w JWT. Claim bywa nieaktualny do czasu '
  'odświeżenia tokenu (do godziny), więc operacje nieodwracalne sprawdzają dodatkowo assert_admin().';

-- Ścieżka autorytatywna: czyta tabelę, nie token. Dla operacji, przy których godzina opóźnienia
-- ma znaczenie (zmiana treści, generowanie zaproszeń, odbieranie uprawnień).
create or replace function app_private.assert_admin(p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
begin
  if v_user is null or not exists (select 1 from app_private.admin_users a where a.user_id = v_user) then
    raise exception 'Operacja tylko dla administratora' using errcode = '42501';
  end if;
end;
$$;

-- Nadanie i odebranie roli natychmiast przepisuje claim. Przy odebraniu trzeba dodatkowo
-- wylogować użytkownika globalnie (auth.admin.signOut) — token już wydany żyje do wygaśnięcia.
create or replace function app_private.sync_admin_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('is_admin', exists (select 1 from app_private.admin_users a where a.user_id = v_user))
   where id = v_user;
  return null;
end;
$$;

drop trigger if exists trg_sync_admin_claim on app_private.admin_users;
create trigger trg_sync_admin_claim
after insert or delete on app_private.admin_users
for each row execute function app_private.sync_admin_claim();

revoke execute on function public.is_admin() from anon;
revoke execute on function app_private.assert_admin(uuid) from anon, authenticated, public;
