-- Biblioteka mediów: wiedza o tym, gdzie używany jest plik, i obrazek przy słówku z panelu.
--
-- Strona „Obrazki" była wgrywarką bez pamięci: po wgraniu pokazywała ścieżki do skopiowania
-- i tyle. Po odświeżeniu nie było widać nic, bucket rósł w nieskończoność, a jedyną drogą
-- przypisania obrazka do słówka był plik importu. Dwie rzeczy, których brakowało bazie, żeby
-- zrobić z tego bibliotekę:
--
--   1. `media_usage` — czy plik jest gdzieś użyty. Bez tego kasowanie w bibliotece to ruletka:
--      administrator widzi nazwę pliku, a nie to, że wisi na nim zadanie „wskaż obrazek".
--      Kasowanie samego pliku ze Storage nie rusza wierszy, które go wskazują, więc dziecko
--      zobaczyłoby pusty kafelek — i właśnie dlatego pytamy PRZED skasowaniem.
--   2. `admin_set_concept_image` — przypisanie obrazka do słówka bez importu.
--
-- Odrzucone: tabela z rejestrem plików obok Storage (dwa źródła prawdy, które rozjeżdżają się
-- przy pierwszym wgraniu spoza panelu); kasowanie kaskadowe (plik zniknąłby razem z treścią
-- zadania, a to już nie jest sprzątanie, tylko kasowanie lekcji); zakaz kasowania użytych
-- plików (czasem właśnie o to chodzi, że obrazek był zły — wtedy ostrzeżenie wystarczy).

/**
 * Gdzie używany jest plik z `lesson-media`. Po wierszu na zapytaną ścieżkę, także dla tych,
 * których nic nie używa — brak wiersza znaczyłby „nie wiem", a ma znaczyć „zero".
 */
create or replace function public.media_usage(p_paths text[])
returns table (path text, concepts integer, exercises integer)
language sql stable security definer set search_path = ''
as $fn$
  select
    p.path,
    (select count(*)::integer from public.concepts c where c.image_path = p.path),
    (
      select count(*)::integer from public.exercises e
       where (e.payload -> 'options') ? p.path
          or (e.payload ->> 'answer') = p.path
          or (e.payload ->> 'audioPath') = p.path
    )
  from unnest(coalesce(p_paths, '{}')) as p(path);
$fn$;

comment on function public.media_usage(text[]) is
  'Ile słówek i zadań wskazuje każdą z podanych ścieżek w buckecie lesson-media.';

/**
 * Obrazek słówka ustawiany z panelu. Pusta ścieżka kasuje przypisanie — plik zostaje
 * w buckecie, bo może go używać coś jeszcze.
 */
create or replace function public.admin_set_concept_image(p_concept uuid, p_path text)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Tylko administrator' using errcode = '42501';
  end if;

  -- Ten sam wzorzec co w imporcie: ścieżka w buckecie, nie adres. Adres zmienia się razem
  -- z projektem w chmurze, ścieżka nie.
  if v_path is not null and v_path !~ '^[a-z0-9][a-z0-9._/-]*$' then
    raise exception 'To nie jest ścieżka pliku z panelu „Obrazki"' using errcode = '22023';
  end if;

  update public.concepts set image_path = v_path where id = p_concept;
  if not found then
    raise exception 'Nie ma takiego słówka' using errcode = '22023';
  end if;

  return jsonb_build_object('conceptId', p_concept, 'imagePath', v_path);
end;
$fn$;

revoke execute on function public.media_usage(text[]) from anon, public;
revoke execute on function public.admin_set_concept_image(uuid, text) from anon, public;
grant execute on function public.media_usage(text[]) to authenticated;
grant execute on function public.admin_set_concept_image(uuid, text) to authenticated;
