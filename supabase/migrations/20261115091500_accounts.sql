-- Konta: podgląd dla administratora i zmiana cudzego hasła.
--
-- Hasło zmienia BAZA, nie aplikacja. Admin API Supabase (`auth.admin.updateUserById`) wymagałoby
-- klucza `service_role` w aplikacji webowej, a ten klucz omija RLS całkowicie — jeden wyciek
-- zmiennej środowiskowej i cała baza stoi otworem. Zamiast tego zapisujemy skrót hasła prosto
-- w `auth.users`, funkcją `security definer`, która sama sprawdza rolę administratora.
-- GoTrue trzyma hasła jako bcrypt, a `crypt(..., gen_salt('bf', 10))` z pgcrypto daje dokładnie
-- ten sam format (`$2a$10$...`), więc logowanie działa bez żadnej zmiany po stronie Auth.
--
-- Zmiana hasła kasuje sesje właściciela konta: inaczej ktoś, kto zna stare hasło i ma otwartą
-- kartę, zostaje zalogowany mimo zmiany.

create table app_private.password_resets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  changed_by  uuid references auth.users(id) on delete set null,
  at          timestamptz not null default now()
);
create index password_resets_user_idx on app_private.password_resets (user_id, at desc);

-- Lista kont dla panelu. Bez postępów — od tego jest `list_students`; tutaj liczy się to,
-- czym zarządza administrator: kto to jest, jaką ma rolę i czy w ogóle się loguje.
create or replace function public.list_accounts()
returns table (
  user_id uuid, display_name text, email text, is_admin boolean,
  created_at timestamptz, last_sign_in_at timestamptz, password_changed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return query
    select
      p.id, p.display_name, u.email::text,
      exists (select 1 from app_private.admin_users a where a.user_id = p.id),
      p.created_at,
      u.last_sign_in_at,
      (select max(r.at) from app_private.password_resets r where r.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    order by p.display_name;
end;
$fn$;

comment on function public.list_accounts() is
  'Konta do panelu administratora: rola, data założenia, ostatnie logowanie, ostatnia zmiana hasła.';

-- Ustawienie hasła innemu użytkownikowi. Minimalna długość jest TUTAJ, nie tylko w formularzu:
-- formularz da się ominąć, funkcję w bazie — nie.
create or replace function public.set_user_password(p_user uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_admin uuid := (select auth.uid());
begin
  perform app_private.assert_admin();

  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Nie ma takiego konta' using errcode = '22023';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'Hasło musi mieć co najmniej 8 znaków' using errcode = '22023';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user;

  -- Stare sesje przestają działać — hasło zmienia się właśnie po to.
  delete from auth.sessions s where s.user_id = p_user;

  insert into app_private.password_resets (user_id, changed_by) values (p_user, v_admin);
end;
$fn$;

comment on function public.set_user_password(uuid, text) is
  'Administrator ustawia hasło wskazanemu kontu. Kasuje sesje tego konta i zapisuje ślad w app_private.password_resets.';

revoke execute on function public.list_accounts() from anon, public;
revoke execute on function public.set_user_password(uuid, text) from anon, public;
grant execute on function public.list_accounts() to authenticated;
grant execute on function public.set_user_password(uuid, text) to authenticated;
