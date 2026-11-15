-- Zmiana hasła bez potwierdzania własnym hasłem.
--
-- Decyzja właściciela aplikacji: dodatkowe pole w formularzu kosztuje przy każdym użyciu, a
-- korzyść jest tylko na wypadek cudzej ręki przy odblokowanym urządzeniu administratora.
-- Przy domowej aplikacji dla dwójki dorosłych ten koszt nie zwraca się.
--
-- Co ZOSTAJE z poprzedniej wersji, bo nie kosztuje nic przy użyciu:
--   * kasowanie tokenów odświeżania wprost, nie przez kaskadę z `auth.sessions`,
--   * znacznik `was_self` w śladzie,
--   * sprawdzenie roli przez `assert_admin()`, czyli po tabeli, a nie po claimie w tokenie,
--   * minimalna długość hasła pilnowana w bazie, nie tylko w formularzu.

drop function if exists public.set_user_password(uuid, text, text);

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

  -- Najpierw tokeny odświeżania, potem sesje: `refresh_tokens.session_id` jest kolumną
  -- opcjonalną, więc token bez sesji przeżyłby samą kaskadę.
  delete from auth.refresh_tokens r where r.user_id = p_user::text;
  delete from auth.sessions s where s.user_id = p_user;

  insert into app_private.password_resets (user_id, changed_by, was_self)
  values (p_user, v_admin, p_user = v_admin);
end;
$fn$;

comment on function public.set_user_password(uuid, text) is
  'Administrator ustawia hasło wskazanemu kontu. Kasuje sesje i tokeny odświeżania tego konta '
  'oraz zapisuje ślad w app_private.password_resets.';

revoke execute on function public.set_user_password(uuid, text) from anon, public;
grant execute on function public.set_user_password(uuid, text) to authenticated;
