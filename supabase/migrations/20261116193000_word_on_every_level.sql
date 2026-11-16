-- Każde słówko na każdym poziomie, a do etapu raz.
--
-- W panelu przy słówkach lekcji stało „zadań: 1", „2", „4" — i to nie był tylko brzydki widok.
-- Słówko bez zadania poziomu łatwego nie wchodziło do lekcji inaczej niż regułą ratunkową,
-- bez średniego wypadało z wejścia na średni, bez trudnego — z trudnego. Dziecko, które
-- klikało kwadracik „trudny", dostawało osiem słówek z całej lekcji, bo tylko tyle miało tam
-- w ogóle jakieś zadanie.
--
-- Od tej migracji obowiązują dwie zasady:
--
--   * KAŻDE słówko lekcji ma zadanie na każdym z trzech poziomów. Brakujące dorabia baza
--     (wybór z listy na łatwym, wpisanie albo rozsypanka na średnim, ze słuchu na trudnym) —
--     tak samo jak dotąd dorabiała sam poziom średni (`…_medium_variants.sql`).
--   * Słówko może mieć na jednym poziomie kilka zadań, ale do etapu wchodzi RAZ. Które z nich
--     wypadnie, zależy od losowania — a dokładniej od doby dziecka: dziś to jedno, jutro inne.
--
-- Dlaczego losowanie jest przywiązane do doby, a nie do `random()`: lekcja pyta o zadania DWA
-- razy — raz renderuje je strona, raz zapisuje migawkę `start_lesson_session`
-- (`…_session_exercise_snapshot.sql`). Przy losowaniu per wywołanie obie listy byłyby inne,
-- a dziecko dostawałoby „To zadanie nie było w tym etapie lekcji". Ziarno z pary
-- (dziecko, dzisiejsza data w jego strefie) daje jeden wynik przez cały dzień, a jutro inny.
-- To samo ziarno trzyma podział na etapy stabilny przez całe przejście lekcji.
--
-- Odrzucone: wariant losowany na podejście (numer podejścia rośnie po KAŻDYM etapie, więc
-- zestaw zmieniałby się w środku lekcji i etap drugi pokazywałby słówka z pierwszego);
-- wydawanie listy zadań przez sesję zamiast przez osobne zapytanie strony (prawdziwa losowość,
-- ale to przestawienie całego ekranu lekcji — osobna decyzja); dopisywanie brakujących zadań
-- ręcznie do plików treści (dziesiątki lekcji, a następny import i tak by ich nie miał).

-- Przebieg na końcu pliku przechodzi po wszystkich lekcjach w bazie, a w chmurze to tysiące
-- wierszy. Domyślny limit czasu polecenia uciąłby go w połowie. `set local` kończy się
-- razem z transakcją.
set local statement_timeout = 0;

-- 1. Który wariant słówka wypada dziś.
--
-- Zwraca tekst do sortowania, a nie liczbę: md5 rozkłada się równomiernie, a porównanie
-- tekstów wystarczy, żeby wybrać „pierwszy".
create or replace function public.variant_pick(p_exercise uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select pg_catalog.md5(
    p_exercise::text || ':' ||
    coalesce((select auth.uid())::text, 'anon') || ':' ||
    (
      now() at time zone coalesce(
        (select p.time_zone from public.profiles p where p.id = (select auth.uid())),
        'Europe/Warsaw'
      )
    )::date::text
  );
$fn$;

comment on function public.variant_pick(uuid) is
  'Ziarno wyboru wariantu zadania: stałe przez całą dobę dziecka, inne następnego dnia.';

/**
 * Zadania lekcji na danym poziomie — po JEDNYM na słówko.
 *
 * Zmiana względem `…_lesson_levels.sql`: słówko z trzema zadaniami poziomu łatwego wchodziło
 * do lekcji trzy razy pod rząd. Teraz wchodzi raz, a które z trzech — rozstrzyga `variant_pick`.
 *
 * Reguła ratunkowa poziomu łatwego zostaje: słówko, które nie ma ani jednego zadania na
 * klikanie (bo generator nie miał z czego go zrobić), wchodzi ze swoim najłatwiejszym. Bez tego
 * wypadłoby z lekcji, a łatwy jest jedyną drogą dalej.
 */
create or replace function public.lesson_exercises_at_level(p_lesson uuid, p_level smallint)
returns table (exercise_id uuid)
language sql stable security definer set search_path = ''
as $fn$
  with all_ex as (
    select ex.id,
           -- Zadanie bez słówka jest grupą samo dla siebie.
           coalesce(ex.concept_id::text, ex.id::text) as grp,
           ex.level
      from public.exercises ex
     where ex.lesson_id = p_lesson and ex.is_active
  ),
  fits as (select * from all_ex where level = p_level),
  rescue as (
    select a.*
      from all_ex a
     where p_level = 1
       and not exists (select 1 from fits f where f.grp = a.grp)
  ),
  kandydaci as (
    select * from fits
    union all
    select * from rescue
  ),
  -- Jedno zadanie na słówko. Przy ratunku decyduje najpierw poziom (bierzemy najłatwiejsze,
  -- jakie słówko ma), potem ziarno dnia.
  jedno_na_slowko as (
    select distinct on (k.grp) k.id
      from kandydaci k
     where p_level = 1
     order by k.grp, k.level, public.variant_pick(k.id)
  )
  select id from jedno_na_slowko
  -- Poziom łatwy JEST lekcją, więc słówko wchodzi do niej raz. Na średnim i trudnym zestaw
  -- układa `pick_level_exercises` (osiem słówek, po jednym zadaniu na słówko), a ta funkcja
  -- odpowiada tam na inne pytanie: ile zadań tego poziomu lekcja w ogóle ma — z tego bierze
  -- się kwadracik na mapie kursu.
  union all
  select k.id from kandydaci k where p_level <> 1;
$fn$;

-- 2. Dorabianie brakujących poziomów.
--
-- Źródłem jest słownik (`terms`), a nie istniejące zadanie: słówko, które ma w lekcji wyłącznie
-- zadanie ze słuchu, nie ma z czego zrobić wyboru z listy metodą „weź tłumaczenie i zabierz mu
-- kafelki", a ze słownika — ma.

/**
 * Poziom łatwy: wybór właściwego tłumaczenia z listy.
 *
 * Dystraktory to słowa główne innych słówek TEJ lekcji w języku odpowiedzi — dokładnie jak
 * w `admin_add_word`. Lekcja z jednym słówkiem nie dostanie nic: lista z jedną odpowiedzią nie
 * jest zadaniem.
 */
create or replace function public.build_easy_variants(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_src     text;
  v_tgt     text;
  v_concept record;
  v_prompt  text;
  v_answer  text;
  v_options jsonb;
  v_sort    integer;
  v_added   integer := 0;
begin
  select c.source_lang, c.target_lang into v_src, v_tgt
    from public.lessons l
    join public.units u on u.id = l.unit_id
    join public.courses c on c.id = u.course_id
   where l.id = p_lesson;
  if v_tgt is null then
    return 0;
  end if;

  select coalesce(max(ex.sort_order), 0) into v_sort
    from public.exercises ex where ex.lesson_id = p_lesson;

  for v_concept in
    select li.concept_id as id
      from public.lesson_items li
     where li.lesson_id = p_lesson
       and not exists (
         select 1 from public.exercises e
          where e.lesson_id = p_lesson and e.is_active
            and e.concept_id = li.concept_id and e.level = 1
       )
     order by li.sort_order
  loop
    select t.text into v_prompt
      from public.terms t
     where t.concept_id = v_concept.id and t.lang = v_src and t.is_primary;
    select t.text into v_answer
      from public.terms t
     where t.concept_id = v_concept.id and t.lang = v_tgt and t.is_primary;
    if v_prompt is null or v_answer is null then
      continue;
    end if;

    -- Tylko słowa główne: synonim obok swojego słowa dałby na liście dwie poprawne odpowiedzi.
    select jsonb_agg(x.text) into v_options
      from (
        select t.text
          from public.lesson_items li
          join public.terms t on t.concept_id = li.concept_id and t.lang = v_tgt and t.is_primary
         where li.lesson_id = p_lesson
           and li.concept_id <> v_concept.id
           and public.normalize_answer(t.text) <> public.normalize_answer(v_answer)
         order by random()
         limit 3
      ) x;
    if coalesce(jsonb_array_length(v_options), 0) = 0 then
      continue;
    end if;

    v_sort := v_sort + 1;

    -- Poziom wpisany wprost, nie z reguły: `default_exercise_level` daje tłumaczeniu z listą
    -- poziom 1 dopiero przy dwóch odpowiedziach do wyboru, a przy słówku z jednym sąsiadem
    -- w lekcji wyjdzie ich właśnie dwie — i to nadal jest zadanie na klikanie.
    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points, level)
    values (
      p_lesson, 'translate_ab', v_sort, v_concept.id,
      jsonb_build_object(
        'prompt', v_prompt,
        'accepted', (
          select jsonb_agg(t.text order by t.is_primary desc, t.text)
            from public.terms t where t.concept_id = v_concept.id and t.lang = v_tgt
        ),
        'options', v_options || to_jsonb(v_answer)
      ),
      10, 1
    );
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

/**
 * Poziom trudny: napisanie słowa ze słuchu.
 *
 * Wymaga głosu dla języka kursu (`languages.tts_lang`). Bez głosu nie ma czego odsłuchać, więc
 * słówko zostaje na dwóch poziomach — i tak ma być: zmyślone zadanie trudne byłoby kopią
 * średniego z inną etykietą.
 */
create or replace function public.build_hard_variants(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_tgt     text;
  v_tts     text;
  v_concept record;
  v_speak   text;
  v_sort    integer;
  v_added   integer := 0;
begin
  select c.target_lang into v_tgt
    from public.lessons l
    join public.units u on u.id = l.unit_id
    join public.courses c on c.id = u.course_id
   where l.id = p_lesson;
  if v_tgt is null then
    return 0;
  end if;

  select l.tts_lang into v_tts from public.languages l where l.code = v_tgt;
  if v_tts is null then
    return 0;
  end if;

  select coalesce(max(ex.sort_order), 0) into v_sort
    from public.exercises ex where ex.lesson_id = p_lesson;

  for v_concept in
    select li.concept_id as id
      from public.lesson_items li
     where li.lesson_id = p_lesson
       and not exists (
         select 1 from public.exercises e
          where e.lesson_id = p_lesson and e.is_active
            and e.concept_id = li.concept_id and e.level = 3
       )
     order by li.sort_order
  loop
    select t.text into v_speak
      from public.terms t
     where t.concept_id = v_concept.id and t.lang = v_tgt and t.is_primary;
    if v_speak is null then
      continue;
    end if;

    v_sort := v_sort + 1;

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'listening', v_sort, v_concept.id,
      jsonb_build_object(
        'speak', v_speak,
        'lang', v_tts,
        'accepted', (
          select jsonb_agg(t.text order by t.is_primary desc, t.text)
            from public.terms t where t.concept_id = v_concept.id and t.lang = v_tgt
        )
      ),
      15
    );
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

-- 3. Wyzwalacz dorabiający warianty. Dochodzą dwa generatory — reszta przepisana
-- z `…_medium_variants.sql`.
--
-- Kolejność: najpierw łatwy, bo średni („to samo zadanie bez kafelków") bierze za wzór
-- tłumaczenie z listą, które właśnie powstało.
create or replace function public.build_variants_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if coalesce(current_setting('lingomemo.skip_variants', true), '') = 'on' then
    return null;
  end if;

  perform public.build_sentence_order(new.lesson_id);
  perform public.build_easy_variants(new.lesson_id);
  perform public.build_medium_variants(new.lesson_id);
  perform public.build_hard_variants(new.lesson_id);
  return null;
end;
$fn$;

-- 4. Treść, która jest już w bazie. Hamulec zamiast wyłączania wyzwalacza: wyłączenie bierze
-- blokadę wyłączną na `exercises` i zatrzymuje każdego, kto właśnie robi lekcję.
do $backfill$
declare
  v_lesson uuid;
begin
  perform set_config('lingomemo.skip_variants', 'on', true);

  for v_lesson in
    select distinct li.lesson_id from public.lesson_items li
  loop
    perform public.build_easy_variants(v_lesson);
    perform public.build_medium_variants(v_lesson);
    perform public.build_hard_variants(v_lesson);
  end loop;
end;
$backfill$;

-- 5. Nadania.

revoke execute on function public.build_easy_variants(uuid) from anon, public;
revoke execute on function public.build_hard_variants(uuid) from anon, public;
revoke execute on function public.variant_pick(uuid) from anon, public;
grant execute on function public.variant_pick(uuid) to authenticated;
