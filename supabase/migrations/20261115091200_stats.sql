-- Widoki pod ekran statystyk.
--
-- Grupowania po dniach ani sum nie da się poprosić przez PostgREST, a liczenie tego w aplikacji
-- oznaczałoby ściąganie całej historii odpowiedzi do przeglądarki. Wszystkie widoki mają
-- `security_invoker`, więc dziecko widzi wyłącznie swoje dane.

-- Podsumowanie w jednym wierszu.
create view public.v_my_stats with (security_invoker = on) as
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
  (select count(*) from public.user_badges ub where ub.user_id = p.id)                    as badges_earned
from public.profiles p
left join public.user_stats us on us.user_id = p.id;

-- Aktywność dzienna z ostatnich 30 dni: ile odpowiedzi i ile trafionych.
create view public.v_my_daily with (security_invoker = on) as
select
  a.user_id,
  a.created_at::date                               as day,
  count(*)::integer                                as answers,
  count(*) filter (where a.is_correct)::integer    as correct
from public.attempts a
where a.created_at >= current_date - 29
group by a.user_id, a.created_at::date;

-- Słówka, na których dziecko najczęściej się myli — z zapisem w obu językach.
create view public.v_my_weak_words with (security_invoker = on) as
select
  s.user_id,
  s.concept_id,
  s.lapses,
  s.stability,
  s.due_on,
  (select t.text from public.terms t
    join public.courses c on c.id = s.course_id
   where t.concept_id = s.concept_id and t.lang = c.source_lang and t.is_primary limit 1) as source_text,
  (select t.text from public.terms t
    join public.courses c on c.id = s.course_id
   where t.concept_id = s.concept_id and t.lang = c.target_lang and t.is_primary limit 1) as target_text
from public.srs_state s;

grant select on public.v_my_stats, public.v_my_daily, public.v_my_weak_words to authenticated;
