-- Statystyki całej aplikacji: widoki pod sekcję „Statystyki" w panelu.
--
-- Ekran postępów dziecka ma swoje widoki (`v_my_*`), ale wszystkie są po wierszu na dziecko.
-- Dorosły potrzebuje czegoś innego: ile się dzieje w całej aplikacji, który kurs stoi, kto się
-- uczy, a kto przestał, i na czym dzieci się przewracają. Policzenie tego w przeglądarce
-- znaczyłoby ściągnięcie historii wszystkich odpowiedzi wszystkich dzieci.
--
-- Widoki mają `security_invoker`, więc nie są „widokami administratora" — są widokami TEGO,
-- KTO PYTA. Polityki RLS tabel postępu dopuszczają `is_admin()` i rodzica do danych swoich
-- dzieci, więc ten sam `select` daje administratorowi całość, rodzicowi jego dzieci, a dziecku
-- jego własny wiersz. Osobne funkcje `security definer` dla panelu byłyby drugą ścieżką do tych
-- samych liczb i rozjechałyby się po pierwszej poprawce (ta sama decyzja co przy `v_my_*`).
--
-- Odrzucone: materializowane widoki (statystyki mają być aktualne po lekcji, a nie po
-- odświeżeniu; przy tej skali nie ma czego optymalizować); liczenie w aplikacji; osobne
-- funkcje `admin_stats_*` z `is_admin()` w środku.

-- 1. Jeden wiersz z całością. Każda liczba w osobnym podzapytaniu — inaczej złączenia
-- powieliłyby wiersze i „odpowiedzi" zależałyby od liczby sesji.
create or replace view public.v_stats_summary with (security_invoker = on) as
select
  (select count(distinct e.user_id) from public.enrollments e)                              as learners,
  (select count(distinct a.user_id) from public.attempts a
    where a.created_at >= current_date - 6)                                                 as learners_7d,
  (select count(*) from public.attempts)                                                    as answers,
  (select count(*) from public.attempts a where a.is_correct)                               as answers_correct,
  (select count(*) from public.lesson_progress lp where lp.status = 'completed')            as lessons_done,
  (select count(*) from public.srs_state)                                                   as words_seen,
  (select count(*) from public.srs_state s where s.stability >= 21)                         as words_mastered,
  (select count(*) from public.srs_state s where s.due_on <= current_date)                  as words_due,
  coalesce((
    select sum(public.session_seconds(s.started_at, s.finished_at))::integer
      from public.lesson_sessions s
  ), 0)                                                                                     as seconds_total;

comment on view public.v_stats_summary is
  'Podsumowanie dla panelu. Zakres zależy od pytającego: administrator widzi całość, rodzic '
  'swoje dzieci, dziecko siebie.';

-- 2. Aktywność dzienna z ostatnich 30 dni, zsumowana po wszystkich dzieciach.
create or replace view public.v_stats_daily with (security_invoker = on) as
select
  a.created_at::date                            as day,
  count(*)::integer                             as answers,
  count(*) filter (where a.is_correct)::integer as correct,
  count(distinct a.user_id)::integer            as learners
from public.attempts a
where a.created_at >= current_date - 29
group by a.created_at::date;

-- 3. Kursy: ile dzieci, ile lekcji zrobione i jak im idzie.
create or replace view public.v_stats_courses with (security_invoker = on) as
select
  c.id                                                                        as course_id,
  c.title                                                                     as course_title,
  c.target_lang,
  (select count(*) from public.enrollments e where e.course_id = c.id)        as learners,
  (
    select count(*) from public.lessons l
      join public.units u on u.id = l.unit_id
     where u.course_id = c.id and l.is_published and u.is_published
  )                                                                           as lessons_total,
  (
    select count(*) from public.lesson_progress lp
      join public.lessons l on l.id = lp.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = c.id and lp.status = 'completed'
  )                                                                           as lessons_done,
  (
    select count(distinct li.concept_id) from public.lesson_items li
      join public.lessons l on l.id = li.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = c.id
  )                                                                           as words,
  (select count(*) from public.srs_state s where s.course_id = c.id)          as words_started,
  (
    select count(*) from public.srs_state s
     where s.course_id = c.id and s.stability >= 21
  )                                                                           as words_mastered
from public.courses c;

-- 4. Typy zadań: ile odpowiedzi i jaka celność. Pokazuje, które zadanie jest dla dzieci
-- za trudne albo zepsute — jeden typ z celnością 30% to zwykle błąd w treści, nie w dziecku.
create or replace view public.v_stats_exercise_types with (security_invoker = on) as
select
  a.exercise_type,
  count(*)::integer                             as answers,
  count(*) filter (where a.is_correct)::integer as correct
from public.attempts a
group by a.exercise_type;

-- 5. Słówka, na których przewraca się najwięcej dzieci. Suma pomyłek z `srs_state`,
-- a nie z odpowiedzi: tam pomyłka jest już policzona raz na dziecko i słówko.
create or replace view public.v_stats_hard_words with (security_invoker = on) as
select
  s.concept_id,
  sum(s.lapses)::integer       as lapses,
  count(*)::integer            as learners,
  min(c.title)                 as course_title,
  (select t.text from public.terms t
    where t.concept_id = s.concept_id and t.lang = min(c.source_lang) and t.is_primary limit 1) as source_text,
  (select t.text from public.terms t
    where t.concept_id = s.concept_id and t.lang = min(c.target_lang) and t.is_primary limit 1) as target_text
from public.srs_state s
join public.courses c on c.id = s.course_id
where s.lapses > 0
group by s.concept_id;

grant select on
  public.v_stats_summary,
  public.v_stats_daily,
  public.v_stats_courses,
  public.v_stats_exercise_types,
  public.v_stats_hard_words
to authenticated;
