-- Wpisanie słowa w języku kursu — brakujący kierunek średniego poziomu.
--
-- Zgłoszone z ekranu: dziecko nigdzie nie wpisuje słowa w języku, którego się uczy. I tak było:
-- poza „Angielskim klasa 4" każde słówko ma `translate_ab` z gotowymi kafelkami (poziom 1) oraz
-- `translate_ba` z wpisywaniem po polsku (poziom 2) — oba zakłada `admin_add_word`. Kierunek
-- „po polsku -> w języku kursu" istniał więc wyłącznie jako klikanie w kafelki.
--
-- Dlaczego nie załatwił tego `build_medium_variants`: on dorabia średni poziom tam, gdzie słówko
-- nie ma ANI JEDNEGO zadania poziomu 2. Tłumaczenie na polski ten warunek spełnia, więc generator
-- mijał całe kursy. Liczby przed tą migracją: w `content/pl-de`, `pl-es`, `pl-fr`, `pl-it`
-- i `pl-en` nie ma ani jednego tłumaczenia na język kursu bez `options`.
--
-- A to nie to samo ćwiczenie: wskazanie „rot" wśród czterech kafelków wymaga rozpoznania słowa,
-- napisanie go — pamiętania, jak brzmi i jak się pisze. Po to właśnie jest poziom średni.
--
-- Od tej migracji każde słówko lekcji ma w języku kursu zadanie z wpisywaniem. Dorabia je piąty
-- generator, obok czterech, które już były. Źródłem jest słownik (`terms`), a nie istniejące
-- zadanie — tak jak w `build_easy_variants`: słówko, które ma w lekcji tylko zadanie ze słuchu,
-- nie ma z czego zrobić wpisywania metodą „weź tłumaczenie i zabierz mu kafelki", a ze słownika
-- ma. Poziomu nie podajemy: `default_exercise_level` widzi tłumaczenie bez `options` z odpowiedzią
-- jednowyrazową i daje 2.
--
-- Odrzucone: poszerzenie warunku w `build_medium_variants` o kierunek odpowiedzi (poziomem 2 bywa
-- też rozsypanka, a po jej payloadzie nie poznać, w jakim języku jest rozwiązanie — warunek
-- zrobiłby się zgadywaniem); dopisanie zadań do plików treści (siedemdziesiąt plików, a następny
-- import i tak by ich nie miał); całe zwroty do wpisania (wpisanie zdania to poziom trudny i ma
-- już swoje zadania — ze słuchu i rozsypankę z dystraktorami).

-- Przebieg na końcu pliku przechodzi po wszystkich lekcjach w bazie, a w chmurze to tysiące
-- wierszy. Domyślny limit czasu polecenia uciąłby go w połowie. `set local` kończy się razem
-- z transakcją.
set local statement_timeout = 0;

-- 1. Generator.

/**
 * Wpisanie słowa w języku kursu dla słówek, które tego nie mają.
 *
 * Tylko słowa jednowyrazowe, i tylko one trafiają do `accepted`: zwrot wpisywany z klawiatury to
 * poziom trudny, a jeden wielowyrazowy synonim na liście odpowiedzi podniósłby poziom całego
 * zadania do 3 — wtedy słówko dalej nie miałoby średniego i `build_medium_variants` dorobiłby mu
 * drugie, prawie identyczne zadanie.
 */
create or replace function public.build_typing_variants(p_lesson uuid)
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
  v_accepted jsonb;
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
       -- Wpisywanie w języku kursu już jest — z pliku treści, z `admin_add_word` przy lekcji
       -- o jednym słówku albo z poprzedniego przebiegu.
       and not exists (
         select 1 from public.exercises e
          where e.lesson_id = p_lesson and e.is_active
            and e.concept_id = li.concept_id
            and e.type = 'translate_ab'
            and not (e.payload ? 'options')
       )
     order by li.sort_order
  loop
    select t.text into v_prompt
      from public.terms t
     where t.concept_id = v_concept.id and t.lang = v_src and t.is_primary;
    select t.text into v_answer
      from public.terms t
     where t.concept_id = v_concept.id and t.lang = v_tgt and t.is_primary;
    if v_prompt is null or v_answer is null or position(' ' in btrim(v_answer)) > 0 then
      continue;
    end if;

    select jsonb_agg(t.text order by t.is_primary desc, t.text) into v_accepted
      from public.terms t
     where t.concept_id = v_concept.id
       and t.lang = v_tgt
       and position(' ' in btrim(t.text)) = 0;

    v_sort := v_sort + 1;

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'translate_ab', v_sort, v_concept.id,
      jsonb_build_object('prompt', v_prompt, 'accepted', v_accepted),
      10
    );
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

comment on function public.build_typing_variants(uuid) is
  'Dorabia tłumaczenie z wpisywaniem w języku kursu dla słówek lekcji, które mają ten kierunek '
  'wyłącznie jako wybór z kafelków. Bezpieczne przy powtórzeniu.';

-- 2. Wyzwalacz dorabiający warianty. Ciało przepisane w całości
-- z `20261116210000_variants_once_per_lesson.sql` — dochodzi piąty generator.
--
-- UWAGA przy dopisywaniu kolejnego generatora: ta migracja jest najpóźniejsza, więc obowiązuje
-- ciało poniżej. Nowy generator dopisz TUTAJ.
--
-- Kolejność: wpisywanie przed `build_medium_variants`. Oba potrafią zrobić słówku poziom średni,
-- a ten pierwszy robi go w kierunku, o który chodzi; gdy go doda, drugi nie ma już czego dorabiać.
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
  return null;
end;
$fn$;

-- 3. Treść, która jest już w bazie. Hamulec zamiast wyłączania wyzwalacza: wyłączenie bierze
-- blokadę wyłączną na `exercises` i zatrzymuje każdego, kto właśnie robi lekcję.
do $backfill$
declare
  v_lesson uuid;
begin
  perform set_config('lingomemo.skip_variants', 'on', true);

  for v_lesson in select distinct li.lesson_id from public.lesson_items li loop
    perform public.build_typing_variants(v_lesson);
  end loop;
end;
$backfill$;

-- 4. Nadania. Generator wołają wyzwalacz i migracje, nie aplikacja.
revoke execute on function public.build_typing_variants(uuid) from anon, public;
