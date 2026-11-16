-- Przestawiona kolejność też jest „prawie dobrze".
--
-- „Jak to się literuje?" wpisane jako „jak się to literuje" było zwykłym błędem: dziecko znało
-- wszystkie słowa, pomyliło tylko porządek, a dostawało czerwony panel bez prawa poprawki.
-- Levenshtein nie umie tego dostrzec — zamiana dwóch wyrazów to dla niego kilkanaście poprawek,
-- czyli odległość większa niż przy zupełnie innej odpowiedzi.
--
-- Od teraz prośba o poprawkę (ta sama, co przy literówce: bez zapisanej próby, bez punktów,
-- raz na zadanie) obejmuje też odpowiedź złożoną z tych samych liter w innej kolejności.
-- Łapie to oba przypadki naraz: przestawione wyrazy w zdaniu i zamienione litery w słowie
-- („litreuje"), których dotychczasowy limit dwóch poprawek nie puszczał przy krótkich słowach.
--
-- Druga próba oceniana jest normalnie. Kolejność w zdaniu ma znaczenie, więc przestawione
-- wyrazy nie stają się poprawną odpowiedzią — dziecko dostaje szansę je poukładać, nie zaliczkę.
--
-- Odrzucone: porównywanie zbiorów wyrazów zamiast liter (nie złapałoby zamiany liter w słowie);
-- tolerancja Damerau-Levenshteina zamiast tego warunku (liczy tylko sąsiednie zamiany, więc
-- „jak się to literuje" dalej byłoby błędem); zaliczanie przestawionej kolejności jako poprawnej
-- (w zdaniu kolejność to nie ozdoba).

/** Te same litery, inny porządek. Spacje pomijamy — przestawione wyrazy mają je gdzie indziej. */
create or replace function public.same_letters(a text, b text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(a, '') <> ''
     and coalesce(b, '') <> ''
     and a <> b
     and (select string_agg(ch, '' order by ch) from unnest(string_to_array(replace(a, ' ', ''), null)) ch)
       = (select string_agg(ch, '' order by ch) from unnest(string_to_array(replace(b, ' ', ''), null)) ch);
$fn$;

comment on function public.same_letters(text, text) is
  'Czy dwa teksty mają te same litery w innej kolejności. Do rozpoznania przestawionych wyrazów '
  'i zamienionych liter, których levenshtein() liczy jako wiele poprawek.';

-- Reszta ciała przepisana bez zmian z `…_typo_retry.sql` — `create or replace` nie zna zmian
-- cząstkowych. Różnice: warunek prośby o poprawkę i pole `reason` w odpowiedzi.
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
  v_ids        uuid[];
  v_retried    uuid[];
  v_course     uuid;
  v_tz         text;
  v_given      text;
  v_expected   text[];
  v_closest    text;
  v_dist       integer;
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

  select s.lesson_id, s.exercise_ids, s.retried_exercise_ids
    into v_lesson, v_ids, v_retried
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
  -- Migawka etapu. Pusta tylko w powtórce i w sesjach sprzed migracji 094200.
  if array_length(v_ids, 1) is not null and not (v_ex.id = any (v_ids)) then
    raise exception 'To zadanie nie było w tym etapie lekcji' using errcode = '42501';
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

      if not v_correct then
        -- Najbliższa z poprawnych odpowiedzi i jej odległość od tego, co dziecko napisało.
        -- Przy równej odległości wygrywa krótsza — zwykle to ona jest słowem głównym.
        select e, extensions.levenshtein(v_given, e)
          into v_closest, v_dist
          from unnest(v_expected) e
         order by extensions.levenshtein(v_given, e), char_length(e)
         limit 1;
      end if;

      -- Prośba o poprawkę. Tylko przy pisaniu (`text`), tylko raz na zadanie w sesji i tylko
      -- przy pomyłce na tyle małej, że dziecko wie, o jakie słowo chodzi.
      if not v_correct
         and (p_answer ? 'text')
         and coalesce(v_given, '') <> ''
         and char_length(coalesce(v_closest, '')) >= 4
         and (
           v_dist between 1 and (case when char_length(v_closest) >= 7 then 2 else 1 end)
           -- Te same litery w innej kolejnosci: przestawione wyrazy w zdaniu albo zamienione
           -- litery w slowie. Levenshtein liczy taka zamiane jako dwie poprawki i przy dluzszym
           -- zdaniu wychodzi odleglosc nie do przyjecia, a dziecko zna odpowiedz - brakuje mu
           -- tylko porzadku.
           or public.same_letters(v_given, v_closest)
         )
         and not (v_ex.id = any (v_retried))
      then
        update public.lesson_sessions
           set retried_exercise_ids = array_append(retried_exercise_ids, v_ex.id)
         where id = p_session;

        -- Wyjście przed zapisem próby: prośba o poprawkę nie jest odpowiedzią. Nie wchodzi
        -- do statystyk, nie rusza powtórek i nie pokazuje poprawnej odpowiedzi — gdyby
        -- pokazywała, nie byłoby czego poprawiać.
        return jsonb_build_object(
          'retry', true,
          'reason', case when public.same_letters(v_given, v_closest) then 'order' else 'typo' end,
          'correct', false,
          'skipped', false,
          'nearMiss', true,
          'grade', 0,
          'points', 0,
          'correctAnswer', null
        );
      end if;

      -- Tolerancja jednej literówki: dziecko uczy się słówka, nie pisania na maszynie.
      if not v_correct and char_length(v_given) > 4 then
        v_near_miss := coalesce(v_dist, 99) <= 1;
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
    'retry', false,
    'correct', v_correct,
    'skipped', v_skipped,
    'nearMiss', v_near_miss,
    'grade', v_grade,
    'points', case when v_correct then v_ex.points else 0 end,
    'correctAnswer', v_shown
  );
end;
$fn$;
revoke execute on function public.same_letters(text, text) from anon;
grant execute on function public.same_letters(text, text) to authenticated;
revoke execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) from anon, public;
grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;
