-- Ustawienia aplikacji: jedna tabela na pokrętła, które administrator przestawia bez wdrożenia.
--
-- Pierwsze pokrętło to czas automatycznego przejścia do następnego zadania. Siedział jako stała
-- `AUTO_NEXT_MS` w kodzie przeglądarki, więc zmiana z dziesięciu sekund na sześć wymagała
-- wdrożenia. To jest akurat ustawienie, które widać dopiero na dziecku: jedno czyta polecenie
-- dłużej, drugie klika szybciej niż ekran zdąży się przerysować.
--
-- Klucz i `jsonb`, nie kolumna na ustawienie: następne pokrętło ma być wierszem, nie migracją
-- zmieniającą kształt tabeli i wszystkie zapytania, które ją czytają. Cena: wartości trzeba
-- sprawdzać w jednym miejscu — robi to `admin_set_setting`, bo baza nie wymusi zakresu
-- na dowolnym `jsonb`.
--
-- Zapis wyłącznie funkcją `security definer`, dokładnie jak w tabelach postępu: brak polityki
-- INSERT/UPDATE to decyzja, nie przeoczenie. Odczyt ma każdy zalogowany — przeglądarka dziecka
-- musi znać czas odliczania, a nie ma tu nic wrażliwego.
--
-- Odrzucone: ustawienia w zmiennych środowiskowych (zmiana wymaga wdrożenia, czyli dokładnie
-- tego, co usuwamy); osobna tabela na każde ustawienie (tyle migracji, ile pokręteł);
-- ustawienia per dziecko (to są pokrętła całej aplikacji, a nie profil ucznia — gdyby kiedyś
-- miały być osobne na dziecko, trafią do `profiles`, bo tam już mieszka to, co jego).

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.app_settings is
  'Pokrętła aplikacji ustawiane przez administratora. Zapis tylko przez admin_set_setting().';

alter table public.app_settings enable row level security;

-- Odczyt dla każdego zalogowanego: wartości są jawne, a przeglądarka dziecka ich potrzebuje.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to authenticated using (true);

-- Celowo BRAK polityki INSERT/UPDATE/DELETE — tak samo jak przy tabelach postępu.

insert into public.app_settings (key, value)
values ('auto_next_seconds', to_jsonb(6))
on conflict (key) do nothing;

/**
 * Zapis ustawienia. Zakres sprawdzamy tutaj, bo `jsonb` przyjąłby wszystko — a pokrętło
 * ustawione na zero sekund albo na dziesięć minut psuje lekcję tak samo skutecznie.
 */
create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user uuid := (select auth.uid());
  v_int  integer;
begin
  if not public.is_admin() then
    raise exception 'Tylko administrator' using errcode = '42501';
  end if;

  case p_key
    when 'auto_next_seconds' then
      if jsonb_typeof(p_value) <> 'number' then
        raise exception 'Czas przejścia podaje się w sekundach' using errcode = '22023';
      end if;
      v_int := (p_value #>> '{}')::integer;
      -- Dolna granica: poniżej dwóch sekund dziecko nie zdąży zobaczyć „Brawo!". Górna:
      -- powyżej trzydziestu nie jest to już automatyczne przejście, tylko zawieszony ekran.
      if v_int < 2 or v_int > 30 then
        raise exception 'Czas przejścia to od 2 do 30 sekund' using errcode = '22023';
      end if;
      p_value := to_jsonb(v_int);
    else
      raise exception 'Nie ma ustawienia o nazwie %', p_key using errcode = '22023';
  end case;

  insert into public.app_settings (key, value, updated_at, updated_by)
  values (p_key, p_value, now(), v_user)
  on conflict (key) do update set
    value      = excluded.value,
    updated_at = now(),
    updated_by = excluded.updated_by;

  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$fn$;

/**
 * Odczyt liczby z ustawień razem z wartością domyślną. Funkcja, a nie `coalesce` rozsiane
 * po zapytaniach: brakujący wiersz i wiersz z czymś innym niż liczba mają dawać to samo,
 * czyli wartość domyślną, a nie błąd w środku lekcji.
 */
create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select coalesce(
    (select (s.value #>> '{}')::integer
       from public.app_settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'number'),
    p_default
  );
$fn$;

revoke execute on function public.admin_set_setting(text, jsonb) from anon, public;
revoke execute on function public.setting_int(text, integer) from anon, public;
grant execute on function public.admin_set_setting(text, jsonb) to authenticated;
grant execute on function public.setting_int(text, integer) to authenticated;
