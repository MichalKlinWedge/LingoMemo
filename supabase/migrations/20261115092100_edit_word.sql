-- Poprawianie słówka już dodanego do lekcji.
--
-- Sama zmiana tekstu w `terms` nie wystarcza: zadania mają treść przepisaną do `payload`
-- (inaczej sprawdzanie odpowiedzi musiałoby przy każdej próbie schodzić do słownika), więc
-- literówka poprawiona tylko w słówku zostawałaby w zadaniach i dziecko dalej widziałoby „aple".
--
-- Poprawiamy WYŁĄCZNIE zadania wygenerowane z pary słów — tłumaczenie w obie strony i ze słuchu.
-- Zadania ułożone ręcznie (zdanie z luką, rozsypanka, pary, odmiana) mają własny tekst,
-- w którym słowo bywa odmienione albo wplecione w zdanie; przepisanie go automatem zepsułoby
-- je bardziej, niż naprawiło. Funkcja zwraca, ilu zadań nie ruszyła, a panel to pokazuje.
--
-- Zmiana idzie po WSZYSTKICH lekcjach kursu, bo pojęcie jest wspólne dla kursu: słowo poprawione
-- w jednej lekcji nie może zostać błędne w drugiej.

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
  v_source     text := btrim(coalesce(p_source, ''));
  v_target     text := btrim(coalesce(p_target, ''));
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

  if v_source = '' or v_target = '' then
    raise exception 'Podaj słowo w obu językach' using errcode = '22023';
  end if;

  select t.text into v_old_source
    from public.terms t
   where t.concept_id = p_concept and t.lang = v_src_lang and t.is_primary;
  select t.text into v_old_target
    from public.terms t
   where t.concept_id = p_concept and t.lang = v_tgt_lang and t.is_primary;

  -- Słowo główne w obu językach kursu. Synonimy (`is_primary = false`) zostają nietknięte.
  insert into public.terms (concept_id, lang, text, is_primary)
  values (p_concept, v_src_lang, v_source, true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  insert into public.terms (concept_id, lang, text, is_primary)
  values (p_concept, v_tgt_lang, v_target, true)
  on conflict (concept_id, lang) where is_primary do update set text = excluded.text;

  if p_tags is not null then
    update public.concepts set tags = p_tags where id = p_concept;
  end if;

  -- Tłumaczenie na język uczony. `||` zachowuje to, czego nie ruszamy (podpowiedź),
  -- a lista wyboru dostaje w miejsce starego słowa nowe — reszta dystraktorów zostaje.
  update public.exercises e
     set payload = (e.payload || jsonb_build_object('prompt', v_source, 'accepted', jsonb_build_array(v_target)))
                   || case
                        when e.payload ? 'options' then jsonb_build_object('options', (
                          select jsonb_agg(case when x = to_jsonb(v_old_target) then to_jsonb(v_target) else x end)
                            from jsonb_array_elements(e.payload -> 'options') x
                        ))
                        else '{}'::jsonb
                      end
   where e.concept_id = p_concept and e.type = 'translate_ab';
  get diagnostics v_count = row_count;
  v_updated := v_updated + v_count;

  update public.exercises e
     set payload = (e.payload || jsonb_build_object('prompt', v_target, 'accepted', jsonb_build_array(v_source)))
                   || case
                        when e.payload ? 'options' then jsonb_build_object('options', (
                          select jsonb_agg(case when x = to_jsonb(v_old_source) then to_jsonb(v_source) else x end)
                            from jsonb_array_elements(e.payload -> 'options') x
                        ))
                        else '{}'::jsonb
                      end
   where e.concept_id = p_concept and e.type = 'translate_ba';
  get diagnostics v_count = row_count;
  v_updated := v_updated + v_count;

  update public.exercises e
     set payload = e.payload || jsonb_build_object('speak', v_target, 'accepted', jsonb_build_array(v_target))
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
  'Poprawia słowo główne pojęcia w obu językach kursu i przepisuje treść zadań wygenerowanych '
  'z pary słów. Zadań ułożonych ręcznie nie rusza — zwraca ich liczbę jako "skipped".';

revoke execute on function public.admin_update_word(uuid, text, text, text[]) from anon, public;
grant execute on function public.admin_update_word(uuid, text, text, text[]) to authenticated;
