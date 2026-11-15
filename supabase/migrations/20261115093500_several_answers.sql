-- Kilka poprawnych odpowiedzi dla jednego słówka.
--
-- „turtle" to po polsku i żółw, i żółwik; „potato" to ziemniak, kartofel i pyra. Dotąd panel
-- przyjmował jedno słowo na język, więc dziecko tłumaczące na polski trafiało albo w to jedno
-- słowo, albo dostawało błąd za dobrą odpowiedź. Import umiał to od początku (`accepted` jest
-- tablicą, a `terms` trzymają synonimy), panel nie.
--
-- Rozwiązanie bez zmiany sygnatur: pola formularza przyjmują listę po przecinku, a rozbija ją
-- baza. Dzięki temu stare wywołania z jednym słowem działają tak samo, a `accepted` w zadaniu
-- dostaje wszystkie formy naraz.
--
-- PIERWSZA forma jest główna: to ona stoi w `terms` jako `is_primary`, to ją widzi dziecko jako
-- polecenie, czyta syntezator mowy i to ona trafia na listę wyboru u innych słówek. Pozostałe są
-- synonimami — liczą się przy sprawdzaniu odpowiedzi i nigdzie się nie pokazują.

-- Rozbicie pola formularza na listę odpowiedzi. Przecinek, średnik i ukośnik, bo każdy z nich
-- pisze się odruchowo; puste kawałki lecą do kosza, a powtórzenia (po normalizacji, więc
-- „żółw" i „zolw" to jedno) zostawiamy tylko raz, w kolejności wpisania.
create or replace function public.split_answers(p text)
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  with parts as (
    select btrim(x) as text, ord
      from unnest(regexp_split_to_array(coalesce(p, ''), '\s*[,;/]\s*')) with ordinality as t(x, ord)
     where btrim(x) <> ''
  ), unikalne as (
    select distinct on (public.normalize_answer(parts.text)) parts.text, parts.ord
      from parts
     order by public.normalize_answer(parts.text), parts.ord
  )
  select coalesce(array_agg(unikalne.text order by unikalne.ord), '{}')
    from unikalne;
$fn$;

comment on function public.split_answers(text) is
  'Pole formularza („żółw, żółwik") na listę poprawnych odpowiedzi. Pierwsza jest główna.';

revoke execute on function public.split_answers(text) from anon, public;
grant execute on function public.split_answers(text) to authenticated;

-- Synonimy wymieniamy w całości, tak samo jak przy imporcie: inaczej poprawiona literówka
-- zostawałaby w bazie jako „synonim" i dalej liczyła się jako dobra odpowiedź.
create or replace function app_private.replace_synonyms(p_concept uuid, p_lang text, p_words text[])
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  delete from public.terms t
   where t.concept_id = p_concept and t.lang = p_lang and not t.is_primary;

  insert into public.terms (concept_id, lang, text, is_primary)
  select p_concept, p_lang, w, false
    from unnest(p_words[2:]) w;
end;
$fn$;

revoke execute on function app_private.replace_synonyms(uuid, text, text[]) from anon, public;

-- 1. Dodanie słówka do lekcji.
create or replace function public.admin_add_word(
  p_lesson uuid,
  p_key    text,
  p_source text,
  p_target text,
  p_tags   text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_course   uuid;
  v_src_lang text;
  v_tgt_lang text;
  v_tts      text;
  v_concept  uuid;
  v_sources  text[] := public.split_answers(p_source);
  v_targets  text[] := public.split_answers(p_target);
  v_key      text := lower(btrim(coalesce(p_key, '')));
  v_sort     integer;
  v_ex_sort  integer;
  v_options  jsonb;
  v_added    integer := 0;
begin
  perform app_private.assert_admin();

  select c.id, c.source_lang, c.target_lang
    into v_course, v_src_lang, v_tgt_lang
    from public.lessons l
    join public.units u on u.id = l.unit_id
    join public.courses c on c.id = u.course_id
   where l.id = p_lesson;

  if v_course is null then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;

  if coalesce(array_length(v_sources, 1), 0) = 0 or coalesce(array_length(v_targets, 1), 0) = 0 then
    raise exception 'Podaj słowo w obu językach' using errcode = '22023';
  end if;

  if v_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Klucz słówka: małe litery, cyfry oraz . _ -, np. "food.apple"' using errcode = '22023';
  end if;

  insert into public.concepts (course_id, key, tags)
  values (v_course, v_key, coalesce(p_tags, '{}'))
  on conflict (course_id, key) do update set tags = excluded.tags
  returning id into v_concept;

  -- Słowo główne w każdym z dwóch języków kursu, a za nim synonimy.
  insert into public.terms (concept_id, lang, text, is_primary)
  values (v_concept, v_src_lang, v_sources[1], true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  insert into public.terms (concept_id, lang, text, is_primary)
  values (v_concept, v_tgt_lang, v_targets[1], true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  perform app_private.replace_synonyms(v_concept, v_src_lang, v_sources);
  perform app_private.replace_synonyms(v_concept, v_tgt_lang, v_targets);

  select coalesce(max(li.sort_order), 0) + 1 into v_sort
    from public.lesson_items li where li.lesson_id = p_lesson;

  insert into public.lesson_items (lesson_id, concept_id, sort_order)
  values (p_lesson, v_concept, v_sort)
  on conflict (lesson_id, concept_id) do nothing;

  -- Zadania tylko wtedy, gdy to słówko jeszcze żadnych w tej lekcji nie ma.
  if not exists (
    select 1 from public.exercises e where e.lesson_id = p_lesson and e.concept_id = v_concept
  ) then
    select coalesce(max(e.sort_order), 0) into v_ex_sort
      from public.exercises e where e.lesson_id = p_lesson;

    -- Dystraktory do wyboru z listy: trzy inne słowa z tej samej lekcji. Tylko słowa główne —
    -- synonim obok swojego słowa na jednej liście dałby dwie poprawne odpowiedzi do wyboru.
    select jsonb_agg(x.text) into v_options
      from (
        select t.text
          from public.lesson_items li
          join public.terms t
            on t.concept_id = li.concept_id and t.lang = v_tgt_lang and t.is_primary
         where li.lesson_id = p_lesson and li.concept_id <> v_concept
         order by random()
         limit 3
      ) x;
    v_options := coalesce(v_options, '[]'::jsonb) || to_jsonb(v_targets[1]);

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'translate_ab', v_ex_sort + 1, v_concept,
      case
        -- Wybór z listy ma sens dopiero, gdy jest z czego wybierać.
        when jsonb_array_length(v_options) >= 2 then
          jsonb_build_object('prompt', v_sources[1], 'accepted', to_jsonb(v_targets), 'options', v_options)
        else
          jsonb_build_object('prompt', v_sources[1], 'accepted', to_jsonb(v_targets))
      end,
      10
    );

    -- Tłumaczenie na język dziecka: tu właśnie przydaje się kilka odpowiedzi, bo jedno obce
    -- słowo ma po polsku zwykle więcej niż jeden odpowiednik.
    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'translate_ba', v_ex_sort + 2, v_concept,
      jsonb_build_object('prompt', v_targets[1], 'accepted', to_jsonb(v_sources)),
      10
    );

    v_added := 2;

    -- Zadanie ze słuchu wymaga głosu dla języka; bez `tts_lang` nie ma czym przeczytać.
    select l.tts_lang into v_tts from public.languages l where l.code = v_tgt_lang;
    if v_tts is not null then
      insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
      values (
        p_lesson, 'listening', v_ex_sort + 3, v_concept,
        jsonb_build_object('speak', v_targets[1], 'lang', v_tts, 'accepted', to_jsonb(v_targets)),
        15
      );
      v_added := 3;
    end if;
  end if;

  return jsonb_build_object('conceptId', v_concept, 'key', v_key, 'exercises', v_added);
end;
$fn$;

comment on function public.admin_add_word(uuid, text, text, text, text[]) is
  'Dodaje słówko do lekcji razem z zadaniami (tłumaczenie w obie strony i ze słuchu). '
  'Każde pole przyjmuje kilka form po przecinku — pierwsza jest główna, reszta to synonimy.';

-- 2. Poprawianie słówka już dodanego.
create or replace function public.admin_update_word(
  p_concept uuid,
  p_source  text,
  p_target  text,
  p_tags    text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_course     uuid;
  v_src_lang   text;
  v_tgt_lang   text;
  v_sources    text[] := public.split_answers(p_source);
  v_targets    text[] := public.split_answers(p_target);
  v_old_source text;
  v_old_target text;
  v_updated    integer := 0;
  v_skipped    integer := 0;
  v_count      integer;
begin
  perform app_private.assert_admin();

  select c.course_id, co.source_lang, co.target_lang
    into v_course, v_src_lang, v_tgt_lang
    from public.concepts c
    join public.courses co on co.id = c.course_id
   where c.id = p_concept;

  if v_course is null then
    raise exception 'Nie ma takiego słówka' using errcode = '22023';
  end if;

  if coalesce(array_length(v_sources, 1), 0) = 0 or coalesce(array_length(v_targets, 1), 0) = 0 then
    raise exception 'Podaj słowo w obu językach' using errcode = '22023';
  end if;

  select t.text into v_old_source
    from public.terms t
   where t.concept_id = p_concept and t.lang = v_src_lang and t.is_primary;
  select t.text into v_old_target
    from public.terms t
   where t.concept_id = p_concept and t.lang = v_tgt_lang and t.is_primary;

  insert into public.terms (concept_id, lang, text, is_primary)
  values (p_concept, v_src_lang, v_sources[1], true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  insert into public.terms (concept_id, lang, text, is_primary)
  values (p_concept, v_tgt_lang, v_targets[1], true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  perform app_private.replace_synonyms(p_concept, v_src_lang, v_sources);
  perform app_private.replace_synonyms(p_concept, v_tgt_lang, v_targets);

  if p_tags is not null then
    update public.concepts set tags = p_tags where id = p_concept;
  end if;

  -- Tłumaczenie na język uczony. `||` zachowuje to, czego nie ruszamy (podpowiedź),
  -- a lista wyboru dostaje w miejsce starego słowa nowe — reszta dystraktorów zostaje.
  update public.exercises e
     set payload = (e.payload || jsonb_build_object('prompt', v_sources[1], 'accepted', to_jsonb(v_targets)))
                   || case
                        when e.payload ? 'options' then jsonb_build_object('options', (
                          select jsonb_agg(case when x = to_jsonb(v_old_target) then to_jsonb(v_targets[1]) else x end)
                            from jsonb_array_elements(e.payload -> 'options') x
                        ))
                        else '{}'::jsonb
                      end
   where e.concept_id = p_concept and e.type = 'translate_ab';
  get diagnostics v_count = row_count;
  v_updated := v_updated + v_count;

  update public.exercises e
     set payload = (e.payload || jsonb_build_object('prompt', v_targets[1], 'accepted', to_jsonb(v_sources)))
                   || case
                        when e.payload ? 'options' then jsonb_build_object('options', (
                          select jsonb_agg(case when x = to_jsonb(v_old_source) then to_jsonb(v_sources[1]) else x end)
                            from jsonb_array_elements(e.payload -> 'options') x
                        ))
                        else '{}'::jsonb
                      end
   where e.concept_id = p_concept and e.type = 'translate_ba';
  get diagnostics v_count = row_count;
  v_updated := v_updated + v_count;

  update public.exercises e
     set payload = e.payload || jsonb_build_object('speak', v_targets[1], 'accepted', to_jsonb(v_targets))
   where e.concept_id = p_concept and e.type = 'listening';
  get diagnostics v_count = row_count;
  v_updated := v_updated + v_count;

  select count(*) into v_skipped
    from public.exercises e
   where e.concept_id = p_concept
     and e.type not in ('translate_ab', 'translate_ba', 'listening');

  return jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
end;
$fn$;

comment on function public.admin_update_word(uuid, text, text, text[]) is
  'Poprawia słowo główne i synonimy pojęcia w obu językach kursu i przepisuje treść zadań '
  'wygenerowanych z pary słów. Zadań ułożonych ręcznie nie rusza — zwraca ich liczbę jako "skipped".';
