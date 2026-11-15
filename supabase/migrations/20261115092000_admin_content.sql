-- Panel treści: zapisy na kurs dla administratora i dodawanie słówek z zadaniami.
--
-- Kursy, działy i lekcje administrator zakłada zwykłymi zapytaniami — polityki `*_admin`
-- w `…_rls.sql` już na to pozwalają, więc strony panelu nie potrzebują do tego funkcji.
-- Dwie rzeczy jednak potrzebują: zapisy na kurs (uczeń mógł dotąd zapisać tylko sam siebie)
-- i dodanie słówka, bo to pięć tabel naraz i albo wchodzi wszystko, albo nic.

-- 1. Zapisy na kurs robione przez administratora.
--
-- `enrollments_insert_own` zostaje: dziecko samo zapisuje się na kurs otwarty. Druga polityka
-- daje administratorowi wpisywanie i wypisywanie cudzych zapisów. Wypisanie NIE kasuje
-- postępów — `lesson_progress`, `attempts` i `srs_state` wiszą na użytkowniku, nie na zapisie,
-- więc ponowny zapis przywraca dziecku jego stan.
grant delete on public.enrollments to authenticated;

drop policy if exists enrollments_admin on public.enrollments;
create policy enrollments_admin on public.enrollments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2. Dodanie słówka do lekcji razem z zadaniami.
--
-- Z jednej pary słów powstaje pojęcie, dwa terminy, pozycja w lekcji i trzy zadania:
-- tłumaczenie w obie strony oraz ze słuchu. Dokładnie tak samo robi to seed i import —
-- lekcja założona w panelu jest od razu przechodzalna, a nie pusta.
--
-- Powtórne wywołanie z tym samym kluczem aktualizuje terminy i nie dubluje zadań.
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
  v_source   text := btrim(coalesce(p_source, ''));
  v_target   text := btrim(coalesce(p_target, ''));
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

  if v_source = '' or v_target = '' then
    raise exception 'Podaj słowo w obu językach' using errcode = '22023';
  end if;

  if v_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Klucz słówka: małe litery, cyfry oraz . _ -, np. "food.apple"' using errcode = '22023';
  end if;

  insert into public.concepts (course_id, key, tags)
  values (v_course, v_key, coalesce(p_tags, '{}'))
  on conflict (course_id, key) do update set tags = excluded.tags
  returning id into v_concept;

  -- Słowo główne w każdym z dwóch języków kursu. Synonimy dokłada się importem.
  insert into public.terms (concept_id, lang, text, is_primary)
  values (v_concept, v_src_lang, v_source, true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  insert into public.terms (concept_id, lang, text, is_primary)
  values (v_concept, v_tgt_lang, v_target, true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

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

    -- Dystraktory do wyboru z listy: trzy inne słowa z tej samej lekcji.
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
    v_options := coalesce(v_options, '[]'::jsonb) || to_jsonb(v_target);

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'translate_ab', v_ex_sort + 1, v_concept,
      case
        -- Wybór z listy ma sens dopiero, gdy jest z czego wybierać.
        when jsonb_array_length(v_options) >= 2 then
          jsonb_build_object('prompt', v_source, 'accepted', jsonb_build_array(v_target), 'options', v_options)
        else
          jsonb_build_object('prompt', v_source, 'accepted', jsonb_build_array(v_target))
      end,
      10
    );

    insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
    values (
      p_lesson, 'translate_ba', v_ex_sort + 2, v_concept,
      jsonb_build_object('prompt', v_target, 'accepted', jsonb_build_array(v_source)),
      10
    );

    v_added := 2;

    -- Zadanie ze słuchu wymaga głosu dla języka; bez `tts_lang` nie ma czym przeczytać.
    select l.tts_lang into v_tts from public.languages l where l.code = v_tgt_lang;
    if v_tts is not null then
      insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
      values (
        p_lesson, 'listening', v_ex_sort + 3, v_concept,
        jsonb_build_object('speak', v_target, 'lang', v_tts, 'accepted', jsonb_build_array(v_target)),
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
  'Powtórzone wywołanie aktualizuje terminy i nie dubluje zadań.';

revoke execute on function public.admin_add_word(uuid, text, text, text, text[]) from anon, public;
grant execute on function public.admin_add_word(uuid, text, text, text, text[]) to authenticated;
