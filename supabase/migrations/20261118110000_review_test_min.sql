-- Test powtórkowy od pięciu zaległych słówek, nie od jednego.
--
-- Poprzednia migracja (`20261118090000_review_test_on_demand.sql`) otworzyła test na żądanie:
-- kafelek stoi otworem, dopóki w kursie jest CHOĆ JEDNO zaległe słówko. W praktyce wyszło z tego
-- zaproszenie do lekcji złożonej z trzech zadań — ekran kursu pokazywał kartę „Powtórki"
-- z przyciskiem „Powtórz teraz" nad całą resztą, a za nią czekały dwa słówka.
--
-- Taka lekcja nie jest warta wejścia dziecka. Test powtórkowy ma być czymś, co się robi, a nie
-- kolejnym przyciskiem do odhaczenia: dwanaście zadań, gdy kolejka jest długa, i co najmniej
-- pięć, gdy krótka. Poniżej pięciu zaległych słówek kafelek jest zamknięty, a karta na ekranie
-- kursu zamienia się w sam licznik, który mówi, od ilu słówek test się otworzy.
--
-- Próg piąty, nie trzeci i nie dziesiąty: trzy zadania to wciąż chwila, a dziesięć zrównałoby
-- otwarcie testu z zamknięciem kursu (`review_gate_limit`), czyli znosiłoby całe „na żądanie" —
-- test pojawiałby się dokładnie wtedy, gdy i tak nie ma już czego innego kliknąć.
--
-- Zatrzask bramki ma pierwszeństwo przed progiem: jeśli dziecko dziś oblało test, kurs zostaje
-- zamknięty, choć licznik zaległych spadł po tym teście poniżej pięciu (błędna odpowiedź też
-- przesuwa termin). Gdyby próg zamykał wtedy także test, dziecko zostałoby z kursem bez ani
-- jednego otwartego wejścia — ścianą bez drzwi. Dlatego: stoi bramka, to test jest otwarty.

-- 1. Od ilu zaległych słówek test ma sens.

create or replace function public.review_test_min() returns integer
  language sql immutable set search_path = '' as $fn$ select 5 $fn$;

comment on function public.review_test_min() is
  'Ile zaległych słówek musi uzbierać się w kursie, żeby test powtórkowy dało się zrobić.';

/**
 * Czy test powtórkowy kursu jest teraz do wzięcia.
 *
 * Dwa powody: uzbierało się dość zaległych słówek albo stoi bramka (wtedy test jest jedynym
 * wyjściem, więc próg go nie dotyczy). Jedna funkcja dla bazy i dla ekranu — strona nie liczy
 * progu po swojemu, tylko pyta.
 */
create or replace function public.review_test_open(p_course uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select p_course is not null
     and public.review_gate_lesson(p_course) is not null
     and (
       public.review_gate_on(p_course, p_user)
       or public.course_due_words(p_course, p_user) >= public.review_test_min()
     );
$fn$;

comment on function public.review_test_open(uuid, uuid) is
  'Czy test powtórkowy kursu jest otwarty: dość zaległych słówek albo stojąca bramka.';

-- 2. Otwarcie lekcji. Zmienia się jedna gałąź — reszta ciała przepisana
-- z `20261118100000_unit_practice.sql`.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Test powtórkowy: otwarty od `review_test_min` zaległych słówek, a przy stojącej bramce
    -- zawsze — jest wtedy jedynym wejściem w kurs. Krótka kolejka zostaje na jutro, bo lekcja
    -- z dwóch zadań nie jest warta wejścia.
    when l.review_scope_course_id is not null then
      public.review_test_open(l.review_scope_course_id, p_user)
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
    -- Test działu i powtórka działu czekają na to samo: komplet zaliczonych lekcji działu.
    -- Lekcje nieopublikowane się nie liczą — dziecko ich nie widzi, nie ma jak ich zaliczyć.
    -- Powtórka jest dobrowolna, więc sama niczego nie zamyka: `is_unit_unlocked` pyta tylko
    -- o test, a warunkiem wstępnym zwykłej lekcji powtórka nigdy nie jest.
    when l.kind = 'test' or (l.kind = 'review' and l.review_scope_unit_id is not null) then
      not exists (
        select 1 from public.lessons sl
        where sl.unit_id = l.unit_id and sl.kind = 'standard' and sl.is_published
          and not exists (
            select 1 from public.lesson_progress lp
            where lp.user_id = p_user and lp.lesson_id = sl.id and lp.status = 'completed'
          )
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
  'Czy lekcja jest dla tego ucznia otwarta: zapis na kurs, bramka powtórek, otwarty dział, '
  'a w nim warunek wstępny lekcji. Test działu i powtórka działu czekają na komplet lekcji '
  'działu; test powtórkowy kursu otwiera się od pięciu zaległych słówek.';

-- 3. Stan bramki dla ekranu. Dochodzą dwa pola — reszta ciała przepisana
-- z `20261116120000_review_gate.sql`.
create or replace function public.review_gate(p_course uuid, p_user uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_user uuid := coalesce(p_user, (select auth.uid()));
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if not (
    v_user = (select auth.uid())
    or public.is_admin()
    or v_user in (select public.my_child_ids())
  ) then
    raise exception 'To nie jest Twoje dziecko' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'active', public.review_gate_on(p_course, v_user),
    'due', public.course_due_words(p_course, v_user),
    'limit', public.review_gate_limit(),
    'lessonId', public.review_gate_lesson(p_course),
    'passedToday', public.review_gate_passed_today(p_course, v_user),
    -- Rozróżnienie dla strony: bramka od uzbieranych zaległości mówi dziecku „zdaj test",
    -- a bramka z zatrzasku — „spróbuj jeszcze raz".
    'triedToday', public.review_gate_tried_today(p_course, v_user),
    -- Czy jest dokąd prowadzić przyciskiem „Powtórz teraz". Ekran tego nie liczy sam, bo to
    -- ta sama reguła, którą `is_lesson_unlocked` wpuszcza do lekcji — rozjechałyby się.
    'testOpen', public.review_test_open(p_course, v_user),
    'testFrom', public.review_test_min()
  );
end;
$fn$;

-- 4. Nadania.

revoke execute on function public.review_test_open(uuid, uuid) from anon, public;

grant execute on function public.review_test_min() to authenticated;
grant execute on function public.review_test_open(uuid, uuid) to authenticated;
