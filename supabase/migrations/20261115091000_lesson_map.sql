-- Ekran kursu: zamknięte lekcje mają być WIDOCZNE, tylko niedostępne.
--
-- Pierwotnie polityka na `lessons` ukrywała lekcje, których uczeń jeszcze nie odblokował.
-- Dla bezpieczeństwa to było szczelne, ale dla dziecka bez sensu: ekran kursu pokazywałby jedną
-- lekcję i pustkę, zamiast ścieżki z kłódkami, po której widać, co jeszcze przed nim. Tytuł
-- lekcji nie jest tajemnicą — tajemnicą są zadania i poprawne odpowiedzi, a tych pilnują
-- osobne mechanizmy: `exercises` nie ma polityki SELECT dla ucznia, a `get_lesson_exercises`
-- i `start_lesson_session` nadal odmawiają dostępu do zamkniętej lekcji.

drop policy if exists lessons_read on public.lessons;

create policy lessons_read on public.lessons
  for select to authenticated
  using (
    public.is_admin()
    or (
      is_published
      and exists (
        select 1 from public.units u
        join public.courses c on c.id = u.course_id
        where u.id = lessons.unit_id and u.is_published and c.is_published
      )
    )
  );

-- Lista lekcji dla zalogowanego ucznia: stan otwarcia i postęp w jednym zapytaniu.
-- `security_invoker`: widok dziedziczy RLS tabel bazowych, więc uczeń widzi wyłącznie swój
-- postęp, a nie cudzy.
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
  (select count(*) from public.lesson_items li where li.lesson_id = l.id) as word_count
from public.lessons l
left join public.lesson_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid())
where l.is_published;

grant select on public.v_my_lessons to authenticated;
