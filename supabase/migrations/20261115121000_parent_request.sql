-- Prośba rodzica o przypisanie dziecka.
--
-- Rodzic po zalogowaniu widział komunikat „poproś administratora" i na tym się kończyło —
-- prośba musiała pójść inną drogą, poza aplikacją. Teraz zgłasza się sama: wejście na stronę
-- główną bez przypisanego dziecka zostawia ślad, który administrator widzi na liście kont.
--
-- Ślad nie jest powiadomieniem ani kolejką zadań. To jedna data przy koncie, kasowana w chwili
-- przypisania pierwszego dziecka — administrator ma wiedzieć „ten rodzic czeka", a nie odhaczać
-- zgłoszenia.

create table if not exists app_private.parent_requests (
  parent_id  uuid primary key references auth.users(id) on delete cascade,
  -- Kiedy poprosił pierwszy raz. To ta data mówi, jak długo czeka; `last_at` tylko potwierdza,
  -- że dalej próbuje wejść.
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now()
);

/**
 * Zgłoszenie prośby. Woła ją strona rodzica przy każdym wejściu — stąd `on conflict`.
 *
 * O tym, czy prośba ma sens, decyduje baza, nie przeglądarka: konto musi być rodzicem i nie mieć
 * ani jednego dziecka. Dzięki temu wywołanie z konta ucznia albo z konta rodzica, który dzieci
 * już ma, nie zostawia niczego.
 */
create or replace function public.request_child_access()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    return;
  end if;

  if not exists (select 1 from app_private.parent_users pu where pu.user_id = v_user) then
    return;
  end if;

  -- Rodzic, któremu dziecko przypisano, nie prosi o nic. Kasujemy też starą prośbę, gdyby
  -- została po tym, jak administrator przypisał i odpiął dziecko.
  if exists (select 1 from app_private.parent_children pc where pc.parent_id = v_user) then
    delete from app_private.parent_requests where parent_id = v_user;
    return;
  end if;

  insert into app_private.parent_requests (parent_id)
  values (v_user)
  on conflict (parent_id) do update set last_at = now();
end;
$fn$;

-- Panel potrzebuje teraz trzeciej kolumny, a typu zwracanego nie da się zmienić przez
-- `create or replace` — stąd drop.
drop function if exists public.admin_parents();

create or replace function public.admin_parents()
returns table (user_id uuid, children uuid[], requested_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  return query
    select pu.user_id,
           coalesce(
             (select array_agg(pc.child_id order by pc.added_at) from app_private.parent_children pc
               where pc.parent_id = pu.user_id),
             '{}'::uuid[]
           ),
           (select pr.first_at from app_private.parent_requests pr where pr.parent_id = pu.user_id)
      from app_private.parent_users pu;
end;
$fn$;

/**
 * Przypisanie dziecka kasuje prośbę — to jest jej załatwienie.
 *
 * Reszta ciała bez zmian względem `20261115110000_parent_role.sql`; funkcja jest przepisana
 * w całości, bo plpgsql nie pozwala dołożyć kroku do istniejącej.
 */
create or replace function public.admin_set_child(p_parent uuid, p_child uuid, p_linked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  if p_parent = p_child then
    raise exception 'Nie da się przypisać konta do samego siebie' using errcode = '22023';
  end if;

  if not exists (select 1 from app_private.parent_users pu where pu.user_id = p_parent) then
    raise exception 'To konto nie jest rodzicem' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_child) then
    raise exception 'Nie ma takiego konta' using errcode = '22023';
  end if;

  if p_linked then
    insert into app_private.parent_children (parent_id, child_id, added_by)
    values (p_parent, p_child, (select auth.uid()))
    on conflict do nothing;
    delete from app_private.parent_requests where parent_id = p_parent;
  else
    delete from app_private.parent_children where parent_id = p_parent and child_id = p_child;
  end if;
end;
$fn$;

revoke execute on function public.request_child_access() from anon, public;
revoke execute on function public.admin_parents() from anon, public;
grant execute on function public.request_child_access() to authenticated;
grant execute on function public.admin_parents() to authenticated;
