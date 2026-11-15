-- Licznik słówek na kafelku lekcji.
--
-- Powtórka nie ma pozycji w `lesson_items`, więc dotąd pokazywała „0 słówek”, co dla dziecka
-- znaczy „nie ma tu nic do roboty”. Powinna pokazywać, ile słówek czeka na powtórzenie — a to
-- liczba inna dla każdego dziecka i zmienna w czasie.

-- `create or replace view` nie potrafi zmienić typu kolumny (tu: bigint z `count(*)` na
-- integer), więc widok trzeba usunąć i założyć od nowa.
drop view if exists public.v_my_lessons;

create view public.v_my_lessons with (security_invoker = on) as
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
  end as word_count
from public.lessons l
left join public.lesson_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid())
where l.is_published;

grant select on public.v_my_lessons to authenticated;
