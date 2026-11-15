-- Rodzic poprawia dane dziecka: imię i strefę czasową.
--
-- Do tej pory imię dziecka dało się zmienić wyłącznie z jego własnego konta (`profiles_update_own`),
-- a dziecko nie ma w aplikacji żadnego ekranu, który by to robił. Literówka w imieniu wpisanym
-- przy zakładaniu konta zostawała więc na zawsze.
--
-- Zapis idzie funkcją `security definer`, a nie nową polityką `profiles_admin` do UPDATE. Powód:
-- polityka otwiera administratorowi WSZYSTKIE kolumny z `grant update (...)` w `20261115090700_rls.sql`
-- i każdą następną, którą ktoś tam kiedyś dopisze. Funkcja wylicza kolumny po nazwie, więc dołożenie
-- kolumny do tabeli niczego po cichu nie otwiera. Tak samo zrobiony jest `set_learner_level`.
--
-- Strefa czasowa jest tu razem z imieniem, bo to ona rozstrzyga, o której dziecku zmienia się dzień —
-- a od tego zależy termin powtórki i seria dni z rzędu (`start_lesson_session`, `finish_lesson_session`).
-- Sprawdzamy ją względem `pg_timezone_names`: wpisana z palca bzdura wywaliłaby dziecku nie ten
-- formularz, tylko start lekcji, bo `now() at time zone 'Warszawa'` rzuca błędem dopiero w użyciu.
--
-- Odrzucone: zmiana adresu e-mail w tym samym formularzu — e-mail siedzi w `auth.users`, a tam
-- sięga tylko `service_role`, którego w aplikacji webowej nie ma (i nie będzie). Konta są na
-- osobnym ekranie `/admin/konta`. Odrzucone też: poziom trudności w tym formularzu — ma własny
-- panel z opisem, co każdy poziom zmienia dla dziecka, i własną funkcję zapisu.

create or replace function public.admin_update_profile(
  p_user         uuid,
  p_display_name text,
  p_time_zone    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := btrim(coalesce(p_display_name, ''));
  v_tz   text := nullif(btrim(coalesce(p_time_zone, '')), '');
begin
  perform app_private.assert_admin();

  -- Ten sam zakres co `check` na kolumnie, ale z własnym zdaniem: komunikat z więzów bazy
  -- jest po angielsku i z nazwą ograniczenia.
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'Imię musi mieć od 1 do 40 znaków' using errcode = '22023';
  end if;

  if v_tz is not null
     and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_tz) then
    raise exception 'Nie ma takiej strefy czasowej: %', v_tz using errcode = '22023';
  end if;

  update public.profiles
     set display_name = v_name,
         -- Puste pole znaczy „zostaw jak było", a nie „wyczyść": strefa jest `not null`.
         time_zone    = coalesce(v_tz, time_zone),
         updated_at   = now()
   where id = p_user;

  if not found then
    raise exception 'Nie ma takiego ucznia' using errcode = '22023';
  end if;
end;
$fn$;

comment on function public.admin_update_profile(uuid, text, text) is
  'Rodzic poprawia imię i strefę czasową dziecka. Poziom trudności ustawia set_learner_level.';

revoke execute on function public.admin_update_profile(uuid, text, text) from anon, public;
grant execute on function public.admin_update_profile(uuid, text, text) to authenticated;
