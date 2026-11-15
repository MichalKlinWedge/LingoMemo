-- Wybór obrazka (`image_choice`) — nowy typ zadania.
--
-- Dziecko widzi słowo i dotyka obrazka, który je pokazuje. Dla najmłodszych to jedyne zadanie,
-- które działa bez czytania ze zrozumieniem: słowo można przeczytać głosem, a odpowiedź jest
-- obrazkiem, nie napisem.
--
-- Payload w bazie:
--   { "prompt": "pies",
--     "options": ["2026/pies.png", "2026/kot.png", "2026/krowa.png"],
--     "answer": "2026/pies.png",
--     "speak": "dog", "lang": "en-GB" }
-- `options` i `answer` to ścieżki w buckecie `lesson-media` (tak samo jak `image` słówka);
-- publiczny adres składa przeglądarka. `speak` i `lang` są opcjonalne — gdy są, nad obrazkami
-- pojawia się głośnik i zadanie staje się „posłuchaj i wskaż”.
--
-- Dwie funkcje przepisane w całości razem z gałęziami `listen_match` z migracji 092400:
-- `create or replace` nie zna zmian cząstkowych. `get_lesson_exercises` zostaje bez zmian —
-- jej gałąź `else` i tak wycina `answer`, a `prompt` z `options` mają dojechać do przeglądarki.

-- 1. Walidacja payloadu. Najwyżej cztery obrazki: kafelek z obrazkiem jest duży, a na telefonie
-- w pionie więcej niż dwa rzędy nie mieszczą się bez przewijania, czyli bez zgadywania w ciemno.
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
    when 'image_choice' then
          jsonb_typeof(p -> 'prompt') = 'string'
      and jsonb_typeof(p -> 'options') = 'array'
      and jsonb_array_length(p -> 'options') between 2 and 4
      and not exists (
        select 1 from jsonb_array_elements(p -> 'options') o
        where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = ''
      )
      and jsonb_typeof(p -> 'answer') = 'string'
      and p -> 'options' @> jsonb_build_array(p -> 'answer')
      -- Dwa razy ten sam obrazek znaczyłby dwie poprawne odpowiedzi, z których jedna liczy się
      -- jako błąd. Na ekranie tego nie widać, więc musi wyłapać walidacja.
      and (select count(distinct o) from jsonb_array_elements(p -> 'options') o)
          = jsonb_array_length(p -> 'options')
      -- Głos bez języka nie ma czym mówić.
      and (not (p ? 'speak') or jsonb_typeof(p -> 'lang') = 'string')
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

-- 2. Sprawdzanie odpowiedzi. Wybór obrazka porównujemy ZNAK W ZNAK, bez `normalize_answer`:
-- ścieżka w buckecie nie jest tekstem pisanym przez dziecko, a normalizacja zjada kropki
-- i ukośniki, więc „pies.png” i „pies-png” zrobiłyby się jednym plikiem.
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

    when 'image_choice' then
      v_correct := (p_answer ->> 'choice') is not null
               and (p_answer ->> 'choice') = (v_ex.payload ->> 'answer');

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
  -- Dla wyboru obrazka jest nią ścieżka do pliku: paska z tekstem nią nie zapiszemy, ale
  -- przeglądarka podświetla po niej właściwy kafelek.
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
