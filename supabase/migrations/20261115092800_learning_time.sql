-- Czas nauki i statystyki dziecka w rozbiciu na kursy.
--
-- Czas liczymy z `lesson_sessions`: od `started_at` (wejście do lekcji) do `finished_at`
-- (odesłanie ostatniej odpowiedzi). Dwie rzeczy trzeba przy tym rozstrzygnąć:
--
-- 1. Sesje bez `finished_at` nie liczą się wcale. Dziecko zamknęło kartę w połowie lekcji —
--    nie wiadomo, czy uczyło się dwie minuty, czy odeszło od komputera na godzinę.
-- 2. Sesja dłuższa niż pół godziny liczy się jako pół godziny. Lekcja ma kilkanaście zadań,
--    więc pół godziny to i tak bardzo dużo; dłuższy wynik znaczy, że karta została otwarta,
--    a nie że dziecko tyle się uczyło. Bez tej czapki jedno zapomniane okno robi z tygodnia
--    nauki kilkanaście godzin i cała liczba przestaje cokolwiek znaczyć.
--
-- Widoki mają `security_invoker`, więc filtruje je RLS: dziecko widzi swój wiersz, a
-- administrator — wiersze wszystkich dzieci (polityki `*_read` dopuszczają `is_admin()`).
-- Dlatego panel nie potrzebuje tu funkcji `security definer`: ta sama nazwa widoku obsługuje
-- ekran dziecka i podgląd w panelu.

-- Pół godziny na sesję. Trzyma się tego i widok podsumowania, i widok kursów.
create or replace function public.session_seconds(p_started timestamptz, p_finished timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_finished is null then 0
    else least(greatest(extract(epoch from (p_finished - p_started)), 0), 1800)::integer
  end;
$fn$;

comment on function public.session_seconds(timestamptz, timestamptz) is
  'Czas jednej sesji lekcji w sekundach, przycięty do pół godziny. Sesja bez końca liczy się jako zero.';

-- Podsumowanie dla jednego dziecka. Dochodzą tu kolumny o czasie i celności — `create or
-- replace view` pozwala dopisywać kolumny tylko na końcu, więc kolejność pierwszych ośmiu
-- musi zostać taka, jaka była.
create or replace view public.v_my_stats with (security_invoker = on) as
select
  p.id as user_id,
  coalesce((select sum(pl.delta)::integer from public.points_ledger pl where pl.user_id = p.id), 0) as total_points,
  coalesce(us.streak_days, 0) as streak_days,
  coalesce(us.best_streak, 0) as best_streak,
  coalesce(us.lessons_done, 0) as lessons_done,
  (select count(*) from public.srs_state s where s.user_id = p.id)                        as words_seen,
  -- „Umiane” = stabilność co najmniej 21 dni, czyli przypomni się za trzy tygodnie.
  (select count(*) from public.srs_state s where s.user_id = p.id and s.stability >= 21)  as words_mastered,
  (select count(*) from public.srs_state s where s.user_id = p.id and s.due_on <= current_date) as words_due,
  (select count(*) from public.user_badges ub where ub.user_id = p.id)                    as badges_earned,
  -- Czas nauki łącznie i w ostatnich siedmiu dniach (tyle samo, co słupki na ekranie postępów).
  coalesce((
    select sum(public.session_seconds(s.started_at, s.finished_at))::integer
      from public.lesson_sessions s where s.user_id = p.id
  ), 0) as seconds_total,
  coalesce((
    select sum(public.session_seconds(s.started_at, s.finished_at))::integer
      from public.lesson_sessions s
     where s.user_id = p.id and s.started_at >= current_date - 6
  ), 0) as seconds_week,
  -- Dokończone podejścia do lekcji. Dzielnik dla średniego czasu jednej lekcji.
  (select count(*) from public.lesson_sessions s where s.user_id = p.id and s.finished_at is not null) as sessions_done,
  (select count(*) from public.attempts a where a.user_id = p.id)                         as answers_total,
  (select count(*) from public.attempts a where a.user_id = p.id and a.is_correct)        as answers_correct,
  (select min(s.started_at)::date from public.lesson_sessions s where s.user_id = p.id)   as first_active_on,
  us.last_active_on
from public.profiles p
left join public.user_stats us on us.user_id = p.id;

comment on view public.v_my_stats is
  'Podsumowanie postępów jednego dziecka. Dziecko widzi swój wiersz, administrator wiersze '
  'wszystkich — filtruje RLS, nie zapytanie.';

-- To samo w rozbiciu na kursy, po jednym wierszu na zapis dziecka na kurs. Lekcje liczymy
-- tylko opublikowane, żeby „5 z 12" znaczyło to samo na ekranie dziecka i w panelu.
create or replace view public.v_my_courses with (security_invoker = on) as
select
  e.user_id,
  c.id    as course_id,
  c.slug  as course_slug,
  c.title as course_title,
  c.icon  as course_icon,
  (
    select count(*) from public.lessons l
      join public.units u on u.id = l.unit_id
     where u.course_id = c.id and l.is_published and u.is_published
  ) as lessons_total,
  (
    select count(*) from public.lesson_progress lp
      join public.lessons l on l.id = lp.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = c.id and lp.user_id = e.user_id and lp.status = 'completed'
  ) as lessons_done,
  (select count(*) from public.srs_state s where s.user_id = e.user_id and s.course_id = c.id) as words_seen,
  (
    select count(*) from public.srs_state s
     where s.user_id = e.user_id and s.course_id = c.id and s.stability >= 21
  ) as words_mastered,
  (
    select count(*) from public.srs_state s
     where s.user_id = e.user_id and s.course_id = c.id and s.due_on <= current_date
  ) as words_due,
  coalesce((
    select sum(public.session_seconds(s.started_at, s.finished_at))::integer
      from public.lesson_sessions s
      join public.lessons l on l.id = s.lesson_id
      join public.units u on u.id = l.unit_id
     where s.user_id = e.user_id and u.course_id = c.id
  ), 0) as seconds_total,
  e.started_at as enrolled_at
from public.enrollments e
join public.courses c on c.id = e.course_id;

comment on view public.v_my_courses is
  'Postępy dziecka w rozbiciu na kursy, po wierszu na zapis. Widoczność jak w v_my_stats.';

grant select on public.v_my_courses to authenticated;

revoke execute on function public.session_seconds(timestamptz, timestamptz) from anon, public;
grant execute on function public.session_seconds(timestamptz, timestamptz) to authenticated;
