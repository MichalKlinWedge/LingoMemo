-- Losowa kolejność odpowiedzi na liście wyboru.
--
-- Zadania z `options` (tłumaczenie z listy, luka w zdaniu, wybór obrazka) wydawały listę
-- dokładnie w tej kolejności, w jakiej stała w `payload`. W lekcjach z importu poprawna
-- odpowiedź stoi w pliku pierwsza, więc dziecko po kilku zadaniach przestawało czytać listę
-- i dotykało pierwszego kafelka. Pary, dopasowanie ze słuchu i rozsypanka były tasowane od
-- początku — tylko lista wyboru została pominięta.
--
-- Tasujemy przy WYDAWANIU, a nie w `payload`: kolejność w bazie zostaje czytelna dla
-- administratora (poprawna odpowiedź w pliku importu może stać pierwsza), a dziecko dostaje
-- inny układ przy każdym wejściu do lekcji.
--
-- Funkcja przepisana w całości z `20261115094000_learner_level.sql` (`create or replace` nie zna
-- zmian cząstkowych). Względem tamtej wersji różni się JEDNĄ gałęzią `case` — tą od `options`.
-- Przy kolejnej zmianie tej funkcji porównaj ją z tą migracją, bo to ta nowsza wygrywa.

create or replace function public.get_lesson_exercises(p_lesson uuid, p_stage integer default 1)
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
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  -- Administrator widzi też lekcję przed publikacją — to jego podgląd roboczy.
  select l.kind into v_kind
    from public.lessons l
   where l.id = p_lesson and (l.is_published or public.is_admin());
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  v_stages := public.lesson_stage_count(p_lesson, v_user);
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  return query
  with picked as (
    select ex.id, ex.type, ex.concept_id, ex.points, ex.payload,
           case when v_kind = 'review' then r.priority else ex.sort_order end as ord
    from public.exercises ex
    left join public.pick_review_exercises(p_lesson, v_user) r on r.exercise_id = ex.id
    where ex.is_active
      and case when v_kind = 'review' then r.exercise_id is not null else ex.lesson_id = p_lesson end
      -- Poziom: powtórka jest już przefiltrowana w `pick_review_exercises`, zwykła lekcja
      -- filtruje się tutaj.
      and (v_kind = 'review'
           or ex.id in (select v.exercise_id from public.visible_exercises(p_lesson, v_user) v))
  ),
  chosen as (
    select p.*, row_number() over (order by p.ord, p.id) as nr
    from picked p
  ),
  visible as (
    select c.* from chosen c
    where c.nr <= case when v_kind = 'review' then public.review_limit() else 1000000 end
  ),
  staged as (
    -- `count(*) over ()` liczy dopiero to, co naprawdę trafi do dziecka — przy powtórce
    -- zestaw jest już przycięty do `review_limit()`.
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
