-- Kwadraciki poziomów były niewidoczne dla dziecka, a widoczne dla administratora.
--
-- `v_my_lesson_levels` ma `security_invoker = on` — i tak ma zostać, bo pokazuje postęp tego,
-- kto pyta. Ale kolumna `exercise_count` liczyła wiersze prosto z `public.exercises`, a ta tabela
-- NIE MA polityki SELECT dla ucznia (w payloadzie są klucze odpowiedzi). Dziecku liczba wychodziła
-- więc zawsze zero, mapa uznawała, że na średnim i trudnym nie ma czego robić, i nie rysowała
-- kwadracików. Administrator ma politykę `exercises_admin`, więc u niego wszystko było widać —
-- stąd „u mnie jest, u dziecka nie ma".
--
-- Liczenie idzie teraz przez funkcję `security definer`, dokładnie jak `lesson_exercise_count`
-- w `v_my_lessons`. Zadania dalej nie opuszczają bazy — na zewnątrz wychodzi sama liczba.

create or replace function public.level_exercise_count(p_lesson uuid, p_level smallint)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select count(*)::integer from public.lesson_exercises_at_level(p_lesson, p_level);
$fn$;

revoke execute on function public.level_exercise_count(uuid, smallint) from anon, public;
grant execute on function public.level_exercise_count(uuid, smallint) to authenticated;

-- Widok przepisany w całości z `20261115095000_lesson_levels.sql` — zmienia się wyłącznie
-- wyrażenie w kolumnie `exercise_count`.
create or replace view public.v_my_lesson_levels with (security_invoker = on) as
select
  l.id                                                   as lesson_id,
  lv.level                                               as level,
  public.is_level_unlocked(l.id, (select auth.uid()), lv.level) as is_unlocked,
  case when lv.level = 1 then coalesce(mp.status::text, 'new')
       else coalesce(lp.status::text, 'new') end         as status,
  case when lv.level = 1 then coalesce(mp.stars, 0)
       else coalesce(lp.stars, 0) end                    as stars,
  -- Ile zadań ma ten poziom w tej lekcji. Zero znaczy, że kwadracika nie ma po co pokazywać.
  public.level_exercise_count(l.id, lv.level)            as exercise_count
from public.lessons l
cross join (values (1::smallint), (2::smallint), (3::smallint)) as lv(level)
left join public.lesson_progress mp
       on mp.lesson_id = l.id and mp.user_id = (select auth.uid())
left join public.lesson_level_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid()) and lp.level = lv.level
where l.is_published and l.kind <> 'review';

grant select on public.v_my_lesson_levels to authenticated;
