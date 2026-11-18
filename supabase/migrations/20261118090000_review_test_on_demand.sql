-- Test powtórkowy na żądanie: otwarty, dopóki jest co powtarzać.
--
-- Dotąd kafelek testu był otwarty dokładnie wtedy, gdy stała bramka (`review_gate_on`). Zdany
-- test zdejmuje blokadę do końca dnia — i razem z nią znikał test. Dziecko z kolejką na
-- czterdzieści zaległych słówek dostawało więc dwanaście z nich dziś, a na resztę musiało
-- czekać do jutra, aż blokada wróci. Kolejka, która narosła przez tydzień przerwy, schodziła
-- tygodniami, bo dzień dawał najwyżej jeden test.
--
-- Od tej migracji jedno nie zależy już od drugiego:
--
--   * BLOKADA lekcji zostaje bez zmian — zdany test zwalnia na cały dzień (`review_gate_on`),
--   * TEST jest otwarty, dopóki w kursie jest choć jedno zaległe słówko z zadaniem.
--
-- Dzięki temu dziecko, które chce kolejkę zbić od razu, robi drugi i trzeci test z własnej woli,
-- a nie pod przymusem zamkniętych lekcji. Każde podejście bierze kolejne dwanaście najdłużej
-- zaległych słówek (`pick_review_exercises`), więc testy nie powtarzają tych samych słówek
-- w kółko, a gdy kolejka się opróżni, kafelek znika sam — `course_due_words` spada do zera.
--
-- Punkty: każde zdane podejście dopisuje `xp_reward` testu, bo to osobna, przerobiona sesja.
-- To nie jest kopalnia punktów — żeby je dostać, trzeba poprawnie odpowiedzieć na dwanaście
-- zaległych słówek, a każda odpowiedź (również błędna) przesuwa termin słówka w przyszłość,
-- więc zaległych ubywa i po kilku podejściach nie ma już z czego zrobić testu.
--
-- Odrzucone: zdjęcie zwolnienia „do końca dnia” i trzymanie blokady, aż kolejka spadnie poniżej
-- progu (dziecko po dłuższej przerwie nie doszłoby do lekcji ani razu — to dokładnie ten błąd,
-- przed którym broni nagłówek `20261116120000_review_gate.sql`); limit „trzy testy dziennie”
-- (próg wzięty z powietrza, a kolejka i tak ogranicza się sama); osobny kafelek „Powtórz teraz”
-- obok testu (dwa wejścia w to samo, a treść identyczna).

-- Ciało przepisane z `20261116280000_unlock_points.sql` — zmienia się jedna gałąź `case`.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Test powtórkowy jest otwarty, dopóki jest co powtarzać — także po dzisiejszym zdanym
    -- teście, gdy bramka już nie stoi. Bez zaległego słówka z zadaniem nie ma z czego zrobić
    -- testu, więc kafelek jest zamknięty i ekran go nie pokazuje.
    when l.review_scope_course_id is not null then
      public.course_due_words(l.review_scope_course_id, p_user) > 0
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
  'wstępny lekcji albo punkt odblokowania (test działu czeka na komplet lekcji, a test '
  'powtórkowy stoi otworem, dopóki są zaległe słówka).';
