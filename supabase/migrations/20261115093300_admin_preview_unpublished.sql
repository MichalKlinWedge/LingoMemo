-- Podgląd lekcji NIEOPUBLIKOWANEJ dla administratora.
--
-- Migracja 093100 zdjęła kłódkę z warunku wstępnego, ale lekcja przed publikacją dalej witała
-- administratora komunikatem „Nie ma takiej lekcji": obie funkcje wejścia w lekcję sprawdzają
-- `l.is_published`. Dla dziecka tak ma zostać — nieopublikowana lekcja nie istnieje. Dla osoby,
-- która ją właśnie układa, podgląd przed publikacją jest całym sensem przycisku „Zobacz lekcję
-- oczami dziecka": inaczej trzeba opublikować lekcję, żeby ją sprawdzić, czyli pokazać dzieciom
-- coś niesprawdzonego.
--
-- Obie funkcje przepisane w całości z `20261115093000_lesson_stages.sql` — `create or replace`
-- nie zna zmian cząstkowych. Względem tamtej wersji różni się JEDEN warunek w każdej z nich:
-- `l.is_published` → `(l.is_published or public.is_admin())`. Przy kolejnej zmianie tych funkcji
-- porównaj je z tamtą migracją, bo to ta nowsza wygrywa.

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
      else s.payload - 'accepted' - 'answer' - 'solution'
    end
  from staged s
  where s.stage = coalesce(p_stage, 1)
  order by s.nr;
end;
$fn$;

create or replace function public.start_lesson_session(
  p_lesson uuid,
  p_idempotency_key text,
  p_stage integer default 1
)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
  v_stages  integer;
  v_total   integer;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  -- Jak wyżej: podgląd administratora wchodzi też w lekcję przed publikacją. Punkty i postęp
  -- zapisują się na jego własnym koncie, więc nie dotykają niczyjej nauki.
  if not exists (
    select 1 from public.lessons l
     where l.id = p_lesson and (l.is_published or public.is_admin())
  ) then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  v_stages := public.lesson_stage_count(p_lesson, v_user);
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  -- Klucz idempotencji jest nadawany na etap: przeglądarka losuje nowy przy wejściu w kolejny.
  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  -- Liczba zadań prosto z funkcji wydającej etap — jedno źródło podziału, zero rozjazdu.
  select count(*) into v_total from public.get_lesson_exercises(p_lesson, coalesce(p_stage, 1));

  insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises, stage_nr)
  values (v_user, p_lesson, p_idempotency_key, v_total, coalesce(p_stage, 1))
  returning id into v_session;

  return v_session;
end;
$fn$;

grant execute on function public.get_lesson_exercises(uuid, integer) to authenticated;
grant execute on function public.start_lesson_session(uuid, text, integer) to authenticated;
