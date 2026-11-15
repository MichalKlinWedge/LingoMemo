-- Zmiana hasła: potwierdzenie własnym hasłem i pewniejsze unieważnianie sesji.
--
-- Trzy rzeczy do poprawienia w `set_user_password` z poprzedniej migracji. Tamtej nie da się już
-- zmienić — jest wgrana na produkcji — więc funkcja powstaje tu od nowa.
--
-- 1. Kasowanie sesji opierało się na kaskadzie z `auth.sessions` na `auth.refresh_tokens`.
--    Kolumna `refresh_tokens.session_id` jest opcjonalna, więc token bez sesji przeżyłby zmianę
--    hasła. W tej wersji GoTrue każdy token dostaje sesję, ale to założenie o cudzym schemacie,
--    a nie gwarancja — kasujemy więc tokeny wprost, po właścicielu.
--
-- 2. Do zmiany cudzego hasła wystarczała otwarta sesja administratora. Na wspólnym tablecie
--    znaczy to, że każdy, kto go podniesie, resetuje wszystkie konta — łącznie z kontami
--    pozostałych administratorów, czyli przejmuje je. Teraz trzeba podać własne hasło.
--
-- 3. Ślad zapisujemy dalej; dochodzi do niego informacja, czy to była zmiana własnego hasła.

alter table app_private.password_resets
  add column if not exists was_self boolean not null default false;

-- Stara wersja znika: zostawiona obok byłaby obejściem potwierdzenia hasłem.
drop function if exists public.set_user_password(uuid, text);

create or replace function public.set_user_password(
  p_user uuid,
  p_password text,
  p_admin_password text
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_admin uuid := (select auth.uid());
  v_hash  text;
begin
  perform app_private.assert_admin();

  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Nie ma takiego konta' using errcode = '22023';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'Hasło musi mieć co najmniej 8 znaków' using errcode = '22023';
  end if;

  -- Potwierdzenie tożsamości: hasło administratora, nie sama otwarta sesja.
  select u.encrypted_password into v_hash from auth.users u where u.id = v_admin;
  if v_hash is null
     or p_admin_password is null
     or v_hash <> extensions.crypt(p_admin_password, v_hash) then
    raise exception 'Nieprawidłowe hasło administratora' using errcode = '42501';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = p_user;

  -- Najpierw tokeny odświeżania, potem sesje: token bez sesji nie ma się na czym oprzeć,
  -- ale istnieć może, a wtedy przeżyłby kaskadę.
  delete from auth.refresh_tokens r where r.user_id = p_user::text;
  delete from auth.sessions s where s.user_id = p_user;

  insert into app_private.password_resets (user_id, changed_by, was_self)
  values (p_user, v_admin, p_user = v_admin);
end;
$fn$;

comment on function public.set_user_password(uuid, text, text) is
  'Administrator ustawia hasło wskazanemu kontu po potwierdzeniu własnym hasłem. Kasuje sesje '
  'i tokeny odświeżania tego konta oraz zapisuje ślad w app_private.password_resets.';

revoke execute on function public.set_user_password(uuid, text, text) from anon, public;
grant execute on function public.set_user_password(uuid, text, text) to authenticated;
