-- Zdanie z luką do wpisania: walidacja, poziom i dorabianie z wersji z kafelkami.
--
-- Poziom trudny miał jeden rodzaj zadania (pisanie ze słuchu), bo tylko taki umiał dorobić
-- generator. Drugi bierze się z treści, która już jest: z każdego `fill_blank_choice` powstaje
-- to samo zdanie bez listy. Sprawdzamy, że powstaje raz, zabiera ze sobą polskie zdanie i wiąże
-- się z pierwowzorem przez `easy_for` — to po nim podpowiedź wie, czym zamienić zadanie.

begin;
select plan(10);

-- 1. Walidacja payloadu.
select ok(
  public.validate_exercise_payload(
    'fill_blank_typing',
    '{"sentence": "I have a {{blank}}.", "accepted": ["cat"]}'::jsonb),
  'zdanie z luką i odpowiedzią przechodzi walidację');

select ok(
  not public.validate_exercise_payload(
    'fill_blank_typing',
    '{"sentence": "I have a cat.", "accepted": ["cat"]}'::jsonb),
  'zdanie bez {{blank}} nie przechodzi — nie ma czego wpisać');

select ok(
  not public.validate_exercise_payload(
    'fill_blank_typing',
    '{"sentence": "I have a {{blank}}."}'::jsonb),
  'zdanie bez odpowiedzi nie przechodzi');

-- 2. Poziom. Wpisywanie jednego słowa to zwykle poziom 2, ale nie tutaj: najpierw trzeba
-- przeczytać zdanie w języku kursu.
select is(
  public.default_exercise_level(
    'fill_blank_typing',
    '{"sentence": "I have a {{blank}}.", "accepted": ["cat"]}'::jsonb),
  3::smallint,
  'uzupełnianie zdania z klawiatury jest zadaniem trudnym');

-- 3. Dorabianie z wersji z kafelkami.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-luka', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
), p as (
  insert into public.concepts (course_id, key, tags)
  select (select course_id from d), 'animal.cat', '{}' returning id
), t1 as (
  insert into public.terms (concept_id, lang, text, is_primary)
  select id, 'pl', 'kot', true from p returning concept_id
), t2 as (
  insert into public.terms (concept_id, lang, text, is_primary)
  select id, 'en', 'cat', true from p returning concept_id
), i as (
  insert into public.lesson_items (lesson_id, concept_id, sort_order)
  select (select id from l), (select id from p), 1 returning lesson_id
)
select (select id from l) as lesson_id, (select id from p) as concept_id,
       (select concept_id from t1) as t1, (select concept_id from t2) as t2,
       (select lesson_id from i) as li;

insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
select lesson_id, 'fill_blank_choice', 1, concept_id,
       jsonb_build_object(
         'sentence', 'I have a {{blank}}.',
         'options', jsonb_build_array('cat', 'dog', 'bird'),
         'answer', 'cat',
         'translation', 'Mam kota.'),
       10
  from t_ctx;

select is(
  public.build_fill_blank_typing((select lesson_id from t_ctx)),
  1,
  'generator dorabia wersję z wpisywaniem');

select is(
  (select e.payload from public.exercises e
    where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'fill_blank_typing'),
  jsonb_build_object(
    'sentence', 'I have a {{blank}}.',
    'translation', 'Mam kota.',
    'accepted', jsonb_build_array('cat')),
  'payload ma zdanie, polskie tłumaczenie i odpowiedź');

select ok(
  exists (
    select 1 from public.exercises wybor
     where wybor.lesson_id = (select lesson_id from t_ctx)
       and wybor.type = 'fill_blank_choice'
       and wybor.easy_for = (
         select e.id from public.exercises e
          where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'fill_blank_typing')
  ),
  'wersja z kafelkami wskazuje nową jako swój pierwowzór');

select is(
  public.build_fill_blank_typing((select lesson_id from t_ctx)),
  0,
  'drugi przebieg nic nie dokłada');

-- 4. Zdanie bez tłumaczenia w treści. Klucza nie ma wtedy WCALE, nie jako `null`: null
-- przeszedłby walidację i wyszedł pustym wierszem pod luką na ekranie dziecka.
insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
select lesson_id, 'fill_blank_choice', 2, concept_id,
       jsonb_build_object(
         'sentence', 'I see a {{blank}}.',
         'options', jsonb_build_array('cat', 'dog', 'bird'),
         'answer', 'dog'),
       10
  from t_ctx;

select is(
  public.build_fill_blank_typing((select lesson_id from t_ctx)),
  1,
  'generator dorabia wersję także dla zdania bez tłumaczenia');

select is(
  (select e.payload from public.exercises e
    where e.lesson_id = (select lesson_id from t_ctx)
      and e.type = 'fill_blank_typing'
      and e.payload ->> 'sentence' = 'I see a {{blank}}.'),
  jsonb_build_object('sentence', 'I see a {{blank}}.', 'accepted', jsonb_build_array('dog')),
  'bez tłumaczenia w pierwowzorze klucza „translation" nie ma w payloadzie wcale');

select * from finish();
rollback;
