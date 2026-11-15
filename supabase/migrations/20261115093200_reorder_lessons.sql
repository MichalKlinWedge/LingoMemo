-- Zmiana kolejności lekcji w dziale.
--
-- Kolejność to `lessons.sort_order` i dotąd zmieniało się ją polem liczbowym w formularzu —
-- przy sześciu lekcjach znaczy to sześć zapisów i liczenie w głowie. Przeciągnięcie na liście
-- wysyła całą nową kolejność naraz, a tu jest jej zapis.
--
-- Dlaczego funkcja, a nie `update` z aplikacji: numery trzeba przepisać wszystkim lekcjom działu
-- w jednej transakcji. Seria osobnych zapytań zostawiłaby przy błędzie w połowie listę
-- z dwiema „trójkami", a mapa kursu układa lekcje właśnie po tej kolumnie.

create or replace function public.admin_reorder_lessons(p_unit uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_wszystkie integer;
  v_podane    integer := coalesce(array_length(p_ids, 1), 0);
begin
  perform app_private.assert_admin();

  select count(*) into v_wszystkie from public.lessons l where l.unit_id = p_unit;
  if v_wszystkie = 0 then
    raise exception 'Dział nie ma lekcji albo nie istnieje' using errcode = '22023';
  end if;

  -- Lista musi być kompletna i z tego działu. Inaczej część lekcji zostałaby ze starymi
  -- numerami i kolejność na mapie kursu wyszłaby losowa.
  if v_podane <> v_wszystkie then
    raise exception 'Nowa kolejność musi wymieniać wszystkie lekcje działu' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_ids) as id
     where id not in (select l.id from public.lessons l where l.unit_id = p_unit)
  ) then
    raise exception 'Któraś z lekcji nie należy do tego działu' using errcode = '22023';
  end if;

  if (select count(distinct id) from unnest(p_ids) as id) <> v_podane then
    raise exception 'Ta sama lekcja podana dwa razy' using errcode = '22023';
  end if;

  update public.lessons l
     set sort_order = nowa.pozycja
    from (select id, row_number() over () as pozycja from unnest(p_ids) as id) nowa
   where l.id = nowa.id;

  return jsonb_build_object('lessons', v_podane);
end;
$fn$;

comment on function public.admin_reorder_lessons(uuid, uuid[]) is
  'Przepisuje sort_order lekcjom działu według podanej listy identyfikatorów. '
  'Lista musi obejmować wszystkie lekcje działu i tylko je.';

revoke execute on function public.admin_reorder_lessons(uuid, uuid[]) from anon, public;
grant execute on function public.admin_reorder_lessons(uuid, uuid[]) to authenticated;
