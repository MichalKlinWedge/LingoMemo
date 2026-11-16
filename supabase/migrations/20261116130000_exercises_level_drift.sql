-- Wyrównanie kolumny `exercises.level` do kształtu z migracji.
--
-- `db diff --linked` pokazywał rozjazd między bazą w chmurze a łańcuchem migracji: w chmurze
-- kolumna `level` była `not null`, a więz nazywał się `exercises_level_check` i sprawdzał samo
-- `level between 1 and 3`. Migracje dają co innego — kolumnę BEZ `not null` i więz
-- `exercises_level_valid` z warunkiem `level is not null and level between 1 and 3`
-- (`20261115094000_learner_level.sql`). Tamten kształt nie jest przeoczeniem: `not null` bez
-- wartości domyślnej sprawia, że generator typów robi z `level` pole WYMAGANE w każdym
-- `insert()` w aplikacji, a wartości domyślnej dać nie można, bo ubiegłaby wyzwalacz
-- `set_exercise_level` i wszystkie zadania miałyby poziom 1.
--
-- Znaczenie obu wersji jest to samo (puste `level` nie przejdzie ani tu, ani tam), więc nic się
-- dotąd nie psuło. Rozjazd jest jednak kosztowny inaczej: każde kolejne `db diff --linked`
-- pokazuje te trzy polecenia, a prawdziwa zmiana schematu w chmurze utonie wśród nich. Do tego
-- migracja, która kiedyś zechce ruszyć ten więz po nazwie, wywali się tylko na produkcji.
--
-- Dlatego kształt z migracji jest tym właściwym, a ten plik dociąga do niego chmurę. Na bazie
-- zbudowanej z migracji wszystkie trzy polecenia nic nie robią — i tak ma być.
--
-- Odrzucone: przepisanie `20261115094000_learner_level.sql` pod stan chmury (migracja już
-- wypchnięta; zmiana wstecz znaczy, że lokalna baza i produkcja powstają z różnych plików
-- o tej samej nazwie — czyli ten sam rozjazd, tylko niewidoczny); `not null` w obu miejscach
-- (wraca problem z generatorem typów); zostawienie rozjazdu i filtrowanie go wzrokiem
-- przy każdym `db diff`.

alter table public.exercises
  alter column level drop not null;

alter table public.exercises
  drop constraint if exists exercises_level_check;

-- `add constraint if not exists` nie istnieje, a powtórne dodanie tej samej nazwy to błąd.
do $drift$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint con
     where con.conrelid = 'public.exercises'::pg_catalog.regclass
       and con.conname = 'exercises_level_valid'
  ) then
    alter table public.exercises
      add constraint exercises_level_valid check (level is not null and level between 1 and 3);
  end if;
end;
$drift$;
