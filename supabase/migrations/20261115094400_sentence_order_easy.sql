-- Łatwy wariant zdania: klikanie słów zamiast wpisywania liter.
--
-- Na poziomie 1 zadanie ze zdaniem znikało z lekcji, bo jedyną jego wersją było wpisanie całego
-- zdania z klawiatury. Zamiast chować takie zadanie, dajemy jego łatwy odpowiednik: dziecko
-- składa to samo zdanie z klocków, wśród których są też słowa niepasujące. Czyta polecenie,
-- wybiera słowa i układa je w kolejności — bez ani jednej litery z klawiatury.
--
-- Trzy zmiany: rozsypance wolno mieć więcej klocków niż słów w zdaniu (dotąd walidacja wymagała
-- równości), rozsypanka jest zadaniem poziomu 1 (klikanie, nie pisanie), a do każdego zadania ze
-- zdaniem do wpisania dorabia się rozsypanka — raz dla treści, która już jest w bazie, i dalej
-- automatycznie przy każdym imporcie.
--
-- Odrzucone: generowanie łatwej wersji w locie w `get_lesson_exercises` (zadanie bez wiersza nie
-- ma id, więc nie ma czego zapisać w próbach ani pokazać w panelu); losowanie dystraktorów przy
-- każdym wydaniu zadania (co wejście inne słowa, więc dziecko ćwiczy zgadywanie, a nie zdanie);
-- pisanie łatwych wariantów ręcznie w plikach treści (samych zdań jest dziś 86).

-- 1. Walidacja: rozsypanka z dystraktorami. Funkcja przepisana w całości z
-- `20261115092600_image_choice.sql` — różni się wyłącznie gałęzią `sentence_order`.
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

-- 2. Rozsypanka to klikanie, a nie pisanie — zadanie poziomu 1. Funkcja przepisana w całości
-- z `20261115094000_learner_level.sql`.
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
    -- 3: wpisywanie zdań, pisanie ze słuchu, odmiana.
    else 3
  end::smallint;
$fn$;

update public.exercises set level = 1 where type = 'sentence_order' and level is distinct from 1;

-- 3. Łatwy wariant wie, czyim jest zamiennikiem. Bez tego dziecko z poziomem 3 dostawałoby to
-- samo zdanie dwa razy: raz z klocków, raz do wpisania — czyli lekcja dwa razy dłuższa dla tego,
-- kto właśnie nie potrzebuje ułatwień.
alter table public.exercises
  add column if not exists easy_for uuid references public.exercises(id) on delete cascade;

create index if not exists exercises_easy_for_idx on public.exercises (easy_for)
  where easy_for is not null;

comment on column public.exercises.easy_for is
  'Zadanie, którego to jest łatwiejszą wersją. Gdy oryginał mieści się w poziomie dziecka, '
  'zamiennik się nie pokazuje.';

-- 4. Dorabianie łatwego wariantu.
--
-- Dystraktory bierzemy ze słówek tego samego działu, w języku odpowiedzi: są z tej samej bajki,
-- więc wybór wymaga przeczytania zdania, a nie odsiania jedynego obcego słowa. Losujemy je RAZ,
-- przy zakładaniu zadania — kolejność klocków i tak tasuje `get_lesson_exercises` przy każdym
-- wejściu, a stały zestaw słów daje dziecku to samo zadanie, a nie co raz inne.
create or replace function public.build_sentence_order(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_unit        uuid;
  v_src         text;
  v_tgt         text;
  v_ex          record;
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

  for v_ex in
    select ex.id, ex.type, ex.concept_id, ex.payload
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.type in ('translate_ab', 'translate_ba')
       -- Zadanie z gotowymi kafelkami jest już łatwe; dorabiamy tylko do wpisywania.
       and not (ex.payload ? 'options')
       and position(' ' in btrim(coalesce(ex.payload -> 'accepted' ->> 0, ''))) > 0
     order by ex.sort_order
  loop
    v_words := regexp_split_to_array(btrim(v_ex.payload -> 'accepted' ->> 0), '\s+');
    -- Powyżej dziewięciu słów nie zostaje miejsca na dystraktory (walidacja: 12 klocków).
    if coalesce(array_length(v_words, 1), 0) < 2 or array_length(v_words, 1) > 9 then
      continue;
    end if;

    -- Ta sama rozsypanka już jest — z poprzedniego przebiegu albo z pliku treści.
    if exists (
      select 1 from public.exercises o
       where o.lesson_id = p_lesson
         and o.type = 'sentence_order'
         and (o.easy_for = v_ex.id
              or public.normalize_answer(
                   (select string_agg(t, ' ') from jsonb_array_elements_text(o.payload -> 'solution') t))
                 = public.normalize_answer(array_to_string(v_words, ' ')))
    ) then
      continue;
    end if;

    v_lang := case when v_ex.type = 'translate_ab' then v_tgt else v_src end;

    select coalesce(array_agg(d.word), '{}'::text[]) into v_distractors
      from (
        select t.text as word
          from public.terms t
          join public.lesson_items li on li.concept_id = t.concept_id
          join public.lessons l2 on l2.id = li.lesson_id
         where l2.unit_id = v_unit
           and t.lang = v_lang
           and t.is_primary
           and position(' ' in btrim(t.text)) = 0
           and not exists (
             select 1 from unnest(v_words) w
              where public.normalize_answer(w) = public.normalize_answer(t.text)
           )
         group by t.text
         order by random()
         limit 3
      ) d;

    v_sort := v_sort + 1;
    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points, level, easy_for)
    values (
      p_lesson, 'sentence_order', v_sort, v_ex.concept_id,
      jsonb_build_object(
        'prompt', coalesce(v_ex.payload ->> 'prompt', 'Ułóż zdanie'),
        'tokens', to_jsonb(v_words || v_distractors),
        'solution', to_jsonb(v_words)
      ),
      10, 1, v_ex.id
    );
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$fn$;

/**
 * Nowa treść dostaje łatwy wariant sama. Wyzwalacz na całe polecenie, nie na wiersz: import
 * wstawia zadania jednym poleceniem, a dorabianie i tak dotyczy całej lekcji. Zagnieżdżenie
 * kończy się na drugim przebiegu — własne rozsypanki nie spełniają warunku pętli.
 */
create or replace function public.sentence_order_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_lesson uuid;
begin
  for v_lesson in select distinct i.lesson_id from inserted i loop
    perform public.build_sentence_order(v_lesson);
  end loop;
  return null;
end;
$fn$;

drop trigger if exists exercises_sentence_order on public.exercises;
create trigger exercises_sentence_order
  after insert on public.exercises
  referencing new table as inserted
  for each statement execute function public.sentence_order_after_insert();

/** Dorobienie wariantów na żądanie — dla lekcji, które powstały przed tą migracją. */
create or replace function public.admin_add_sentence_order(p_lesson uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return public.build_sentence_order(p_lesson);
end;
$fn$;

revoke execute on function public.build_sentence_order(uuid) from anon, public;
revoke execute on function public.admin_add_sentence_order(uuid) from anon, public;
grant execute on function public.admin_add_sentence_order(uuid) to authenticated;

-- 5. Dobór zadań: zamiennik ustępuje oryginałowi. Funkcja przepisana w całości
-- z `20261115094000_learner_level.sql` — dochodzi odsianie łatwych wariantów tych zadań, które
-- i tak mieszczą się w poziomie dziecka.
create or replace function public.visible_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid)
language sql stable security definer set search_path = ''
as $fn$
  with all_ex as (
    select ex.id,
           -- Zadanie bez słówka jest grupą samo dla siebie: `distinct on` po samym `concept_id`
           -- sklejałby wszystkie NULL-e w jedną grupę.
           coalesce(ex.concept_id::text, ex.id::text) as grp,
           ex.level,
           ex.easy_for,
           public.allowed_exercise_level(p_user, ex.concept_id) as cap
      from public.exercises ex
     where ex.lesson_id = p_lesson and ex.is_active
  ),
  w_poziomie as (select * from all_ex where level <= cap),
  -- Łatwa wersja zdania znika, gdy dziecko poradzi sobie z oryginałem — także z ratunku niżej,
  -- bo tę samą treść ma już w zadaniu, które zastępuje.
  kandydaci as (
    select a.* from all_ex a
     where a.easy_for is null
        or not exists (select 1 from w_poziomie o where o.id = a.easy_for)
  ),
  fits as (select * from kandydaci where level <= cap),
  rescue as (
    select distinct on (k.grp) k.id
      from kandydaci k
     where not exists (select 1 from fits f where f.grp = k.grp)
     order by k.grp, k.level, k.id
  )
  select id from fits
  union
  select id from rescue;
$fn$;

-- 6. Treść, która jest już w bazie.
do $backfill$
declare
  v_lesson uuid;
begin
  for v_lesson in select l.id from public.lessons l loop
    perform public.build_sentence_order(v_lesson);
  end loop;
end;
$backfill$;
