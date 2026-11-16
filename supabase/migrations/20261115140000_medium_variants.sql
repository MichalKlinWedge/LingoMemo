-- Średni poziom w lekcjach, które go nie mają.
--
-- Na mapie kursu kwadracik średniego poziomu znikał przy całych lekcjach — na przykład przy
-- „Classroom language", gdzie wszystkie tłumaczenia mają gotowe kafelki (poziom 1), a jedyne
-- zadania z pisaniem to trzy ze słuchu (poziom 3). Średniego nie było ani jednego, więc nie było
-- czym wypełnić wejścia i kwadracik się nie pokazywał.
--
-- Średni poziom to „już nie samo klikanie, ale jeszcze nie całe zdanie z klawiatury". Dla słówka
-- jednowyrazowego jest nim wpisanie tego słowa, a dla zdania — ułożenie go z klocków, wśród
-- których są też słowa niepasujące. Obie formy już w aplikacji są; brakowało ich w treści.
--
-- Odrzucone: przeniesienie wszystkich rozsypanek z dystraktorami na poziom średni (lekcje, gdzie
-- rozsypanka była jedynym łatwym zadaniem dla swojego słówka, straciłyby poziom łatwy);
-- pokazywanie pustego kwadracika z dymkiem „nie ma zadań" (rząd wygląda równo, ale dziecko dalej
-- nie ma czego zrobić); dopisywanie zadań ręcznie do plików treści (dziesiątki lekcji).

/**
 * Dystraktory do rozsypanki: pojedyncze słowa z tego samego działu, w języku odpowiedzi.
 * Wyciągnięte z `build_sentence_order` — ten sam dobór potrzebny jest teraz w dwóch miejscach.
 */
create or replace function public.sentence_distractors(p_unit uuid, p_lang text, p_words text[])
returns text[]
language sql stable security definer set search_path = ''
as $fn$
  select coalesce(array_agg(d.word), '{}'::text[])
    from (
      select t.text as word
        from public.terms t
        join public.lesson_items li on li.concept_id = t.concept_id
        join public.lessons l on l.id = li.lesson_id
       where l.unit_id = p_unit
         and t.lang = p_lang
         and t.is_primary
         and position(' ' in btrim(t.text)) = 0
         and not exists (
           select 1 from unnest(p_words) w
            where public.normalize_answer(w) = public.normalize_answer(t.text)
         )
       group by t.text
       order by random()
       limit 3
    ) d;
$fn$;

/**
 * Dorobienie średniego poziomu tam, gdzie słówko go nie ma.
 *
 * Źródłem jest dowolne tłumaczenie tego słówka w lekcji — bierzemy z niego polecenie i poprawną
 * odpowiedź. Jedno słowo zamienia się na zadanie z wpisywaniem (poziom nada wyzwalacz), zdanie na
 * rozsypankę z dystraktorami, której poziom ustawiamy wprost na 2: rozsypanka sama z siebie jest
 * zadaniem na klikanie, ale ta ma w klockach słowa niepasujące, więc wymaga przeczytania zdania,
 * a nie zużycia wszystkiego po kolei.
 */
create or replace function public.build_medium_variants(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_unit        uuid;
  v_src         text;
  v_tgt         text;
  v_concept     record;
  v_source      record;
  v_answer      text;
  v_words       text[];
  v_lang        text;
  v_distractors text[];
  v_sort        integer;
  v_added       integer := 0;
begin
  select u.id, c.source_lang, c.target_lang into v_unit, v_src, v_tgt
    from public.lessons l
    join public.units u on u.id = l.unit_id
    join public.courses c on c.id = u.course_id
   where l.id = p_lesson;
  if v_unit is null then
    return 0;
  end if;

  select coalesce(max(ex.sort_order), 0) into v_sort
    from public.exercises ex where ex.lesson_id = p_lesson;

  for v_concept in
    select distinct ex.concept_id as id
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.concept_id is not null
       and not exists (
         select 1 from public.exercises m
          where m.lesson_id = p_lesson and m.is_active
            and m.concept_id = ex.concept_id and m.level = 2
       )
  loop
    -- Tłumaczenie z poprawną odpowiedzią. `translate_ab` pierwsze: odpowiedź jest w języku,
    -- którego dziecko się uczy, więc to ono jest ćwiczeniem, a nie tłumaczeniem na polski.
    select ex.type, ex.payload, ex.points into v_source
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.concept_id = v_concept.id
       and ex.type in ('translate_ab', 'translate_ba')
       and jsonb_typeof(ex.payload -> 'accepted') = 'array'
     order by (ex.type = 'translate_ab') desc, ex.sort_order
     limit 1;
    if not found then
      continue;
    end if;

    v_answer := btrim(coalesce(v_source.payload -> 'accepted' ->> 0, ''));
    if v_answer = '' then
      continue;
    end if;

    v_sort := v_sort + 1;

    if position(' ' in v_answer) = 0 then
      -- Jedno słowo: to samo zadanie bez gotowych kafelków. Poziom nada wyzwalacz.
      insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
      values (p_lesson, v_source.type, v_sort, v_concept.id,
              v_source.payload - 'options', v_source.points);
      v_added := v_added + 1;
    else
      v_words := regexp_split_to_array(v_answer, '\s+');
      -- Powyżej dziewięciu słów nie zostaje miejsca na dystraktory (walidacja: 12 klocków).
      if coalesce(array_length(v_words, 1), 0) < 2 or array_length(v_words, 1) > 9 then
        continue;
      end if;

      v_lang := case when v_source.type = 'translate_ab' then v_tgt else v_src end;
      v_distractors := public.sentence_distractors(v_unit, v_lang, v_words);

      -- Bez ani jednego niepasującego słowa rozsypanka jest zadaniem łatwym, nie średnim.
      if coalesce(array_length(v_distractors, 1), 0) = 0 then
        continue;
      end if;

      insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points, level)
      values (
        p_lesson, 'sentence_order', v_sort, v_concept.id,
        jsonb_build_object(
          'prompt', coalesce(v_source.payload ->> 'prompt', 'Ułóż zdanie'),
          'tokens', to_jsonb(v_words || v_distractors),
          'solution', to_jsonb(v_words)
        ),
        v_source.points, 2
      );
      v_added := v_added + 1;
    end if;
  end loop;

  return v_added;
end;
$fn$;

/**
 * Dorabianie wariantów po KOŃCU transakcji, a nie po każdym poleceniu.
 *
 * Dotychczasowy wyzwalacz na polecenie odpalał się w środku `admin_add_word`, które wstawia
 * trzy zadania trzema osobnymi `insert`-ami: po pierwszym słówko miało tylko wybór z kafelków,
 * więc generator uznawał, że brakuje średniego, i dorabiał czwarte zadanie — chwilę przed tym,
 * jak `admin_add_word` wstawiło własne tłumaczenie na polski, które tym średnim właśnie jest.
 *
 * Wyzwalacz więzowy `deferrable initially deferred` odpala się dopiero przy zatwierdzeniu
 * transakcji, czyli gdy lekcja jest już kompletna. Działa na wiersz, nie na polecenie, ale oba
 * generatory są bezpieczne przy powtórzeniu: drugie wywołanie nie ma już czego dorobić.
 */
create or replace function public.build_variants_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.build_sentence_order(new.lesson_id);
  perform public.build_medium_variants(new.lesson_id);
  return null;
end;
$fn$;

drop trigger if exists exercises_sentence_order on public.exercises;
drop trigger if exists exercises_variants on public.exercises;

create constraint trigger exercises_variants
  after insert on public.exercises
  deferrable initially deferred
  for each row execute function public.build_variants_after_insert();

revoke execute on function public.sentence_distractors(uuid, text, text[]) from anon, public;
revoke execute on function public.build_medium_variants(uuid) from anon, public;

-- Treść, która jest już w bazie.
--
-- Wyzwalacz na czas przebiegu jest wyłączony. Działa na wiersz, więc przy kilkuset dorobionych
-- zadaniach odpalałby się kilkaset razy, a każde odpalenie przeczesuje całą lekcję — push do
-- bazy w chmurze przestawał się kończyć. Pętla niżej i tak obsługuje wszystkie lekcje, więc
-- wyzwalacz nie miałby tu nic do dorobienia.
alter table public.exercises disable trigger exercises_variants;

do $backfill$
declare
  v_lesson uuid;
begin
  for v_lesson in select l.id from public.lessons l loop
    perform public.build_medium_variants(v_lesson);
  end loop;
end;
$backfill$;

alter table public.exercises enable trigger exercises_variants;
