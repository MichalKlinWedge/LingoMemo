-- Etapy lekcji widoczne także dla rodzica.
--
-- `child_lessons` z `20261115130000` świadomie pomijała etapy: `lesson_stage_progress` jako jedyna
-- tabela postępu nie dostała w `20261115110000_parent_role.sql` klauzuli dla rodzica, więc etapy
-- wychodziły z niej jako zera. Dla długiej lekcji to jest jednak najważniejsza liczba na ekranie:
-- „zaczęta" nie mówi, czy dziecko zrobiło jeden etap z trzech, czy dwa z trzech.
--
-- Poszerzamy więc politykę dokładnie tak samo jak osiem pozostałych i dokładamy dwie kolumny.
-- Tabela jest dla ucznia tylko do odczytu (zapisuje ją `submit_attempt`), a rodzic dostaje
-- SELECT — do zapisu nie ma tu polityki dla nikogo, więc nic się nie otwiera.

alter policy lesson_stage_progress_read on public.lesson_stage_progress
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

-- Dołożenie kolumn do `returns table` wymaga `drop` — `create or replace` nie potrafi zmienić
-- kształtu wyniku.
drop function if exists public.child_lessons(uuid);

create or replace function public.child_lessons(p_child uuid)
returns table (
  lesson_id   uuid,
  unit_id     uuid,
  course_id   uuid,
  slug        text,
  title       text,
  icon        text,
  kind        public.lesson_kind,
  sort_order  integer,
  is_unlocked boolean,
  status      text,
  stars       integer,
  best_score  numeric,
  word_count  integer,
  stage_count integer,
  stages_done integer
)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if not (
    p_child = (select auth.uid())
    or public.is_admin()
    or p_child in (select public.my_child_ids())
  ) then
    raise exception 'To nie jest Twoje dziecko' using errcode = '42501';
  end if;

  return query
    select
      l.id, l.unit_id, u.course_id, l.slug, l.title, l.icon, l.kind, l.sort_order,
      public.is_lesson_unlocked(l.id, p_child),
      coalesce(lp.status::text, 'new'),
      coalesce(lp.stars::integer, 0),
      coalesce(lp.best_score, 0::numeric),
      -- Tak samo jak w `v_my_lessons`: powtórka nie ma własnych słówek, więc liczymy zadania,
      -- które naprawdę dostanie TO dziecko.
      case
        when l.kind = 'review' then public.lesson_exercise_count(l.id, p_child)
        else (select count(*)::integer from public.lesson_items li where li.lesson_id = l.id)
      end,
      public.lesson_stage_count(l.id, p_child),
      (select count(*)::integer
         from public.lesson_stage_progress sp
        where sp.lesson_id = l.id and sp.user_id = p_child and sp.status = 'completed')
    from public.lessons l
    join public.units u on u.id = l.unit_id
    left join public.lesson_progress lp on lp.lesson_id = l.id and lp.user_id = p_child
    where l.is_published
      and u.is_published
      -- Tylko kursy, na które dziecko jest zapisane. `v_my_lessons` wydaje wszystkie lekcje
      -- w bazie, bo mapa kursu i tak pyta o jeden kurs — tutaj pytamy o dziecko, więc to tu
      -- jest miejsce na odsianie kursów, które go nie dotyczą.
      and exists (
        select 1 from public.enrollments e
         where e.user_id = p_child and e.course_id = u.course_id
      )
    order by u.sort_order, l.sort_order;
end;
$fn$;

comment on function public.child_lessons(uuid) is
  'Lekcje jednego dziecka razem z nietkniętymi: status, gwiazdki, etapy i czy lekcja jest już '
  'otwarta. Dla samego dziecka, administratora i rodzica, któremu je przypisano.';

revoke execute on function public.child_lessons(uuid) from anon, public;
grant execute on function public.child_lessons(uuid) to authenticated;
