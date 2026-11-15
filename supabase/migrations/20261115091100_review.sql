-- Lekcje powtórkowe z działu.
--
-- Powtórka nie ma własnych zadań — byłyby kopią tego, co już jest w lekcjach. Zamiast tego
-- bierzemy istniejące zadania dla słówek, które według FSRS są zaległe albo sprawiają kłopot.
-- Zestaw jest więc inny dla każdego dziecka i inny każdego dnia, a silnik lekcji pozostaje ten
-- sam — zmienia się tylko to, skąd biorą się zadania.

-- Ile zadań ma powtórka. Krótka, żeby dziecko ją skończyło.
create or replace function public.review_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 12 $fn$;

/**
 * Zadania do powtórki działu: po jednym na słówko, w kolejności „najpierw zaległe, potem
 * najczęściej mylone". Losowy typ zadania, żeby powtórka nie była za każdym razem taka sama.
 */
create or replace function public.pick_review_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with scope as (
    select l.review_scope_unit_id as unit_id
    from public.lessons l
    where l.id = p_lesson and l.kind = 'review'
  ),
  due as (
    select s.concept_id,
           -- Zaległe idą pierwsze, potem te, na których dziecko się najczęściej myli.
           case when s.due_on <= current_date then 0 else 1 end as priority,
           s.due_on,
           s.lapses
    from public.srs_state s
    where s.user_id = p_user
      and s.concept_id in (
        select li.concept_id
        from public.lesson_items li
        join public.lessons l on l.id = li.lesson_id
        where l.unit_id = (select unit_id from scope)
      )
  )
  select distinct on (d.concept_id) ex.id, d.concept_id, d.priority
  from due d
  join public.exercises ex on ex.concept_id = d.concept_id and ex.is_active
  join public.lessons el on el.id = ex.lesson_id
  where el.unit_id = (select unit_id from scope)
  order by d.concept_id, random();
$fn$;

-- Ile zadań ma lekcja: dla zwykłej tyle, ile ich w niej jest, dla powtórkowej tyle, ile słówek
-- czeka na powtórzenie (najwyżej `review_limit`).
create or replace function public.lesson_exercise_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select case
    when (select l.kind from public.lessons l where l.id = p_lesson) = 'review'
      then least((select count(*) from public.pick_review_exercises(p_lesson, p_user)), public.review_limit())
    else (select count(*) from public.exercises ex where ex.lesson_id = p_lesson and ex.is_active)
  end::integer;
$fn$;

-- Powtórka otwiera się, gdy w dziale jest już cokolwiek zaliczone i jest co powtarzać.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when l.kind = 'review' then exists (
      select 1
      from public.lesson_progress lp
      join public.lessons sl on sl.id = lp.lesson_id
      where lp.user_id = p_user
        and lp.status = 'completed'
        and sl.unit_id = l.review_scope_unit_id
    )
    when l.prerequisite_lesson_id is null then true
    else exists (
      select 1 from public.lesson_progress lp
      where lp.user_id = p_user
        and lp.lesson_id = l.prerequisite_lesson_id
        and lp.status = 'completed'
    )
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

-- Wydanie zadań: dla powtórki bierzemy wybrane wyżej, dla zwykłej lekcji jej własne.
-- Klucze odpowiedzi wycinamy tak samo w obu przypadkach.
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

  -- Numer porządkowy nadajemy PO ustaleniu kolejności, inaczej `sort_order` w powtórce nie
  -- miałby nic wspólnego z tym, w jakiej kolejności zadania naprawdę się pojawią.
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

-- Sesja: liczba zadań z nowej funkcji, bo dla powtórki nie wynika z tabeli.
create or replace function public.start_lesson_session(p_lesson uuid, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
  v_total   integer;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lessons l where l.id = p_lesson and l.is_published) then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  v_total := public.lesson_exercise_count(p_lesson, v_user);

  insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises)
  values (v_user, p_lesson, p_idempotency_key, v_total)
  returning id into v_session;

  return v_session;
end;
$fn$;

/**
 * Sprawdzenie, czy zadanie wolno rozwiązać w tej sesji. Dla zwykłej lekcji zadanie musi do niej
 * należeć; dla powtórki — do dowolnej lekcji z powtarzanego działu. Bez tego rozróżnienia
 * powtórka odbijałaby każdą odpowiedź, bo jej zadania pochodzą z innych lekcji.
 */
create or replace function public.exercise_allowed_in_lesson(p_exercise uuid, p_lesson uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when l.kind = 'review' then exists (
      select 1 from public.exercises ex
      join public.lessons el on el.id = ex.lesson_id
      where ex.id = p_exercise and el.unit_id = l.review_scope_unit_id
    )
    else exists (select 1 from public.exercises ex where ex.id = p_exercise and ex.lesson_id = p_lesson)
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

grant execute on function public.lesson_exercise_count(uuid, uuid) to authenticated;
revoke execute on function public.pick_review_exercises(uuid, uuid) from anon, public;
grant execute on function public.pick_review_exercises(uuid, uuid) to authenticated;
revoke execute on function public.exercise_allowed_in_lesson(uuid, uuid) from anon, public;
grant execute on function public.exercise_allowed_in_lesson(uuid, uuid) to authenticated;
grant execute on function public.review_limit() to authenticated;

-- Sprawdzanie odpowiedzi w powtórce: jedyna zmiana wobec wersji z migracji …_lessons.sql to
-- przynależność zadania do lekcji. Reszta ciała jest przepisana bez zmian, bo `create or replace`
-- wymaga pełnej definicji, a starej migracji nie wolno już edytować — jest wgrana na produkcji.

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

    when 'match_pairs' then
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
  v_single_tap := (v_ex.payload ? 'options') or v_ex.type = 'match_pairs';
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
