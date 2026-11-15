-- Stan podpowiedzi w karcie ucznia i oddanie puli przez rodzica.
--
-- Dziecko widzi licznik w lekcji, ale dorosły nie widział nic: ile podpowiedzi poszło dziś,
-- ile zostało, od kiedy liczy się doba tego dziecka. A gdy pula skończyła się nie z winy
-- dziecka (zepsute zadanie, pomyłka w treści), nie było jak jej oddać poza zapytaniem SQL.
--
-- `hints_left()` nie wystarczy: liczy dla tego, kto pyta, a tu pyta rodzic o cudze konto.
-- Stąd `hint_status(uczeń)` — własne konto albo administrator, nikt inny.

/** Stan dziennej puli podpowiedzi: własnej albo — dla administratora — cudzej. */
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

  return jsonb_build_object(
    'limit', public.hint_limit(),
    'usedToday', v_used,
    'left', greatest(public.hint_limit() - v_used, 0),
    -- Data w strefie dziecka: po niej, a nie po zegarze rodzica, odnawia się pula.
    'today', v_today
  );
end;
$fn$;

/**
 * Oddanie dzisiejszej puli. Kasujemy wpisy z DZISIAJ, a nie całą historię: wczorajsze użycia
 * są zapisem nauki i nie mają po co znikać, a i tak nie wpływają na dzisiejszą pulę.
 */
create or replace function public.admin_reset_hints(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  perform app_private.assert_admin();

  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'Nie ma takiego ucznia' using errcode = '22023';
  end if;

  delete from public.hint_uses h
   where h.user_id = p_user and h.used_on = public.learner_today(p_user);

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke execute on function public.hint_status(uuid) from anon, public;
revoke execute on function public.admin_reset_hints(uuid) from anon, public;
grant execute on function public.hint_status(uuid) to authenticated;
grant execute on function public.admin_reset_hints(uuid) to authenticated;
