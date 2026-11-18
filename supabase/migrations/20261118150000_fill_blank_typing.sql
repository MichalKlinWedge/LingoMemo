-- Uzupełnianie zdania z klawiatury — drugi rodzaj zadania na poziomie trudnym.
--
-- Zgłoszone z ekranu: na poziomie trudnym wszystkie zadania są tego samego rodzaju. Tak było:
-- jedynym generatorem poziomu 3 jest `build_hard_variants`, a on umie zrobić wyłącznie pisanie
-- ze słuchu. Wejście na trudny bierze osiem słówek po jednym zadaniu, więc dziecko dostawało
-- osiem razy ten sam ekran — głośnik i pole tekstowe.
--
-- Dokładamy rodzaj zadania, na który treść jest już napisana: zdanie z luką. Każda lekcja ma
-- zadania `fill_blank_choice` (dwa w kursach demonstracyjnych, kilkanaście w „Angielskim
-- klasa 4"), w których dziecko wybiera brakujące słowo z kafelków. Ta sama luka bez kafelków
-- jest zadaniem trudnym: trzeba przeczytać zdanie w języku kursu, zrozumieć, czego w nim
-- brakuje, i napisać słowo z pamięci.
--
-- Wersja z wpisywaniem nie dostaje `translation`: polskie tłumaczenie zdania mówi, jakie słowo
-- z niego wypadło. W wersji z listą jest pomocą w czytaniu, w tej byłoby odpowiedzią.
--
-- Zadanie z kafelkami zostaje tam, gdzie było (poziom 1), i wskazuje nowe przez `easy_for` —
-- czyli dziecko, które w trudnym zadaniu poprosi o podpowiedź, dostaje TO SAMO zdanie z listą
-- do wyboru (`20261115095600_hints.sql`).
--
-- Druga zmiana w tym pliku, z tego samego zgłoszenia: po odpowiedzi na zadanie ze słuchu
-- `submit_attempt` oddaje `meaning`, czyli co usłyszane słowo znaczy po polsku. Pisanie
-- ze słuchu da się zaliczyć, nie wiedząc, co się napisało.
--
-- Odrzucone: „posłuchaj i napisz po polsku" jako drugi rodzaj (to znów głośnik i pole — ekran
-- ten sam, a różnicy dziecko nie widzi); luzowanie walidacji `fill_blank_choice`, żeby przyjęła
-- zadanie bez `options` (nazwa typu kłamałaby, a poziom liczy się z typu i payloadu);
-- `translation` w wersji z wpisywaniem (to odpowiedź); dopisywanie luk do plików treści
-- (siedemdziesiąt plików, a następny import i tak by ich nie miał).

-- Przebieg na końcu pliku przechodzi po wszystkich lekcjach w bazie, a w chmurze to tysiące
-- wierszy. Domyślny limit czasu polecenia uciąłby go w połowie. `set local` kończy się razem
-- z transakcją.
set local statement_timeout = 0;

-- 1. Walidacja payloadu. Funkcja przepisana w całości
-- z `20261115094400_sentence_order_easy.sql` — dochodzi gałąź `fill_blank_typing`.
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
    -- Wpisywanie brakującego słowa: to samo zdanie, tylko bez listy. `translation` nie ma tu
    -- czego robić — tłumaczenie zdania na polski zdradza słowo, które z niego wypadło.
    -- `coalesce`, bo brakujący klucz daje NULL, a CHECK przepuszcza NULL jak prawdę: payload bez
    -- `sentence` wszedłby do tabeli. Pozostałe gałęzie mają tę dziurę od pierwszej migracji —
    -- zatykanie jej wszystkim naraz to osobna zmiana, przy tej nowej wystarczy jej nie robić.
    when 'fill_blank_typing' then
      coalesce(
            jsonb_typeof(p -> 'sentence') = 'string'
        and (p ->> 'sentence') like '%{{blank}}%'
        and jsonb_typeof(p -> 'accepted') = 'array'
        and jsonb_array_length(p -> 'accepted') >= 1,
        false)
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
      -- Klocków wolno dać WIĘCEJ niż słów w zdaniu — nadmiarowe to dystraktory.
      and jsonb_array_length(p -> 'tokens') >= jsonb_array_length(p -> 'solution')
      and jsonb_array_length(p -> 'solution') >= 2
      and jsonb_array_length(p -> 'tokens') <= 12
      -- Zdanie musi dać się ułożyć z tego, co dziecko dostaje — każde słowo w potrzebnej liczbie.
      and not exists (
        select 1
          from (select s as word, count(*) as ile
                  from jsonb_array_elements_text(p -> 'solution') s group by s) need
          left join (select tk as word, count(*) as ile
                       from jsonb_array_elements_text(p -> 'tokens') tk group by tk) have
            on have.word = need.word
         where coalesce(have.ile, 0) < need.ile
      )
    else false
  end;
$fn$;

-- 2. Poziom zadania. Funkcja przepisana w całości z `20261115094400_sentence_order_easy.sql`.
create or replace function public.default_exercise_level(t public.exercise_type, p jsonb)
returns smallint
language sql immutable set search_path = ''
as $fn$
  select case
    -- 1: dziecko wskazuje albo układa gotowe klocki — ani jednej litery z klawiatury.
    when t in ('image_choice', 'listen_match', 'match_pairs', 'fill_blank_choice', 'sentence_order') then 1
    when t in ('translate_ab', 'translate_ba')
         and jsonb_typeof(p -> 'options') = 'array'
         and jsonb_array_length(p -> 'options') >= 2 then 1
    -- 2: wpisywanie jednego słowa.
    when t in ('translate_ab', 'translate_ba')
         and (select coalesce(max(position(' ' in a)), 0)
                from jsonb_array_elements_text(coalesce(p -> 'accepted', '[]'::jsonb)) a) = 0 then 2
    -- 3: wpisywanie zdań, pisanie ze słuchu, odmiana i uzupełnianie zdania z klawiatury.
    -- To ostatnie jest tu, a nie na poziomie 2, choć wpisuje się jedno słowo: dziecko musi
    -- najpierw przeczytać zdanie w języku kursu i zrozumieć, czego w nim brakuje, a dopiero
    -- potem napisać słowo z pamięci. To samo zdanie z listą zostaje poziomem 1.
    when t = 'fill_blank_typing' then 3
    else 3
  end::smallint;
$fn$;

-- 3. Ocena odpowiedzi. Funkcja przepisana w całości z `20261117110000_typo_retry_must_fix.sql`: nowy typ sprawdza się jak każde inne
-- pisanie, a werdykt odsłuchu niesie znaczenie słowa po polsku.
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
  v_meaning    text;
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
    when 'translate_ab', 'translate_ba', 'inflection', 'listening', 'fill_blank_typing' then
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
          'meaning', null,
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
      -- Ale tylko dopóki zadanie nie wróciło do poprawki. Po „Prawie!" liczy się odpowiedź
      -- dokładna: wcześniej wystarczyło kliknąć „Sprawdź" drugi raz, nie dotykając pola,
      -- i ten sam błąd przechodził jako dobra odpowiedź.
      --
      -- `near_miss` zostaje prawdą także wtedy: to prawda o tej odpowiedzi i stąd wiadomo,
      -- że dziecko było blisko. O zaliczeniu decyduje `v_correct`, nie ona.
      if not v_correct and char_length(v_given) > 4 then
        v_near_miss := coalesce(v_dist, 99) <= 1;
        v_correct := v_near_miss and not (v_ex.id = any (v_retried));
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

  -- Co usłyszane słowo znaczy po polsku. Dziecko umie napisać „sandwich" ze słuchu i nie
  -- wiedzieć, co napisało — a po to to słówko jest w lekcji. Znaczenie wychodzi z bazy dopiero
  -- TERAZ, razem z werdyktem: w payloadzie zadania stałoby na ekranie przed odpowiedzią.
  if v_ex.type = 'listening' and v_ex.concept_id is not null then
    select t.text into v_meaning
      from public.terms t
      join public.concepts c on c.id = t.concept_id
      join public.courses co on co.id = c.course_id
     where t.concept_id = v_ex.concept_id
       and t.lang = co.source_lang
       and t.is_primary;

    -- Odsłuch, w którym odpowiedzią jest właśnie polskie słowo (zadanie ze zrozumieniem), ma
    -- znaczenie za klucz odpowiedzi — takiego nie wydajemy.
    if v_meaning is not null and exists (
      select 1 from jsonb_array_elements_text(v_ex.payload -> 'accepted') a
       where public.normalize_answer(a) = public.normalize_answer(v_meaning)
    ) then
      v_meaning := null;
    end if;
  end if;

  return jsonb_build_object(
    'retry', false,
    'meaning', v_meaning,
    'correct', v_correct,
    'skipped', v_skipped,
    'nearMiss', v_near_miss,
    'grade', v_grade,
    'points', case when v_correct then v_ex.points else 0 end,
    'correctAnswer', v_shown
  );
end;
$fn$;

revoke execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) from anon, public;
grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;

-- 4. Generator. Źródłem jest zadanie z listą, bo w nim siedzi gotowe zdanie z luką — tego
-- ze słownika zrobić się nie da.

/**
 * Wersja z wpisywaniem dla każdego zdania z luką, które ma w lekcji tylko kafelki.
 *
 * Punkty: nie mniej niż zadanie ze słuchu (15), bo napisanie słowa z pamięci jest trudniejsze
 * od wskazania go wśród czterech. Poziom nadaje wyzwalacz z `default_exercise_level`.
 */
create or replace function public.build_fill_blank_typing(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_ex    record;
  v_new   uuid;
  v_sort  integer;
  v_added integer := 0;
begin
  select coalesce(max(ex.sort_order), 0) into v_sort
    from public.exercises ex where ex.lesson_id = p_lesson;

  for v_ex in
    select ex.id, ex.concept_id, ex.payload, ex.points
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.type = 'fill_blank_choice'
       -- `easy_for` wskazuje zadanie, którego to jest łatwiejszą wersją. Gdy jest wypełnione,
       -- wersja z wpisywaniem powstała w poprzednim przebiegu.
       and ex.easy_for is null
       and btrim(coalesce(ex.payload ->> 'answer', '')) <> ''
     order by ex.sort_order
  loop
    -- To samo zdanie z wpisywaniem już w lekcji jest — z pliku treści albo z panelu.
    if exists (
      select 1 from public.exercises o
       where o.lesson_id = p_lesson
         and o.type = 'fill_blank_typing'
         and public.normalize_answer(o.payload ->> 'sentence')
             = public.normalize_answer(v_ex.payload ->> 'sentence')
    ) then
      continue;
    end if;

    v_sort := v_sort + 1;

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'fill_blank_typing', v_sort, v_ex.concept_id,
      jsonb_build_object(
        'sentence', v_ex.payload -> 'sentence',
        'accepted', jsonb_build_array(btrim(v_ex.payload ->> 'answer'))
      ),
      greatest(v_ex.points, 15)
    )
    returning id into v_new;

    update public.exercises set easy_for = v_new where id = v_ex.id;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

comment on function public.build_fill_blank_typing(uuid) is
  'Dorabia wersję z wpisywaniem dla zdań z luką, które mają w lekcji tylko wybór z kafelków, '
  'i wiąże je przez „easy_for". Bezpieczne przy powtórzeniu.';

-- 5. Wyzwalacz dorabiający warianty. Ciało przepisane w całości
-- z `20261118130000_target_typing.sql` — dochodzi szósty generator.
--
-- UWAGA przy dopisywaniu kolejnego generatora: ta migracja jest najpóźniejsza, więc obowiązuje
-- ciało poniżej. Nowy generator dopisz TUTAJ.
create or replace function public.build_variants_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_zrobione text := coalesce(current_setting('lingomemo.built_lessons', true), '');
begin
  if coalesce(current_setting('lingomemo.skip_variants', true), '') = 'on' then
    return null;
  end if;

  if new.lesson_id::text = any (string_to_array(v_zrobione, ',')) then
    return null;
  end if;

  -- Zapis PRZED generatorami, bo one wstawiają zadania do tej samej lekcji — bez tego ich własne
  -- wiersze wracałyby tu jeszcze raz i pętla kręciłaby się po sobie.
  perform set_config('lingomemo.built_lessons', v_zrobione || new.lesson_id::text || ',', true);

  perform public.build_sentence_order(new.lesson_id);
  perform public.build_easy_variants(new.lesson_id);
  perform public.build_typing_variants(new.lesson_id);
  perform public.build_medium_variants(new.lesson_id);
  perform public.build_hard_variants(new.lesson_id);
  -- Na końcu, bo bierze za wzór zadania z luką — także te, które dołożył import w tej samej
  -- transakcji.
  perform public.build_fill_blank_typing(new.lesson_id);
  return null;
end;
$fn$;

-- 6. Treść, która jest już w bazie. Hamulec zamiast wyłączania wyzwalacza: wyłączenie bierze
-- blokadę wyłączną na `exercises` i zatrzymuje każdego, kto właśnie robi lekcję.
do $backfill$
declare
  v_lesson uuid;
begin
  perform set_config('lingomemo.skip_variants', 'on', true);

  for v_lesson in
    select distinct ex.lesson_id from public.exercises ex where ex.type = 'fill_blank_choice'
  loop
    perform public.build_fill_blank_typing(v_lesson);
  end loop;
end;
$backfill$;

-- 7. Nadania. Generator wołają wyzwalacz i migracje, nie aplikacja.
revoke execute on function public.build_fill_blank_typing(uuid) from anon, public;
