-- Test powtórkowy: dziesięć zaległych słówek zamyka kurs.
--
-- Powtórki dotąd nikogo nie pilnowały. Dziecko widziało na stronie liczbę „🔁 14", wchodziło
-- w nową lekcję i uczyło się dalej, a kolejka zaległych rosła — czyli robiło dokładnie to,
-- przed czym FSRS ma chronić: zbierało nowe słówka, zapominając stare.
--
-- Od tej migracji kurs ma bramkę:
--
--   * zaległych słówek (termin na dziś albo wcześniej) jest w kursie dziesięć albo więcej
--     → wszystkie lekcje kursu są zamknięte, a otwarty zostaje jeden kafelek: „Test powtórkowy",
--   * test bierze zaległe słówka tego kursu, najbardziej spóźnione pierwsze, po jednym zadaniu
--     na słówko i najwyżej tyle, ile zwykła powtórka (`review_limit`, dziś 12),
--   * zdany test (próg lekcji, domyślnie 80%) zdejmuje blokadę DO KOŃCA DNIA dziecka.
--
-- Dlaczego „do końca dnia", a nie „dopóki zaległych jest mniej niż dziesięć": przy dłuższej
-- przerwie zaległych bywa czterdzieści, a test obejmuje dwanaście. Odpowiedzi z testu idą
-- normalnie przez FSRS, więc licznik spada — ale gdyby blokada patrzyła tylko na licznik,
-- dziecko po zdanym teście dostałoby natychmiast drugi, trzeci i czwarty i nie doszłoby do
-- lekcji ani razu. Dzień to naturalna miara: jutro test wróci, jeśli zaległych znowu jest
-- dziesięć. Doba liczona jest w strefie dziecka, tak jak seria dni i pula podpowiedzi.
--
-- Dlaczego raz podjęty test trzeba zdać (zatrzask): BŁĘDNA odpowiedź też przesuwa termin
-- słówka — FSRS wyznacza po wpadce krótki odstęp, ale liczony w dniach, czyli najbliższy termin
-- wypada jutro. Sam licznik zaległych spadałby więc po oblanym teście dokładnie tak samo jak po
-- zdanym i blokada puszczałaby dziecko dalej za dwanaście pustych odpowiedzi. Dlatego: jeśli
-- dziecko dziś dokończyło test powtórkowy i go nie zdało, kurs zostaje zamknięty, dopóki nie
-- zda — już niezależnie od licznika. Porzucona w połowie sesja (zerwane połączenie, zamknięta
-- karta) się nie liczy, bo nie została dokończona.
--
-- Wyjątek od zatrzasku: gdy nie ma już ani jednego zaległego słówka z zadaniem, bramka puszcza.
-- Inaczej dziecko, które oblało test obejmujący CAŁĄ kolejkę, zostałoby z zamkniętym kursem
-- i pustym testem — ścianą bez drzwi.
--
-- Dlaczego test powtórkowy jest zwykłą lekcją `kind = 'review'`, a nie nowym rodzajem:
-- cały silnik (sesja, próby, punkty, postęp) wisi na `lessons.id`, a `kind = 'review'` ma już
-- dobór zadań ze stanu powtórek, wymuszony poziom łatwy i pustą migawkę zadań. Nowa wartość
-- w `lesson_kind` znaczyłaby osobną migrację na sam enum i gałąź `review_test` w dwóch
-- największych funkcjach bazy (`get_lesson_exercises`, `start_lesson_session`) — zero zysku.
-- Różnicę robi zasięg: nowa kolumna `review_scope_course_id` zamiast `review_scope_unit_id`.
--
-- Odrzucone: liczenie zaległych per dział (dziecko z sześcioma zaległymi w jednym dziale
-- i siedmioma w drugim nie byłoby blokowane nigdzie, a zapomniało trzynaście słówek);
-- zerowanie całej kolejki po zdanym teście (słówka, których w teście nie było, dostałyby
-- termin wzięty z powietrza — FSRS przestaje wtedy cokolwiek znaczyć); blokada bez wyjścia
-- (kurs bez ani jednego zadania do powtórki zamknąłby się na zawsze, dlatego bramka liczy
-- tylko te zaległe słówka, które mają z czego zrobić zadanie).

-- 1. Zasięg powtórki: dział albo cały kurs.

alter table public.lessons
  add column if not exists review_scope_course_id uuid references public.courses(id) on delete cascade;

comment on column public.lessons.review_scope_course_id is
  'Kurs, którego dotyczy test powtórkowy. Dla powtórki działu i zwykłej lekcji puste.';

-- Dotychczasowy warunek tabeli wymagał działu przy każdej powtórce — test powtórkowy ma
-- zamiast działu kurs. `lessons_check` to automatyczna nazwa tego warunku z pierwszej migracji
-- (jedyny nienazwany warunek tabeli); nowy dostaje nazwę wprost, żeby następna migracja
-- nie musiała jej zgadywać.
alter table public.lessons drop constraint if exists lessons_check;
alter table public.lessons drop constraint if exists lessons_review_scope_check;
alter table public.lessons add constraint lessons_review_scope_check
  check (kind <> 'review' or review_scope_unit_id is not null or review_scope_course_id is not null);

-- 2. Ile zaległych zamyka kurs.

create or replace function public.review_gate_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 10 $fn$;

comment on function public.review_gate_limit() is
  'Ile zaległych słówek w kursie zamyka lekcje do czasu zdanego testu powtórkowego.';

/**
 * Zaległe słówka kursu, które da się powtórzyć.
 *
 * Słówko bez ani jednego aktywnego zadania się nie liczy: nie weszłoby do testu, więc bramka
 * stałaby się ścianą bez drzwi — dziecko miałoby zamknięty kurs i nic, czym mogłoby to odblokować.
 */
create or replace function public.course_due_words(p_course uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select count(*)::integer
    from public.srs_state s
   where s.user_id = p_user
     and s.course_id = p_course
     and s.due_on <= current_date
     and exists (
       select 1 from public.exercises ex
        where ex.concept_id = s.concept_id and ex.is_active
     );
$fn$;

-- Test powtórkowy kursu. Jeden na kurs — zakłada go wyzwalacz przy pierwszym słówku.
create or replace function public.review_gate_lesson(p_course uuid)
returns uuid
language sql stable security definer set search_path = ''
as $fn$
  select l.id from public.lessons l
   where l.review_scope_course_id = p_course and l.kind = 'review' and l.is_published
   order by l.id
   limit 1;
$fn$;

/**
 * Czy dziecko zdało dziś test powtórkowy tego kursu.
 *
 * Patrzymy na sesje, nie na `lesson_progress`: tam `completed_at` zostaje na zawsze po pierwszym
 * zdanym teście, a pytanie jest o dzisiejszy dzień. Doba w strefie dziecka — po 22:00 w Warszawie
 * data UTC jest już jutrzejsza, a dziecko dalej siedzi przy tym samym dniu.
 */
create or replace function public.review_gate_passed_today(p_course uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  with tz as (
    select coalesce(
      (select p.time_zone from public.profiles p where p.id = p_user),
      'Europe/Warsaw'
    ) as name
  )
  select exists (
    select 1
      from public.lesson_sessions s
      join public.lessons l on l.id = s.lesson_id
     where s.user_id = p_user
       and l.review_scope_course_id = p_course
       and s.finished_at is not null
       and s.score >= l.pass_threshold
       and (s.finished_at at time zone (select name from tz))::date
         = (now() at time zone (select name from tz))::date
  );
$fn$;

-- Czy dziecko dokończyło dziś jakieś podejście do testu powtórkowego tego kursu.
-- Porzucona sesja (brak `finished_at`) się nie liczy.
create or replace function public.review_gate_tried_today(p_course uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  with tz as (
    select coalesce(
      (select p.time_zone from public.profiles p where p.id = p_user),
      'Europe/Warsaw'
    ) as name
  )
  select exists (
    select 1
      from public.lesson_sessions s
      join public.lessons l on l.id = s.lesson_id
     where s.user_id = p_user
       and l.review_scope_course_id = p_course
       and s.finished_at is not null
       and (s.finished_at at time zone (select name from tz))::date
         = (now() at time zone (select name from tz))::date
  );
$fn$;

/**
 * Czy bramka stoi.
 *
 * Stoi, gdy jest co powtarzać, dziś nie ma zdanego testu, a przy tym albo uzbierało się dość
 * zaległych, albo test został dziś podjęty i oblany (zatrzask — patrz nagłówek migracji).
 */
create or replace function public.review_gate_on(p_course uuid, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_due integer;
begin
  if p_course is null or public.review_gate_lesson(p_course) is null then
    return false;
  end if;

  -- Nie ma zaległego słówka z zadaniem — nie ma z czego zrobić testu, więc bramka nie ma prawa
  -- stać. To jedyne wyjście z zatrzasku poza zdaniem testu.
  v_due := public.course_due_words(p_course, p_user);
  if v_due = 0 then
    return false;
  end if;

  if public.review_gate_passed_today(p_course, p_user) then
    return false;
  end if;

  return v_due >= public.review_gate_limit()
      or public.review_gate_tried_today(p_course, p_user);
end;
$fn$;

comment on function public.review_gate_on(uuid, uuid) is
  'Czy kurs jest dla tego ucznia zamknięty zaległymi powtórkami (do zdanego testu powtórkowego).';

/**
 * Stan bramki dla strony: czy stoi, ile słówek czeka i w którą lekcję wejść.
 *
 * Bez `security definer` — dane i tak chronią polityki `*_read`, a wejście sprawdzamy jawnie,
 * bo funkcje liczące pod spodem są `security definer` (tak samo jak w `child_lessons`).
 */
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
    'triedToday', public.review_gate_tried_today(p_course, v_user)
  );
end;
$fn$;

-- 3. Dobór zadań. Dochodzi zasięg kursu — reszta przepisana z `…_lesson_levels.sql`.
--
-- Powtórka działu bierze wszystko, co dziecko w dziale widziało (zaległe pierwsze), bo jest
-- ćwiczeniem do woli. Test powtórkowy bierze WYŁĄCZNIE zaległe, najbardziej spóźnione pierwsze:
-- ma zdjąć blokadę, a blokada liczy właśnie zaległe.
create or replace function public.pick_review_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with scope as (
    select l.review_scope_unit_id as unit_id, l.review_scope_course_id as course_id
    from public.lessons l
    where l.id = p_lesson and l.kind = 'review'
  ),
  w_zasiegu as (
    select distinct li.concept_id
      from public.lesson_items li
      join public.lessons l on l.id = li.lesson_id
      join public.units u on u.id = l.unit_id
     where case
             when (select course_id from scope) is not null then u.course_id = (select course_id from scope)
             else l.unit_id = (select unit_id from scope)
           end
  ),
  due as (
    select s.concept_id,
           -- Zaległe idą pierwsze, potem te, na których dziecko się najczęściej myli.
           case when s.due_on <= current_date then 0 else 1 end as priority,
           s.due_on,
           s.lapses
      from public.srs_state s
     where s.user_id = p_user
       and s.concept_id in (select concept_id from w_zasiegu)
       and ((select course_id from scope) is null or s.due_on <= current_date)
  ),
  wybrane as (
    select distinct on (d.concept_id) ex.id as exercise_id, d.concept_id, d.priority, d.due_on, d.lapses
      from due d
      join public.exercises ex on ex.concept_id = d.concept_id and ex.is_active
      join public.lessons el on el.id = ex.lesson_id
      join public.units eu on eu.id = el.unit_id
     where case
             when (select course_id from scope) is not null then eu.course_id = (select course_id from scope)
             else el.unit_id = (select unit_id from scope)
           end
     order by d.concept_id, random()
  )
  -- W teście wszystkie słówka są zaległe, więc `priority` byłoby u każdego zerem, a o tym, które
  -- dwanaście wejdzie do testu, decydowałby identyfikator zadania — czyli stale te same słówka.
  -- Stąd numerowanie po terminie: najdłużej zaległe pierwsze.
  select w.exercise_id, w.concept_id,
         case
           when (select course_id from scope) is not null
             then (row_number() over (order by w.due_on, w.lapses desc, w.concept_id))::integer
           else w.priority
         end
    from wybrane w;
$fn$;

-- 4. Zadanie z zasięgu. Dochodzi kurs — reszta przepisana z `…_unit_test.sql`.
create or replace function public.exercise_allowed_in_lesson(p_exercise uuid, p_lesson uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when l.review_scope_course_id is not null then exists (
      select 1 from public.exercises ex
      join public.lessons el on el.id = ex.lesson_id
      join public.units eu on eu.id = el.unit_id
      where ex.id = p_exercise and eu.course_id = l.review_scope_course_id
    )
    when l.kind in ('review', 'test') then exists (
      select 1 from public.exercises ex
      join public.lessons el on el.id = ex.lesson_id
      where ex.id = p_exercise and el.unit_id = l.review_scope_unit_id
    )
    else exists (select 1 from public.exercises ex where ex.id = p_exercise and ex.lesson_id = p_lesson)
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

-- 5. Otwarcie lekcji. Dochodzi bramka powtórek — reszta przepisana
-- z `…_admin_learns_as_child.sql`.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
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
  'Czy lekcja jest dla tego ucznia otwarta: bramka zaległych powtórek, otwarty dział, a w nim '
  'warunek wstępny lekcji (test działu czeka na komplet lekcji).';

-- 6. Test powtórkowy powstaje sam przy pierwszym słówku w kursie — jak test działu.
--
-- Stoi w pierwszym dziale kursu, bo lekcja musi gdzieś wisieć (`lessons.unit_id` jest wymagane),
-- a pierwszy dział nigdy nie jest zamknięty testem poprzedniego. Na ekranie kursu dziecko widzi go
-- osobno, nad działami, nie jako kafelek tamtego działu.
create or replace function public.add_review_test()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_course uuid;
  v_unit   uuid;
begin
  select u.course_id into v_course
    from public.lessons l
    join public.units u on u.id = l.unit_id
   where l.id = new.lesson_id;
  if v_course is null then
    return new;
  end if;

  if exists (select 1 from public.lessons t where t.review_scope_course_id = v_course) then
    return new;
  end if;

  select u.id into v_unit
    from public.units u
   where u.course_id = v_course
   order by u.sort_order, u.id
   limit 1;
  if v_unit is null then
    return new;
  end if;

  insert into public.lessons (
    unit_id, slug, title, icon, kind, sort_order, review_scope_course_id, xp_reward, is_published
  )
  values (v_unit, 'test-powtorkowy', 'Test powtórkowy', '🔁', 'review', 200, v_course, 40, true)
  on conflict (unit_id, slug) do nothing;

  return new;
end;
$fn$;

drop trigger if exists lesson_items_review_test on public.lesson_items;
create trigger lesson_items_review_test
  after insert on public.lesson_items
  for each row execute function public.add_review_test();

-- 7. Kursy, które już mają słówka, dostają test od razu — bez tego bramka nie dotyczyłaby
-- ani jednego istniejącego kursu.
insert into public.lessons (
  unit_id, slug, title, icon, kind, sort_order, review_scope_course_id, xp_reward, is_published
)
select distinct on (u.course_id)
       u.id, 'test-powtorkowy', 'Test powtórkowy', '🔁', 'review', 200, u.course_id, 40, true
  from public.units u
 where exists (
         select 1 from public.lesson_items li
         join public.lessons l on l.id = li.lesson_id
         join public.units cu on cu.id = l.unit_id
         where cu.course_id = u.course_id
       )
   and not exists (select 1 from public.lessons t where t.review_scope_course_id = u.course_id)
 order by u.course_id, u.sort_order, u.id
on conflict (unit_id, slug) do nothing;

-- 8. Nadania.

revoke execute on function public.course_due_words(uuid, uuid) from anon, public;
revoke execute on function public.review_gate_lesson(uuid) from anon, public;
revoke execute on function public.review_gate_passed_today(uuid, uuid) from anon, public;
revoke execute on function public.review_gate_tried_today(uuid, uuid) from anon, public;
revoke execute on function public.review_gate_on(uuid, uuid) from anon, public;
revoke execute on function public.review_gate(uuid, uuid) from anon, public;
revoke execute on function public.add_review_test() from anon, public;

grant execute on function public.review_gate_limit() to authenticated;
grant execute on function public.course_due_words(uuid, uuid) to authenticated;
grant execute on function public.review_gate_lesson(uuid) to authenticated;
grant execute on function public.review_gate_passed_today(uuid, uuid) to authenticated;
grant execute on function public.review_gate_tried_today(uuid, uuid) to authenticated;
grant execute on function public.review_gate_on(uuid, uuid) to authenticated;
grant execute on function public.review_gate(uuid, uuid) to authenticated;
