-- Kolejność zadań w lekcji: pomieszana, a nie blokami po typie.
--
-- Pliki treści są pisane typami: najpierw wszystkie tłumaczenia w jedną stronę, potem w drugą,
-- potem dopasowanki, na końcu zdania z luką. `admin_import_lesson` nadaje `sort_order` po
-- kolejności w pliku, a łatwy poziom wydawał zadania dokładnie w tej kolejności — więc dziecko
-- dostawało czternaście tłumaczeń z rzędu, potem sześć następnych, i tak dalej. Przy lekcji
-- podzielonej na etapy wychodziło z tego jeszcze gorzej: cały etap bywał jednym typem zadania.
--
-- Kolejność liczy teraz `exercise_order` — skrót md5 identyfikatora zadania przerobiony na
-- liczbę. Wygląda jak losowa i nie ma nic wspólnego z typem ani z kolejnością w pliku, ale dla
-- danego zadania jest zawsze ta sama.
--
-- Dlaczego nie `order by random()`: lekcja pyta o zadania DWA razy — raz renderuje je strona,
-- raz zapisuje migawkę `start_lesson_session` (`20261115094200_session_exercise_snapshot.sql`).
-- Przy losowaniu per wywołanie obie listy byłyby inne, a przy lekcji z etapami różniłby się
-- nawet ZBIÓR zadań etapu — czyli dokładnie ten błąd („Zadanie należy do innego etapu lekcji"),
-- przed którym migawka miała chronić. Poziom średni i trudny losuje przy każdym wywołaniu,
-- bo tam migawki nie ma i etapów nie ma.
--
-- Dlaczego kolejność nie zależy od dziecka: wtedy `exercise_stage` musiałoby zaglądać
-- w `auth.uid()` i dwa wywołania z różnych kontekstów (podgląd administratora, skrypt)
-- dawałyby inny podział na etapy niż ten, który zobaczyło dziecko. Za drobny zysk.
--
-- Odrzucone też: przestawienie zadań w plikach treści (dziesiątki plików, a następny import
-- i tak wróciłby do układu typami) oraz przeplatanie typów po równo (sztuczny rytm — dziecko
-- szybko się uczy, że po tłumaczeniu zawsze jest dopasowanka).

/**
 * Pseudolosowa, ale stała pozycja zadania w lekcji. md5 jest niezmienne, więc ta sama lekcja
 * ułoży się identycznie przy każdym wywołaniu i w każdej replice bazy.
 */
create or replace function public.exercise_order(p_exercise uuid)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select ('x' || pg_catalog.substr(pg_catalog.md5(p_exercise::text), 1, 8))::bit(32)::integer;
$fn$;

comment on function public.exercise_order(uuid) is
  'Stała, pseudolosowa pozycja zadania w lekcji — żeby zadania nie szły blokami po typie.';

revoke execute on function public.exercise_order(uuid) from anon, public;
grant execute on function public.exercise_order(uuid) to authenticated;
-- Etap zadania musi liczyć się na TEJ SAMEJ kolejności, w której zadania wychodzą do dziecka.
-- Reszta ciała przepisana z `20261115095000_lesson_levels.sql`.
create or replace function public.exercise_stage(p_exercise uuid, p_lesson uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  with numbered as (
    select ex.id,
           row_number() over (order by public.exercise_order(ex.id), ex.id) as nr,
           count(*) over ()                                                 as total
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.id in (select v.exercise_id from public.lesson_exercises_at_level(p_lesson, 1::smallint) v)
  )
  select (((n.nr - 1) * greatest(ceil(n.total::numeric / public.stage_size())::integer, 1)) / n.total + 1)::integer
    from numbered n
   where n.id = p_exercise;
$fn$;

-- Wydawanie zadań. Zmienia się jedna linia — wyrażenie porządkujące poziom łatwy — ale
-- `create or replace` nie zna zmian cząstkowych, więc ciało idzie w całości
-- z `20261116090000_admin_learns_as_child.sql` (razem z `p_preview`).
--
-- Wersja z trzema parametrami zniknęła razem z `p_preview`; ten `drop` jest po to, żeby w bazie
-- zaktualizowanej migracjami w innej kolejności nie zostały dwie funkcje o tej samej nazwie.
drop function if exists public.get_lesson_exercises(uuid, integer, smallint);

create or replace function public.get_lesson_exercises(
  p_lesson uuid,
  p_stage integer default 1,
  p_level smallint default 1,
  -- Podgląd z panelu. Działa tylko dla administratora i tylko wtedy, gdy przeglądarka
  -- poprosi o niego wprost — ucząc się normalnie, administrator ma zamki jak dziecko.
  p_preview boolean default false
)
returns table (
  id         uuid,
  type       public.exercise_type,
  sort_order integer,
  concept_id uuid,
  points     integer,
  payload    jsonb
)
language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v_user   uuid := (select auth.uid());
  v_kind   public.lesson_kind;
  v_stages integer;
  v_level  smallint := coalesce(p_level, 1);
  v_preview boolean := coalesce(p_preview, false) and public.is_admin();
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if v_level < 1 or v_level > 3 then
    raise exception 'Poziom to 1, 2 albo 3' using errcode = '22023';
  end if;

  -- Administrator widzi też lekcję przed publikacją — to jego podgląd roboczy.
  select l.kind into v_kind
    from public.lessons l
   where l.id = p_lesson and (l.is_published or v_preview);
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not v_preview and not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  -- Powtórka i test mają własny dobór zadań i własną trudność — poziomów się do nich
  -- nie stosuje.
  if v_kind in ('review', 'test') then
    v_level := 1;
  end if;

  if v_level > 1 and not public.is_level_unlocked(p_lesson, v_user, v_level) and not v_preview then
    raise exception 'Najpierw przejdź tę lekcję na poziomie łatwym' using errcode = '42501';
  end if;

  -- Etapy ma tylko poziom łatwy: trudniejsze wejście to osiem zadań, czyli jeden kawałek.
  v_stages := case when v_level > 1 then 1 else public.lesson_stage_count(p_lesson, v_user) end;
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  return query
  with picked as (
    select ex.id, ex.type, ex.concept_id, ex.points, ex.payload,
           case
             when v_kind = 'review' then r.priority
             when v_kind = 'test' then t.priority
             when v_level > 1 then h.priority
             -- Zamiast kolejności z pliku treści: patrz nagłówek tego pliku.
             else public.exercise_order(ex.id)
           end as ord
    from public.exercises ex
    left join public.pick_review_exercises(p_lesson, v_user) r on r.exercise_id = ex.id
    left join public.pick_test_exercises(p_lesson, v_user) t on t.exercise_id = ex.id
    left join public.pick_level_exercises(p_lesson, v_level) h on h.exercise_id = ex.id
    where ex.is_active
      and case
            when v_kind = 'review' then r.exercise_id is not null
            when v_kind = 'test' then t.exercise_id is not null
            when v_level > 1 then h.exercise_id is not null
            else ex.lesson_id = p_lesson
                 and ex.id in (select v.exercise_id
                                 from public.lesson_exercises_at_level(p_lesson, 1::smallint) v)
          end
  ),
  chosen as (
    select p.*, row_number() over (order by p.ord, p.id) as nr
    from picked p
  ),
  visible as (
    select c.* from chosen c
    where c.nr <= case
                    when v_kind = 'review' then public.review_limit()
                    when v_kind = 'test' then public.test_limit()
                    else 1000000
                  end
  ),
  staged as (
    -- `count(*) over ()` liczy dopiero to, co naprawdę trafi do dziecka — przy powtórce
    -- i teście zestaw jest już przycięty do swojego limitu.
    select v.*, (((v.nr - 1) * v_stages) / count(*) over () + 1)::integer as stage
    from visible v
  )
  select
    s.id, s.type, s.nr::integer, s.concept_id, s.points,
    case s.type
      when 'match_pairs' then jsonb_build_object(
        'instruction', s.payload -> 'instruction',
        'pairsLeft',  (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p),
        'pairsRight', (select jsonb_agg(p ->> 'b' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p)
      )
      when 'listen_match' then jsonb_build_object(
        'instruction', s.payload -> 'instruction',
        'lang', s.payload -> 'lang',
        'audio', (
          select jsonb_agg(jsonb_build_object('text', p ->> 'b', 'audioPath', p -> 'audioPath') order by random())
            from jsonb_array_elements(s.payload -> 'pairs') p
        ),
        'words', (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p)
      )
      when 'sentence_order' then jsonb_build_object(
        'prompt', s.payload -> 'prompt',
        'tokens', (select jsonb_agg(t order by random()) from jsonb_array_elements(s.payload -> 'tokens') t)
      )
      -- Lista wyboru w losowej kolejności. `jsonb_agg(... order by random())` układa ją od nowa
      -- przy każdym wydaniu zadania, więc poprawna odpowiedź nie siedzi stale na pierwszym
      -- miejscu. Zadania bez `options` (pisane, ze słuchu) idą dalej bez zmian.
      else case
        when s.payload ? 'options' then
          (s.payload - 'accepted' - 'answer' - 'solution')
            || jsonb_build_object('options', (
                 select jsonb_agg(o order by random()) from jsonb_array_elements(s.payload -> 'options') o
               ))
        else s.payload - 'accepted' - 'answer' - 'solution'
      end
    end
  from staged s
  where s.stage = coalesce(p_stage, 1)
  order by s.nr;
end;
$fn$;

revoke execute on function public.exercise_stage(uuid, uuid) from anon, public;
revoke execute on function public.get_lesson_exercises(uuid, integer, smallint, boolean) from anon, public;
grant execute on function public.exercise_stage(uuid, uuid) to authenticated;
grant execute on function public.get_lesson_exercises(uuid, integer, smallint, boolean) to authenticated;
