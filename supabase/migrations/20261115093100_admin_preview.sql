-- Podgląd lekcji oczami dziecka dla administratora.
--
-- Przycisk „Zobacz lekcję oczami dziecka" w panelu kończył się kłódką i komunikatem „Ta lekcja
-- jest jeszcze zamknięta", gdy lekcja miała warunek wstępny albo była powtórką: `is_lesson_unlocked`
-- pyta o postępy TEGO użytkownika, a administrator żadnej lekcji nie zaliczał i nie ma po co.
--
-- Warunek wstępny jest dla dziecka, nie dla osoby układającej lekcję. Dla administratora
-- funkcja odpowiada więc „otwarte", ale tylko wtedy, gdy pyta o siebie: `p_user` bywa cudzy
-- (podgląd postępów ucznia), a wtedy odpowiedź ma mówić o tamtym dziecku, nie o oglądającym.
--
-- Czego to NIE zmienia: lekcja nieopublikowana dalej nie wejdzie, bo tego pilnuje osobny warunek
-- `l.is_published` w `get_lesson_exercises` i `start_lesson_session`.

create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when p_user = (select auth.uid()) and public.is_admin() then true
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
  'Czy lekcja jest dla tego ucznia otwarta. Administrator pytający o siebie ma otwarte wszystko '
  '— warunek wstępny jest dla dziecka, nie dla osoby, która lekcję układa.';
