-- Język kursu w widoku postępów: na liście kursów stoi flaga, a nie ikona z tabeli.
-- Ikona kursu bywa emoji flagą (🇬🇧), której Windows nie rysuje — pokazuje napis „GB".
-- Flagę rysuje komponent `Flag` z pliku SVG, ale potrzebuje kodu języka, którego widok
-- dotąd nie wydawał. Nowa kolumna idzie na koniec, bo `create or replace view` inaczej
-- nie przyjmie zmiany.
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
  e.started_at as enrolled_at,
  c.target_lang as course_target_lang
from public.enrollments e
join public.courses c on c.id = e.course_id;

comment on view public.v_my_courses is
  'Postępy dziecka w rozbiciu na kursy, po wierszu na zapis. Widoczność jak w v_my_stats.';

grant select on public.v_my_courses to authenticated;
