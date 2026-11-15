-- Zmiana kolejności działów w kursie.
--
-- To samo co `admin_reorder_lessons`, piętro wyżej: cała nowa kolejność wchodzi jednym
-- wywołaniem, bo numery trzeba przepisać wszystkim działom kursu w jednej transakcji.
-- Przy osobnych zapytaniach błąd w połowie zostawiłby dwa działy na tej samej pozycji,
-- a mapa kursu układa je po tej kolumnie.

create or replace function public.admin_reorder_units(p_course uuid, p_ids uuid[])
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

  select count(*) into v_wszystkie from public.units u where u.course_id = p_course;
  if v_wszystkie = 0 then
    raise exception 'Kurs nie ma działów albo nie istnieje' using errcode = '22023';
  end if;

  if v_podane <> v_wszystkie then
    raise exception 'Nowa kolejność musi wymieniać wszystkie działy kursu' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(p_ids) as id
     where id not in (select u.id from public.units u where u.course_id = p_course)
  ) then
    raise exception 'Któryś z działów nie należy do tego kursu' using errcode = '22023';
  end if;

  if (select count(distinct id) from unnest(p_ids) as id) <> v_podane then
    raise exception 'Ten sam dział podany dwa razy' using errcode = '22023';
  end if;

  update public.units u
     set sort_order = nowa.pozycja
    from (select id, row_number() over () as pozycja from unnest(p_ids) as id) nowa
   where u.id = nowa.id;

  return jsonb_build_object('units', v_podane);
end;
$fn$;

comment on function public.admin_reorder_units(uuid, uuid[]) is
  'Przepisuje sort_order działom kursu według podanej listy identyfikatorów. '
  'Lista musi obejmować wszystkie działy kursu i tylko je.';

revoke execute on function public.admin_reorder_units(uuid, uuid[]) from anon, public;
grant execute on function public.admin_reorder_units(uuid, uuid[]) to authenticated;
