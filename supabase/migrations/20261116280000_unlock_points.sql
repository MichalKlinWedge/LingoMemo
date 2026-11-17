-- Co daje każdy poziom: łatwy prowadzi dalej, średni daje podpowiedź, trudny punkt odblokowania.
--
-- Dotąd poziomy średni i trudny nie dawały nic poza gwiazdkami: postęp kursu liczy się z łatwego,
-- a dokładkę do podpowiedzi dawała sama ZALICZONA LEKCJA, czyli znowu łatwy. Dziecko, które
-- weszło na trudny, dostawało tyle samo co to, które go ominęło — więc go omijało.
--
-- Od teraz każdy poziom ma swoją nagrodę:
--
--   * ŁATWY   — otwiera następną lekcję (bez zmian, to on jest postępem).
--   * ŚREDNI  — dokłada jedną podpowiedź do dzisiejszej puli.
--   * TRUDNY  — daje jeden PUNKT ODBLOKOWANIA, za który dziecko otwiera dowolną zamkniętą
--               lekcję w dziale, w którym już jest.
--
-- Dzienna pula podpowiedzi zostaje trzy (`hint_limit`), zmienia się tylko źródło dokładki.
--
-- Punkty odblokowania liczymy tak samo jak podpowiedzi: Z TEGO, CO W BAZIE JUŻ JEST. Zarobione
-- to zaliczone wejścia na trudny (`lesson_level_progress`), zużyte to wiersze w `lesson_unlocks`,
-- a stan konta jest różnicą. Nie ma licznika do dopisywania ani do cofania, więc nie ma jak
-- rozjechać się z historią: skasowana lekcja zabiera i punkt, i odblokowanie.
--
-- Czym punkt NIE jest: przepustką przez dział ani przez bramkę powtórek. Kupić można wyłącznie
-- zwykłą lekcję (`kind = 'standard'`) w dziale już otwartym — test działu zostaje jedyną drogą
-- do następnego działu, a zaległe powtórki dalej zamykają kurs. Inaczej dziecko wymieniłoby
-- punkty na przeskoczenie wszystkiego, czego nie lubi.
--
-- Odrzucone: punkty w `points_ledger` (to waluta za zadania, pokazywana w pasku — zmieszanie
-- jej z odblokowaniami znaczyłoby, że dziecko kupuje lekcje za zwykłą naukę); kolumna
-- `unlock_points` w `profiles` (licznik do dopisywania i cofania, czyli dokładnie to, czego
-- uniknęliśmy przy podpowiedziach); odblokowanie całego działu (to już przeskok przez test);
-- punkt za średni i podpowiedź za trudny (nagroda ma rosnąć z trudnością, a odblokowanie jest
-- warte więcej niż jedna podpowiedź).

-- 1. Dokładka do podpowiedzi: za poziom średni zrobiony dzisiaj, nie za zaliczoną lekcję.
--
-- Reguła liczenia zostaje ta sama co w `20261115120000_hint_for_lesson.sql`: data z `completed_at`
-- w strefie dziecka, więc dokładka znika o północy razem z resztą puli, a powtórzone wejście nie
-- daje drugiej podpowiedzi (`completed_at` ustawia się raz, przez `coalesce`).
create or replace function public.hint_bonus(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
    from public.lesson_level_progress lp
   where lp.user_id = p_user
     and lp.level = 2
     and lp.status = 'completed'
     and lp.completed_at is not null
     and (lp.completed_at at time zone coalesce(
            (select p.time_zone from public.profiles p where p.id = p_user),
            'Europe/Warsaw'))::date = public.learner_today(p_user);
$fn$;

comment on function public.hint_bonus(uuid) is
  'Ile podpowiedzi dziecko dołożyło sobie dzisiaj: jedna za każdy poziom średni zrobiony tego dnia.';

-- 2. Zużyte punkty odblokowania. Jak każda tabela postępu: dla ucznia tylko do odczytu, zapis
-- wyłącznie przez `unlock_lesson`. Jeden wiersz to jedna otwarta lekcja i jeden wydany punkt.
create table if not exists public.lesson_unlocks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lesson_id  uuid not null references public.lessons(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

comment on table public.lesson_unlocks is
  'Lekcje otwarte punktem odblokowania. Wiersz jest zarazem śladem wydatku — stan konta to '
  'zaliczone poziomy trudne minus te wiersze.';

alter table public.lesson_unlocks enable row level security;

drop policy if exists lesson_unlocks_read on public.lesson_unlocks;
create policy lesson_unlocks_read on public.lesson_unlocks
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Celowo BRAK polityki INSERT/UPDATE/DELETE — tak samo jak przy pozostałych tabelach postępu.

grant select on public.lesson_unlocks to authenticated;

/**
 * Ile punktów odblokowania dziecko zarobiło: jeden za każde zaliczone wejście na trudny.
 *
 * Bez nadania dla `authenticated`: wołają to funkcje, które same pilnują, o czyje konto wolno
 * pytać. Gołe nadanie pozwalałoby policzyć cudze postępy.
 */
create or replace function public.unlock_points_earned(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
    from public.lesson_level_progress lp
   where lp.user_id = p_user
     and lp.level = 3
     and lp.status = 'completed';
$fn$;

/** Ile punktów odblokowania dziecku zostało: zarobione minus wydane, nigdy poniżej zera. */
create or replace function public.unlock_points_left(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select greatest(
    public.unlock_points_earned(p_user)
      - (select count(*) from public.lesson_unlocks lu where lu.user_id = p_user),
    0
  )::integer;
$fn$;

/** Stan konta punktów: własnego albo — dla administratora — cudzego. Jak `hint_status`. */
create or replace function public.unlock_status(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_me     uuid := (select auth.uid());
  v_earned integer;
  v_spent  integer;
begin
  if v_me is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if p_user is distinct from v_me and not public.is_admin() then
    raise exception 'To nie jest twoje konto' using errcode = '42501';
  end if;

  v_earned := public.unlock_points_earned(p_user);
  select count(*) into v_spent from public.lesson_unlocks lu where lu.user_id = p_user;

  return jsonb_build_object(
    'earned', v_earned,
    'spent', v_spent,
    'left', greatest(v_earned - v_spent, 0)
  );
end;
$fn$;

/**
 * Czy TĘ zamkniętą lekcję da się otworzyć punktem. O stan konta nie pyta — przycisk ma się
 * pokazać także wtedy, gdy punktów nie ma, żeby dziecko dowiedziało się, skąd je wziąć.
 *
 * Kolejność gałęzi jest oszczędnością, nie tylko regułą: lekcja otwarta wychodzi po pierwszym
 * sprawdzeniu, a to ta najczęstsza — widok kursu woła tę funkcję dla każdego kafelka.
 */
create or replace function public.can_unlock_lesson(p_lesson uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    -- Otwarta: nie ma czego kupować (to samo dotyczy lekcji już kupionej).
    when public.is_lesson_unlocked(l.id, p_user) then false
    -- Tylko zwykła lekcja. Test działu jest jedyną drogą do następnego działu, a powtórka
    -- i test powtórkowy otwierają się same, gdy jest co powtarzać.
    when l.kind <> 'standard' then false
    when l.unit_id is null then false
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Bramka zaległych powtórek zamyka cały kurs i punkt jej nie podnosi: zaległe słówka
    -- trzeba powtórzyć, a nie wykupić.
    when public.review_gate_on(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- „Dział, w którym dziecko już jest": dalszych działów nie widać, bo zamyka je test.
    when not public.is_unit_unlocked(l.unit_id, p_user) then false
    else true
  end
  from public.lessons l
  where l.id = p_lesson and l.is_published;
$fn$;

comment on function public.can_unlock_lesson(uuid, uuid) is
  'Czy zamkniętą lekcję da się otworzyć punktem odblokowania: zwykła lekcja w otwartym dziale '
  'kursu, na który uczeń jest zapisany, bez zaległej bramki powtórek.';

/**
 * Otwarcie lekcji za punkt.
 *
 * Powtórne kliknięcie nie kosztuje drugiego punktu: klucz główny trzyma jedno odblokowanie na
 * lekcję, a lekcja otwarta inną drogą (zaliczony warunek wstępny) wraca bez opłaty.
 */
create or replace function public.unlock_lesson(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  if not exists (select 1 from public.lessons l where l.id = p_lesson and l.is_published) then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;

  -- Blokada na czas transakcji, bo stan konta liczymy z dwóch zapytań: bez niej dwa kliknięcia
  -- w tej samej sekundzie (dwie zamknięte lekcje, jeden punkt) przeszłyby oba — każde widziałoby
  -- stan przed wstawieniem tego drugiego wiersza.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));

  -- Otwarta już wcześniej: milczenie zamiast błędu, bo ekran mógł być otwarty sprzed zaliczenia
  -- poprzedniej lekcji.
  if public.is_lesson_unlocked(p_lesson, v_user) then
    return jsonb_build_object('charged', false, 'left', public.unlock_points_left(v_user));
  end if;

  if not public.can_unlock_lesson(p_lesson, v_user) then
    raise exception 'Tej lekcji nie otworzysz punktem' using errcode = '42501';
  end if;

  if public.unlock_points_left(v_user) <= 0 then
    raise exception 'Nie masz punktu odblokowania. Zdobędziesz go za poziom trudny.'
      using errcode = '42501';
  end if;

  insert into public.lesson_unlocks (user_id, lesson_id)
  values (v_user, p_lesson)
  on conflict (user_id, lesson_id) do nothing;

  return jsonb_build_object('charged', true, 'left', public.unlock_points_left(v_user));
end;
$fn$;

-- 3. Kupiona lekcja jest otwarta. Gałąź stoi PO zamku działu i bramce powtórek, bo punkt nie
-- jest przepustką przez żadne z nich, a przed warunkiem wstępnym — bo właśnie jego zastępuje.
-- Ciało przepisane z `20261116170000_course_access_request.sql` z jedną gałęzią więcej.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Test powtórkowy jest otwarty dokładnie wtedy, gdy stoi bramka. Bez zaległości nie ma
    -- czego powtarzać, więc kafelek jest zamknięty i ekran go nie pokazuje.
    when l.review_scope_course_id is not null then public.review_gate_on(l.review_scope_course_id, p_user)
    -- Bramka stoi przed zamkiem działu: zamyka cały kurs, razem z powtórkami i testami działów.
    when public.review_gate_on(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Zamek działu stoi przed wszystkim innym: zamknięty dział zamyka też swoją powtórkę
    -- i swój test, inaczej dałoby się przeskoczyć dział testem.
    when not public.is_unit_unlocked(l.unit_id, p_user) then false
    -- Lekcja kupiona za punkt odblokowania. Tylko zwykła: test i powtórka otwierają się same.
    when l.kind = 'standard' and exists (
      select 1 from public.lesson_unlocks lu
      where lu.user_id = p_user and lu.lesson_id = l.id
    ) then true
    -- Test sprawdza dział, więc czeka na komplet jego lekcji. Lekcje nieopublikowane się
    -- nie liczą — dziecko ich nie widzi, nie ma jak ich zaliczyć.
    when l.kind = 'test' then not exists (
      select 1 from public.lessons sl
      where sl.unit_id = l.unit_id and sl.kind = 'standard' and sl.is_published
        and not exists (
          select 1 from public.lesson_progress lp
          where lp.user_id = p_user and lp.lesson_id = sl.id and lp.status = 'completed'
        )
    )
    when l.kind = 'review' then exists (
      select 1
      from public.lesson_progress lp
      join public.lessons sl on sl.id = lp.lesson_id
      where lp.user_id = p_user
        and lp.status = 'completed'
        and sl.unit_id = l.review_scope_unit_id
    )
    when l.prerequisite_lesson_id is null then true
    else exists (
      select 1 from public.lesson_progress lp
      where lp.user_id = p_user
        and lp.lesson_id = l.prerequisite_lesson_id
        and lp.status = 'completed'
    )
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

comment on function public.is_lesson_unlocked(uuid, uuid) is
  'Czy lekcja jest dla tego ucznia otwarta: zapis na kurs, otwarty dział, a w nim warunek '
  'wstępny lekcji albo punkt odblokowania (test działu czeka na komplet lekcji).';

-- 4. Ekran kursu mówi, którą kłódkę da się otworzyć punktem. Ciało przepisane
-- z `20261115093000_lesson_stages.sql` z jedną kolumną więcej na końcu — `create or replace view`
-- nie pozwala wstawić jej w środku.
create or replace view public.v_my_lessons with (security_invoker = on) as
select
  l.id,
  l.unit_id,
  l.slug,
  l.title,
  l.icon,
  l.kind,
  l.sort_order,
  l.prerequisite_lesson_id,
  l.xp_reward,
  public.is_lesson_unlocked(l.id, (select auth.uid())) as is_unlocked,
  coalesce(lp.status::text, 'new') as status,
  coalesce(lp.stars, 0)            as stars,
  coalesce(lp.best_score, 0)       as best_score,
  case
    when l.kind = 'review' then public.lesson_exercise_count(l.id, (select auth.uid()))
    else (select count(*)::integer from public.lesson_items li where li.lesson_id = l.id)
  end as word_count,
  public.lesson_stage_count(l.id, (select auth.uid())) as stage_count,
  (select count(*)::integer from public.lesson_stage_progress sp
    where sp.lesson_id = l.id and sp.user_id = (select auth.uid()) and sp.status = 'completed')
    as stages_done,
  public.can_unlock_lesson(l.id, (select auth.uid())) as is_unlockable
from public.lessons l
left join public.lesson_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid())
where l.is_published;

grant select on public.v_my_lessons to authenticated;

revoke execute on function public.hint_bonus(uuid) from anon, public;
revoke execute on function public.unlock_points_earned(uuid) from anon, public;
revoke execute on function public.unlock_points_left(uuid) from anon, public;
revoke execute on function public.unlock_status(uuid) from anon, public;
revoke execute on function public.can_unlock_lesson(uuid, uuid) from anon, public;
revoke execute on function public.unlock_lesson(uuid) from anon, public;
revoke execute on function public.is_lesson_unlocked(uuid, uuid) from anon, public;
-- `can_unlock_lesson` musi być wołalne przez ucznia: widok ma `security_invoker`.
grant execute on function public.can_unlock_lesson(uuid, uuid) to authenticated;
grant execute on function public.is_lesson_unlocked(uuid, uuid) to authenticated;
grant execute on function public.unlock_status(uuid) to authenticated;
grant execute on function public.unlock_lesson(uuid) to authenticated;

-- Asercja jak w `…_rls.sql`: nowa tabela nie może zostać bez RLS.
do $check$
declare
  r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in (
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relrowsecurity
      )
  loop
    raise exception 'RLS wyłączone na public.%', r.tablename;
  end loop;
end;
$check$;
