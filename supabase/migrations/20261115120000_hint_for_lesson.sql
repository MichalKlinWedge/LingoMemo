-- Dodatkowa podpowiedź za ukończoną lekcję.
--
-- Pula pięciu podpowiedzi na dobę nie odróżniała dziecka, które dziś przerobiło trzy lekcje,
-- od tego, które weszło do aplikacji i od razu utknęło. Każda lekcja zaliczona DZISIAJ dokłada
-- do dzisiejszej puli jedną podpowiedź.
--
-- Liczymy to tak samo jak zużycie: z tego, co w bazie już jest (`lesson_progress.completed_at`),
-- a nie licznikiem, który trzeba dopisywać i zerować. Dlatego:
--   * nie ma czego przyznawać w `finish_lesson_session` ani cofać, gdy coś pójdzie nie tak;
--   * dokładka znika o północy w strefie dziecka razem z resztą puli, bez zadania w cronie;
--   * powtórzenie tej samej lekcji nie daje drugiej podpowiedzi, bo `completed_at` ustawia się
--     raz, przy pierwszym zaliczeniu (`coalesce` w `finish_lesson_session`).
--
-- Odrzucone: kolumna `bonus_hints` w `profiles` dopisywana przy zaliczeniu lekcji (trzeba by ją
-- zerować o północy — czyli dokładnie ten cron, którego migracja z podpowiedziami unikała);
-- liczenie z `lesson_sessions` skończonych dzisiaj (ta sama łatwa lekcja powtórzona pięć razy
-- to pięć podpowiedzi); doliczanie wejść na poziom średni i trudny (to nie jest „ukończona
-- lekcja", tylko dobrowolna dokładka do już zaliczonej).

/**
 * Ile podpowiedzi dziecko dołożyło sobie dzisiaj lekcjami: jedna za każdą zaliczoną dziś.
 *
 * Bez nadania dla `authenticated`: wołają to `hints_left` i `hint_status`, które same pilnują,
 * o czyje konto wolno pytać. Gołe nadanie pozwalałoby policzyć cudze lekcje z dzisiaj.
 */
create or replace function public.hint_bonus(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select count(*)::integer
    from public.lesson_progress lp
   where lp.user_id = p_user
     and lp.status = 'completed'
     and lp.completed_at is not null
     and (lp.completed_at at time zone coalesce(
            (select p.time_zone from public.profiles p where p.id = p_user),
            'Europe/Warsaw'))::date = public.learner_today(p_user);
$fn$;

/** Ile podpowiedzi zostało dziecku na dziś: pula dzienna plus dokładka za dzisiejsze lekcje. */
create or replace function public.hints_left()
returns integer
language sql
stable
security definer
set search_path = ''
as $fn$
  select greatest(
    public.hint_limit()
      + public.hint_bonus((select auth.uid()))
      - (
        select count(*)
          from public.hint_uses h
         where h.user_id = (select auth.uid())
           and h.used_on = public.learner_today((select auth.uid()))
      ),
    0
  )::integer;
$fn$;

/**
 * Stan dziennej puli: własnej albo — dla administratora — cudzej. Dokładka za lekcje jedzie
 * osobnym polem, bo w karcie ucznia „5" obok „zostało 7" wyglądałoby na pomyłkę.
 */
create or replace function public.hint_status(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_me    uuid := (select auth.uid());
  v_today date;
  v_used  integer;
  v_bonus integer;
begin
  if v_me is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if p_user is distinct from v_me and not public.is_admin() then
    raise exception 'To nie jest twoje konto' using errcode = '42501';
  end if;

  v_today := public.learner_today(p_user);

  select count(*) into v_used
    from public.hint_uses h
   where h.user_id = p_user and h.used_on = v_today;

  v_bonus := public.hint_bonus(p_user);

  return jsonb_build_object(
    'limit', public.hint_limit(),
    'bonus', v_bonus,
    'usedToday', v_used,
    'left', greatest(public.hint_limit() + v_bonus - v_used, 0),
    -- Data w strefie dziecka: po niej, a nie po zegarze rodzica, odnawia się pula.
    'today', v_today
  );
end;
$fn$;

revoke execute on function public.hint_bonus(uuid) from anon, public;
revoke execute on function public.hints_left() from anon, public;
revoke execute on function public.hint_status(uuid) from anon, public;
grant execute on function public.hints_left() to authenticated;
grant execute on function public.hint_status(uuid) to authenticated;
