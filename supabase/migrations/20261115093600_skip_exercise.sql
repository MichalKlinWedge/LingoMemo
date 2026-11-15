-- Pomijanie zadania w lekcji.
--
-- Dziecko, które utknęło, mogło dotąd tylko zgadywać albo wyjść z lekcji — a wyjście zostawia
-- sesję w połowie i nie uczy niczego. „Pomiń" wysyła odpowiedź `{"skipped": true}`, a baza
-- liczy ją jak błąd: zero punktów, ocena „powtórz" dla harmonogramu FSRS i pokazana poprawna
-- odpowiedź. To ważne, że decyduje o tym baza, a nie przeglądarka — klient nigdy nie wysyła
-- werdyktu ani punktów.
--
-- Funkcja jest przepisana w całości, bo `create or replace` nie umie inaczej; różnica wobec
-- wersji z `…_lesson_stages.sql` to flaga `v_skipped`, ominięcie sprawdzania odpowiedzi
-- i dodatkowe pole w werdykcie.

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
  v_stage      integer;
  v_kind       public.lesson_kind;
  v_course     uuid;
  v_tz         text;
  v_given      text;
  v_expected   text[];
  v_correct    boolean := false;
  v_near_miss  boolean := false;
  v_single_tap boolean;
  v_grade      smallint;
  v_shown      jsonb;
  -- Dziecko kliknęło „Pomiń". Zadanie liczy się jak błąd: zero punktów i ocena „powtórz".
  v_skipped    boolean := coalesce((p_answer ->> 'skipped')::boolean, false);
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select s.lesson_id, s.stage_nr into v_lesson, v_stage
    from public.lesson_sessions s
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

  select l.kind into v_kind from public.lessons l where l.id = v_lesson;
  -- Powtórka jest zawsze jednoetapowa, a jej zadania pochodzą z cudzych lekcji — numer etapu
  -- liczony w tamtej lekcji nie miałby tu żadnego znaczenia.
  if v_kind <> 'review' and public.exercise_stage(v_ex.id, v_lesson) is distinct from v_stage then
    raise exception 'Zadanie należy do innego etapu lekcji' using errcode = '42501';
  end if;

  if v_skipped then
    v_correct := false;
  else
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
  end if;

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
    'skipped', v_skipped,
    'nearMiss', v_near_miss,
    'grade', v_grade,
    'points', case when v_correct then v_ex.points else 0 end,
    'correctAnswer', v_shown
  );
end;
$fn$;

-- Nadania po przepisaniu funkcji — `create or replace` je zachowuje, ale trzymamy je przy
-- definicji, żeby nie trzeba było szukać po historii migracji.
revoke execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) from anon, public;
grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;
