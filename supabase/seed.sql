-- Kurs demonstracyjny PL -> EN.
--
-- Uruchamiane przez `npm run db:reset`, czyli wyłącznie na lokalnej bazie. Języki i odznaki
-- NIE są tutaj — to dane słownikowe, których aplikacja potrzebuje także w chmurze, więc leżą
-- w migracji `…_reference_data.sql`. Tu zostaje sama treść do testowania silnika lekcji;
-- docelowo lekcje wchodzą importem JSON z panelu administratora.

do $seed$
declare
  v_course uuid;
  v_unit   uuid;
  v_lesson uuid;
  v_prev   uuid := null;
  v_concept uuid;
  v_sort   integer;
  u        record;
  w        record;
  v_options jsonb;
begin
  -- Warunek sprawdza TREŚĆ, nie sam kurs: wiersz kursu zakłada migracja `…_starter_course.sql`,
  -- więc pytanie „czy jest kurs?" zawsze dawałoby prawdę i seed nigdy by nie wszedł.
  -- Alias NIE może nazywać się `u` ani `c`: plpgsql rozwiązałby go jako zmienną rekordową
  -- o tej samej nazwie, zadeklarowaną wyżej, i przerwał z „record is not assigned yet".
  if exists (
    select 1 from public.units un
    join public.courses co on co.id = un.course_id
    where co.slug = 'pl-en-starter'
  ) then
    return;
  end if;

  select id into v_course from public.courses where slug = 'pl-en-starter';
  if v_course is null then
    insert into public.courses (slug, source_lang, target_lang, title, description, icon, is_published)
    values ('pl-en-starter', 'pl', 'en', 'Angielski od zera',
            'Pierwsze słówka i zwroty po angielsku.', '🇬🇧', true)
    returning id into v_course;
  end if;

  create temporary table tmp_words (
    unit_slug   text,
    unit_title  text,
    unit_icon   text,
    unit_order  integer,
    lesson_slug text,
    lesson_title text,
    lesson_order integer,
    key         text,
    pl          text,
    en          text,
    emoji       text
  ) on commit drop;

  insert into tmp_words values
    ('zwierzeta','Zwierzęta','🐾',1,'domowe','Zwierzęta domowe',1,'animal.dog',   'pies',   'dog',   '🐶'),
    ('zwierzeta','Zwierzęta','🐾',1,'domowe','Zwierzęta domowe',1,'animal.cat',   'kot',    'cat',   '🐱'),
    ('zwierzeta','Zwierzęta','🐾',1,'domowe','Zwierzęta domowe',1,'animal.bird',  'ptak',   'bird',  '🐦'),
    ('zwierzeta','Zwierzęta','🐾',1,'domowe','Zwierzęta domowe',1,'animal.fish',  'ryba',   'fish',  '🐟'),
    ('zwierzeta','Zwierzęta','🐾',1,'gospodarstwo','Na wsi',2,'animal.horse',     'koń',    'horse', '🐴'),
    ('zwierzeta','Zwierzęta','🐾',1,'gospodarstwo','Na wsi',2,'animal.cow',       'krowa',  'cow',   '🐮'),
    ('zwierzeta','Zwierzęta','🐾',1,'gospodarstwo','Na wsi',2,'animal.sheep',     'owca',   'sheep', '🐑'),
    ('zwierzeta','Zwierzęta','🐾',1,'gospodarstwo','Na wsi',2,'animal.pig',       'świnia', 'pig',   '🐷'),
    ('zwierzeta','Zwierzęta','🐾',1,'male','Małe zwierzęta',3,'animal.mouse',     'mysz',   'mouse', '🐭'),
    ('zwierzeta','Zwierzęta','🐾',1,'male','Małe zwierzęta',3,'animal.rabbit',    'królik', 'rabbit','🐰'),
    ('zwierzeta','Zwierzęta','🐾',1,'male','Małe zwierzęta',3,'animal.frog',      'żaba',   'frog',  '🐸'),
    ('zwierzeta','Zwierzęta','🐾',1,'male','Małe zwierzęta',3,'animal.duck',      'kaczka', 'duck',  '🦆'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-1','Kolory',1,'color.red',         'czerwony','red',   '🔴'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-1','Kolory',1,'color.blue',        'niebieski','blue', '🔵'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-1','Kolory',1,'color.green',       'zielony', 'green', '🟢'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-1','Kolory',1,'color.yellow',      'żółty',   'yellow','🟡'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-2','Czarny i biały',2,'color.black','czarny', 'black', '⚫'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-2','Czarny i biały',2,'color.white','biały',  'white', '⚪'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-2','Czarny i biały',2,'number.one', 'jeden',  'one',   '1️⃣'),
    ('kolory','Kolory i liczby','🎨',2,'kolory-2','Czarny i biały',2,'number.two', 'dwa',    'two',   '2️⃣'),
    ('kolory','Kolory i liczby','🎨',2,'liczby','Liczby',3,'number.three',        'trzy',   'three', '3️⃣'),
    ('kolory','Kolory i liczby','🎨',2,'liczby','Liczby',3,'number.four',         'cztery', 'four',  '4️⃣'),
    ('kolory','Kolory i liczby','🎨',2,'liczby','Liczby',3,'number.five',         'pięć',   'five',  '5️⃣'),
    ('kolory','Kolory i liczby','🎨',2,'liczby','Liczby',3,'number.six',          'sześć',  'six',   '6️⃣');

  -- Działy i lekcje. Lekcje układają się w łańcuch: każda kolejna otwiera się po poprzedniej,
  -- również przez granicę działu.
  for u in
    select distinct unit_slug, unit_title, unit_icon, unit_order, lesson_slug, lesson_title, lesson_order
    from tmp_words order by unit_order, lesson_order
  loop
    select id into v_unit from public.units un where un.course_id = v_course and un.slug = u.unit_slug;
    if not found then
      insert into public.units (course_id, slug, title, icon, sort_order, is_published)
      values (v_course, u.unit_slug, u.unit_title, u.unit_icon, u.unit_order, true)
      returning id into v_unit;
    end if;

    insert into public.lessons (unit_id, slug, title, icon, sort_order, prerequisite_lesson_id, is_published)
    values (v_unit, u.lesson_slug, u.lesson_title, u.unit_icon, u.lesson_order, v_prev, true)
    returning id into v_lesson;
    v_prev := v_lesson;

    v_sort := 0;
    for w in
      select * from tmp_words t
      where t.unit_slug = u.unit_slug and t.lesson_slug = u.lesson_slug
      order by t.key
    loop
      insert into public.concepts (course_id, key, tags)
      values (v_course, w.key, array[w.emoji])
      on conflict (course_id, key) do update set tags = excluded.tags
      returning id into v_concept;

      insert into public.terms (concept_id, lang, text, pos) values (v_concept, 'pl', w.pl, 'noun');
      insert into public.terms (concept_id, lang, text, pos) values (v_concept, 'en', w.en, 'noun');

      insert into public.lesson_items (lesson_id, concept_id, sort_order)
      values (v_lesson, v_concept, v_sort);

      -- Dystraktory z tej samej lekcji: wybór jest trudny, ale sensowny.
      select jsonb_agg(x.en order by x.en) into v_options
      from (
        select t.en from tmp_words t
        where t.lesson_slug = u.lesson_slug and t.unit_slug = u.unit_slug and t.en <> w.en
        limit 3
      ) x;
      v_options := coalesce(v_options, '[]'::jsonb) || to_jsonb(w.en);

      -- PL -> EN jako wybór z listy (dla najmłodszych), EN -> PL i ze słuchu jako pisanie.
      insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points) values
        (v_lesson, 'translate_ab', v_sort * 3,     v_concept,
         jsonb_build_object('prompt', w.pl, 'accepted', jsonb_build_array(w.en), 'options', v_options), 10),
        (v_lesson, 'translate_ba', v_sort * 3 + 1, v_concept,
         jsonb_build_object('prompt', w.en, 'accepted', jsonb_build_array(w.pl)), 10),
        (v_lesson, 'listening',    v_sort * 3 + 2, v_concept,
         jsonb_build_object('speak', w.en, 'lang', 'en-GB', 'accepted', jsonb_build_array(w.en)), 15);

      v_sort := v_sort + 1;
    end loop;
  end loop;

  -- Pierwsza lekcja dostaje komplet typów zadań — jest wzorcem i materiałem do testów.
  select l.id into v_lesson from public.lessons l
   where l.unit_id = (select un.id from public.units un where un.course_id = v_course and un.sort_order = 1)
     and l.slug = 'domowe';

  insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points) values
    (v_lesson, 'fill_blank_choice', 100,
     (select id from public.concepts where course_id = v_course and key = 'animal.dog'),
     jsonb_build_object(
       'sentence', 'My {{blank}} likes to play in the garden.',
       'options', jsonb_build_array('dog', 'door', 'doll', 'desk'),
       'answer', 'dog',
       'translation', 'Mój pies lubi bawić się w ogrodzie.'), 10),

    (v_lesson, 'inflection', 101,
     (select id from public.concepts where course_id = v_course and key = 'animal.cat'),
     jsonb_build_object(
       'base', 'cat',
       'formLabel', 'liczba mnoga',
       'instruction', 'Jak powiesz, że jest ich więcej?',
       'accepted', jsonb_build_array('cats')), 15),

    (v_lesson, 'match_pairs', 102, null,
     jsonb_build_object(
       'instruction', 'Połącz słówka w pary',
       'pairs', jsonb_build_array(
         jsonb_build_object('a', 'pies', 'b', 'dog'),
         jsonb_build_object('a', 'kot',  'b', 'cat'),
         jsonb_build_object('a', 'ptak', 'b', 'bird'),
         jsonb_build_object('a', 'ryba', 'b', 'fish'))), 20),

    (v_lesson, 'sentence_order', 103,
     (select id from public.concepts where course_id = v_course and key = 'animal.dog'),
     jsonb_build_object(
       'prompt', 'Ułóż zdanie: Mam psa.',
       'tokens', jsonb_build_array('I', 'have', 'a', 'dog'),
       'solution', jsonb_build_array('I', 'have', 'a', 'dog')), 20),

    (v_lesson, 'listen_match', 104, null,
     jsonb_build_object(
       'instruction', 'Posłuchaj i dopasuj polskie słowo.',
       'lang', 'en-GB',
       'pairs', jsonb_build_array(
         jsonb_build_object('a', 'pies', 'b', 'dog'),
         jsonb_build_object('a', 'kot',  'b', 'cat'),
         jsonb_build_object('a', 'ptak', 'b', 'bird'),
         jsonb_build_object('a', 'ryba', 'b', 'fish'))), 20);

  -- Testu działu ani powtórki działu seed nie zakłada: oba kafelki końcowe dokłada wyzwalacz
  -- `add_unit_test` przy pierwszym słówku w dziale (`…_unit_test.sql`, `…_unit_practice.sql`).
  -- Dopisanie ich tutaj dawało drugą powtórkę w każdym dziale.
end;
$seed$;
