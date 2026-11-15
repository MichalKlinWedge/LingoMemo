-- Dopasowywanie ze słuchu (`listen_match`) — nowy typ zadania.
--
-- To ta sama mechanika, co `match_pairs`, tylko lewa kolumna zamiast napisu ma głośnik: dziecko
-- słyszy słowo po angielsku i szuka polskiego odpowiednika. Dlatego payload, sposób tasowania
-- i sprawdzanie odpowiedzi są wspólne z parami — różni się to, co widać na ekranie.
--
-- Payload w bazie:
--   { "instruction": "...", "lang": "en-GB",
--     "pairs": [ { "a": "pies", "b": "dog", "audioPath": "..." }, ... ] }
-- gdzie `a` to słowo w języku dziecka (napis na kafelku), a `b` to słowo czytane głosem.
-- `audioPath` jest opcjonalne — nagranie ratuje przeglądarki bez głosu dla języka.
--
-- Trzy funkcje przepisane w całości: `create or replace` nie zna zmian cząstkowych, a starych
-- migracji nie wolno już edytować, bo są wgrane na produkcji.

-- 1. Walidacja payloadu. Pary ze słuchu sprawdzamy ostrzej niż `match_pairs`: tam zły kształt
-- pary widać od razu na ekranie, tu niemy głośnik wygląda jak awaria przeglądarki. Górny limit
-- to 6, nie 8 — tyle usłyszanych słów dziecko jest w stanie utrzymać w głowie naraz.
create or replace function public.validate_exercise_payload(t public.exercise_type, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case t
    when 'translate_ab' then
          jsonb_typeof(p -> 'prompt') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'translate_ba' then
          jsonb_typeof(p -> 'prompt') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'fill_blank_choice' then
          jsonb_typeof(p -> 'sentence') = 'string'
      and (p ->> 'sentence') like '%{{blank}}%'
      and jsonb_typeof(p -> 'options') = 'array'
      and jsonb_array_length(p -> 'options') between 2 and 6
      and jsonb_typeof(p -> 'answer') = 'string'
      and p -> 'options' @> jsonb_build_array(p -> 'answer')
    when 'inflection' then
          jsonb_typeof(p -> 'base') = 'string'
      and jsonb_typeof(p -> 'formLabel') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'listening' then
          jsonb_typeof(p -> 'speak') = 'string'
      and jsonb_typeof(p -> 'lang') = 'string'
      and jsonb_typeof(p -> 'accepted') = 'array'
      and jsonb_array_length(p -> 'accepted') >= 1
    when 'match_pairs' then
          jsonb_typeof(p -> 'pairs') = 'array'
      and jsonb_array_length(p -> 'pairs') between 3 and 8
    when 'listen_match' then
          jsonb_typeof(p -> 'lang') = 'string'
      and jsonb_typeof(p -> 'pairs') = 'array'
      and jsonb_array_length(p -> 'pairs') between 3 and 6
      and not exists (
        select 1 from jsonb_array_elements(p -> 'pairs') q
        where jsonb_typeof(q -> 'a') <> 'string' or jsonb_typeof(q -> 'b') <> 'string'
      )
    when 'sentence_order' then
          jsonb_typeof(p -> 'tokens') = 'array'
      and jsonb_typeof(p -> 'solution') = 'array'
      and jsonb_array_length(p -> 'tokens') = jsonb_array_length(p -> 'solution')
      and jsonb_array_length(p -> 'tokens') >= 2
    else false
  end;
$fn$;

-- 2. Wydanie zadań bez kluczy odpowiedzi. Obie kolumny tasujemy osobno — inaczej kolejność
-- w payloadzie byłaby rozwiązaniem. Tekst do przeczytania głosem musi pojechać do przeglądarki
-- (nie ma czego wymówić), ale rozwiązaniem jest PRZYPORZĄDKOWANIE, a tego w wydanym payloadzie
-- już nie widać.
create or replace function public.get_lesson_exercises(p_lesson uuid)
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
  v_user uuid := (select auth.uid());
  v_kind public.lesson_kind;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select l.kind into v_kind from public.lessons l where l.id = p_lesson and l.is_published;
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
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
  )
  select
    c.id, c.type, c.nr::integer, c.concept_id, c.points,
    case c.type
      when 'match_pairs' then jsonb_build_object(
        'instruction', c.payload -> 'instruction',
        'pairsLeft',  (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(c.payload -> 'pairs') p),
        'pairsRight', (select jsonb_agg(p ->> 'b' order by random()) from jsonb_array_elements(c.payload -> 'pairs') p)
      )
      when 'listen_match' then jsonb_build_object(
        'instruction', c.payload -> 'instruction',
        'lang', c.payload -> 'lang',
        'audio', (
          select jsonb_agg(jsonb_build_object('text', p ->> 'b', 'audioPath', p -> 'audioPath') order by random())
            from jsonb_array_elements(c.payload -> 'pairs') p
        ),
        'words', (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(c.payload -> 'pairs') p)
      )
      when 'sentence_order' then jsonb_build_object(
        'prompt', c.payload -> 'prompt',
        'tokens', (select jsonb_agg(t order by random()) from jsonb_array_elements(c.payload -> 'tokens') t)
      )
      else c.payload - 'accepted' - 'answer' - 'solution'
    end
  from chosen c
  where c.nr <= case when v_kind = 'review' then public.review_limit() else 1000 end
  order by c.nr;
end;
$fn$;

-- 3. Sprawdzanie odpowiedzi. Dopasowywanie ze słuchu ocenia się dokładnie jak pary — przychodzi
-- ta sama lista `{a, b}` — więc obsługuje je wspólna gałąź. Przy błędzie pokazujemy teraz komplet
-- par: samo „nie tym razem" po ośmiu dotknięciach niczego dziecka nie uczy.
create or replace function public.submit_attempt(
  p_session uuid,
  p_exercise uuid,
  p_answer jsonb,
  p_response_ms integer default null,
  p_hint_used boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user       uuid := (select auth.uid());
  v_ex         public.exercises%rowtype;
  v_lesson     uuid;
  v_course     uuid;
  v_tz         text;
  v_given      text;
  v_expected   text[];
  v_correct    boolean := false;
  v_near_miss  boolean := false;
  v_single_tap boolean;
  v_grade      smallint;
  v_shown      jsonb;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select s.lesson_id into v_lesson from public.lesson_sessions s
   where s.id = p_session and s.user_id = v_user and s.finished_at is null;
  if not found then
    raise exception 'Ta lekcja jest już zakończona' using errcode = '42501';
  end if;

  select * into v_ex from public.exercises ex where ex.id = p_exercise and ex.is_active;
  if not found then
    raise exception 'Nie ma takiego zadania' using errcode = '22023';
  end if;
  -- Dla powtórki zadanie pochodzi z innej lekcji tego samego działu — stąd osobna funkcja
  -- zamiast prostego porównania identyfikatorów.
  if not public.exercise_allowed_in_lesson(v_ex.id, v_lesson) then
    raise exception 'Zadanie nie należy do tej lekcji' using errcode = '42501';
  end if;

  case v_ex.type
    when 'translate_ab', 'translate_ba', 'inflection', 'listening' then
      -- Zadania z wyborem mają w payloadzie `options`; wtedy odpowiedź przychodzi jako `choice`.
      v_given := public.normalize_answer(coalesce(p_answer ->> 'text', p_answer ->> 'choice'));
      select array_agg(public.normalize_answer(x))
        into v_expected
        from jsonb_array_elements_text(v_ex.payload -> 'accepted') x;
      v_correct := v_given = any (v_expected);
      -- Tolerancja jednej literówki: dziecko uczy się słówka, nie pisania na maszynie.
      if not v_correct and char_length(v_given) > 4 then
        v_near_miss := exists (
          select 1 from unnest(v_expected) e where extensions.levenshtein(v_given, e) <= 1
        );
        v_correct := v_near_miss;
      end if;

    when 'fill_blank_choice' then
      v_correct := public.normalize_answer(p_answer ->> 'choice')
                 = public.normalize_answer(v_ex.payload ->> 'answer');

    when 'match_pairs', 'listen_match' then
      v_correct := (
        select count(*) = jsonb_array_length(v_ex.payload -> 'pairs')
        from jsonb_array_elements(v_ex.payload -> 'pairs') p
        join jsonb_array_elements(coalesce(p_answer -> 'pairs', '[]'::jsonb)) a
          on public.normalize_answer(a ->> 'a') = public.normalize_answer(p ->> 'a')
         and public.normalize_answer(a ->> 'b') = public.normalize_answer(p ->> 'b')
      );

    when 'sentence_order' then
      v_correct := public.normalize_answer(
                     (select string_agg(t, ' ') from jsonb_array_elements_text(coalesce(p_answer -> 'tokens', '[]'::jsonb)) t)
                   )
                 = public.normalize_answer(
                     (select string_agg(t, ' ') from jsonb_array_elements_text(v_ex.payload -> 'solution') t)
                   );
  end case;

  -- Ocena dla harmonogramu powtórek. Musi zgadzać się z gradeFor() w packages/core/src/srs.ts.
  v_single_tap := (v_ex.payload ? 'options') or v_ex.type in ('match_pairs', 'listen_match');
  v_grade := case
    when not v_correct then 1
    when v_near_miss or p_hint_used then 2
    when v_single_tap and p_response_ms is not null and p_response_ms <= 4000 then 4
    else 3
  end;

  insert into public.attempts (
    session_id, user_id, exercise_id, concept_id, exercise_type,
    is_correct, near_miss, hint_used, raw_answer, response_ms
  )
  values (
    p_session, v_user, v_ex.id, v_ex.concept_id, v_ex.type,
    v_correct, v_near_miss, p_hint_used, p_answer, p_response_ms
  );

  if v_ex.concept_id is not null then
    select c.course_id into v_course from public.concepts c where c.id = v_ex.concept_id;
    select p.time_zone into v_tz from public.profiles p where p.id = v_user;
    if v_course is not null then
      perform public.srs_apply(v_user, v_ex.concept_id, v_course, v_grade, v_tz);
    end if;
  end if;

  if v_correct then
    insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
    values (v_user, v_ex.points, 'exercise_correct', 'session:' || p_session::text, v_ex.id)
    on conflict do nothing;  -- powtórzone zadanie w tej samej sesji nie płaci drugi raz
  end if;

  -- Przy błędzie pokazujemy poprawną odpowiedź — dziecko ma się z niej czegoś nauczyć.
  v_shown := case
    when v_correct then null
    when v_ex.type in ('match_pairs', 'listen_match') then
      to_jsonb((
        select string_agg((p ->> 'a') || ' — ' || (p ->> 'b'), ', ')
          from jsonb_array_elements(v_ex.payload -> 'pairs') p
      ))
    else coalesce(
      v_ex.payload -> 'answer',
      v_ex.payload -> 'accepted' -> 0,
      to_jsonb((select string_agg(t, ' ') from jsonb_array_elements_text(v_ex.payload -> 'solution') t))
    )
  end;

  return jsonb_build_object(
    'correct', v_correct,
    'nearMiss', v_near_miss,
    'grade', v_grade,
    'points', case when v_correct then v_ex.points else 0 end,
    'correctAnswer', v_shown
  );
end;
$fn$;

grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;
