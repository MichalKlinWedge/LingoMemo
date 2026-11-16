-- Wyzwalacz dorabiający warianty: raz na lekcję i transakcję, a nie raz na wstawiony wiersz.
--
-- Objaw: import lekcji (`admin_import_lesson`) nie kończył się w limicie czasu — ani w chmurze
-- („canceling statement due to statement timeout"), ani lokalnie, gdzie `COMMIT` jednej lekcji
-- o 34 zadaniach trwał ponad osiem minut i nie doszedł do końca.
--
-- Przyczyna: `exercises_variants` jest wyzwalaczem więzowym NA WIERSZ, a jego funkcja przechodzi
-- CAŁĄ lekcję czterema generatorami. Import wstawia kilkadziesiąt zadań, więc przy zatwierdzeniu
-- transakcji ta sama lekcja była przeczesywana kilkadziesiąt razy. Co gorsza generatory same
-- wstawiają zadania, a każde takie wstawienie dokładało kolejne zdarzenie do kolejki wyzwalacza,
-- więc kolejka rosła w trakcie jej przerabiania.
--
-- Poprawka: pamięć lokalna dla transakcji. Pierwsze zdarzenie dla danej lekcji zapisuje jej
-- identyfikator i uruchamia generatory, wszystkie następne (te z importu i te z wierszy, które
-- dopisały same generatory) nie mają już czego robić i kończą się od razu. Generatory i tak
-- przechodzą całą lekcję, więc jedno wywołanie załatwia wszystko, co widziały poprzednie.
--
-- Czego tu NIE ma: wyzwalacza na polecenie zamiast na wiersz. Wyzwalacz więzowy
-- (`deferrable initially deferred`) z definicji działa na wiersz — a odroczenie jest tu potrzebne,
-- bo lekcja musi być kompletna, zanim generator oceni, czego w niej brakuje (patrz nagłówek
-- `…_medium_variants.sql`). Hamulec `lingomemo.skip_variants` zostaje bez zmian: wyłącza
-- generatory na czas masowych przebiegów w samych migracjach.
--
-- UWAGA przy dopisywaniu kolejnego generatora: ciało poniżej jest przepisane
-- z `20261116193000_word_on_every_level.sql`, a ta migracja jest późniejsza, więc to ona
-- obowiązuje. Nowy generator dopisz TUTAJ, nie tam.

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

  -- Kolejność: najpierw łatwy, bo średni („to samo zadanie bez kafelków") bierze za wzór
  -- tłumaczenie z listą, które właśnie powstało.
  perform public.build_sentence_order(new.lesson_id);
  perform public.build_easy_variants(new.lesson_id);
  perform public.build_medium_variants(new.lesson_id);
  perform public.build_hard_variants(new.lesson_id);
  return null;
end;
$fn$;
