-- Panel treści: dodawanie słówek z zadaniami i zapisy na kurs robione przez administratora.
--
-- Kursy, działy i lekcje idą zwykłymi zapytaniami pod politykami `*_admin`, więc tutaj
-- sprawdzamy to, co ma własną funkcję albo własną politykę.

begin;
select plan(34);

create or replace function pg_temp.make_user(p_email text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'test-nie-do-logowania', now(), '{}'::jsonb,
    jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-content@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-content@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Pusta lekcja w nowym dziale: dodawanie słówek nie miesza się z treścią z seeda.
create temporary table t_ctx as
select c.id as course_id from public.courses c where c.slug = 'pl-en-starter';

with u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select course_id, 'test-owoce', 'Owoce (test)', 50, true from t_ctx
  returning id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, 'test-lekcja', 'Lekcja testowa', 1, true from u;

create temporary table t_lesson as
select l.id from public.lessons l
  join public.units un on un.id = l.unit_id
 where un.slug = 'test-owoce' and l.slug = 'test-lekcja';

grant select on t_ids, t_ctx, t_lesson to authenticated;

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_add_word(%L, ''food.apple'', ''jabłko'', ''apple'')', (select id from t_lesson)),
  '42501',
  null,
  'uczeń nie doda słówka'
);

select throws_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'admin'), (select course_id from t_ctx)),
  '42501',
  null,
  'uczeń nie zapisze na kurs kogoś innego'
);

select lives_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'uczen'), (select course_id from t_ctx)),
  'uczeń zapisuje na kurs sam siebie'
);

reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  format('select public.admin_add_word(%L, ''Food Apple'', ''jabłko'', ''apple'')', (select id from t_lesson)),
  '22023',
  null,
  'klucz z wielkimi literami i spacją nie przechodzi'
);

select throws_ok(
  format('select public.admin_add_word(%L, ''food.apple'', ''jabłko'', ''  '')', (select id from t_lesson)),
  '22023',
  null,
  'puste słowo w drugim języku nie przechodzi'
);

select throws_ok(
  'select public.admin_add_word(''00000000-0000-0000-0000-000000000009''::uuid, ''food.apple'', ''jabłko'', ''apple'')',
  '22023',
  null,
  'nie da się dodać słówka do nieistniejącej lekcji'
);

select is(
  (select (public.admin_add_word((select id from t_lesson), 'food.apple', 'jabłko', 'apple') ->> 'exercises')::integer),
  3,
  'słówko wchodzi razem z trzema zadaniami'
);

-- Administrator wypisuje i zapisuje innych.
select lives_ok(
  format('delete from public.enrollments where user_id = %L', (select id from t_ids where name = 'uczen')),
  'administrator wypisuje ucznia z kursu'
);

select lives_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'uczen'), (select course_id from t_ctx)),
  'administrator zapisuje ucznia na kurs'
);

reset role;

-- --- co powstało ---
select is(
  (select count(*)::integer from public.terms t
     join public.concepts c on c.id = t.concept_id
    where c.key = 'food.apple' and t.text in ('jabłko', 'apple')),
  2,
  'powstały terminy w obu językach kursu'
);

select is(
  (select count(*)::integer from public.lesson_items li where li.lesson_id = (select id from t_lesson)),
  1,
  'słówko jest przypięte do lekcji'
);

select is(
  (select array_agg(e.type::text order by e.sort_order)
     from public.exercises e where e.lesson_id = (select id from t_lesson)),
  array['translate_ab', 'translate_ba', 'listening'],
  'zadania to tłumaczenie w obie strony i ze słuchu'
);

select is(
  (select e.payload ->> 'lang' from public.exercises e
    where e.lesson_id = (select id from t_lesson) and e.type = 'listening'),
  'en-GB',
  'zadanie ze słuchu bierze język z tabeli języków'
);

-- Drugie wywołanie z tym samym kluczem: aktualizacja, nie duplikat.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);
select public.admin_add_word((select id from t_lesson), 'food.apple', 'jabłuszko', 'apple');
reset role;

select is(
  (select count(*)::integer from public.exercises e where e.lesson_id = (select id from t_lesson)),
  3,
  'powtórne dodanie tego samego słówka nie dubluje zadań'
);

-- --- poprawianie słówka ---
--
-- Drugie słówko w lekcji daje pierwszemu dystraktor w zadaniu wyboru, a ręcznie ułożone zadanie
-- sprawdza, czy poprawka go nie rusza.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);
select public.admin_add_word((select id from t_lesson), 'food.pear', 'gruszka', 'pear');
reset role;

create temporary table t_concepts as
select key, id from public.concepts where key in ('food.apple', 'food.pear');
grant select on t_concepts to authenticated;

insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
values (
  (select id from t_lesson), 'fill_blank_choice', 99, (select id from t_concepts where key = 'food.apple'),
  jsonb_build_object(
    'sentence', 'I eat an {{blank}} every day.',
    'options', jsonb_build_array('apple', 'pear', 'plum'),
    'answer', 'apple'),
  10
);

-- --- zadanie z obrazkiem ---
--
-- Jedyne zadanie, które panel składa z ręki: idzie zwykłym `insert` pod polityką
-- `exercises_admin`, a kształtu payloadu pilnuje `validate_exercise_payload` jako CHECK.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select lives_ok(
  format(
    $sql$insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
         values (%L, 'image_choice', 98, %L,
           jsonb_build_object(
             'prompt', 'apple',
             'options', jsonb_build_array('2026/jablko.png', '2026/gruszka.png'),
             'answer', '2026/jablko.png'), 10)$sql$,
    (select id from t_lesson), (select id from t_concepts where key = 'food.apple')),
  'administrator dodaje zadanie z obrazkiem zwykłym insertem'
);

select throws_ok(
  format(
    $sql$insert into public.exercises (lesson_id, type, sort_order, payload, points)
         values (%L, 'image_choice', 97,
           jsonb_build_object(
             'prompt', 'apple',
             'options', jsonb_build_array('2026/jablko.png', '2026/gruszka.png'),
             'answer', '2026/sliwka.png'), 10)$sql$,
    (select id from t_lesson)),
  '23514',
  null,
  'obrazek spoza listy nie przejdzie jako poprawna odpowiedź'
);

reset role;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format(
    $sql$insert into public.exercises (lesson_id, type, sort_order, payload, points)
         values (%L, 'image_choice', 96,
           jsonb_build_object(
             'prompt', 'apple',
             'options', jsonb_build_array('2026/jablko.png', '2026/gruszka.png'),
             'answer', '2026/jablko.png'), 10)$sql$,
    (select id from t_lesson)),
  '42501',
  null,
  'uczeń nie doda sobie zadania z obrazkiem'
);

reset role;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_update_word(%L, ''jabłko'', ''apples'')', (select id from t_concepts where key = 'food.apple')),
  '42501',
  null,
  'uczeń nie poprawi słówka'
);

reset role;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select is(
  (select public.admin_update_word((select id from t_concepts where key = 'food.apple'), 'jabłko', 'apples', array['🍎'])),
  jsonb_build_object('updated', 3, 'skipped', 1),
  'poprawka przepisuje trzy zadania z automatu i zostawia jedno ułożone ręcznie'
);

reset role;

select is(
  (select array_agg(t.text order by t.lang) from public.terms t
    where t.concept_id = (select id from t_concepts where key = 'food.apple') and t.is_primary),
  array['apples', 'jabłko'],
  'słowo główne poprawione w obu językach kursu'
);

select is(
  (select e.payload from public.exercises e
    where e.concept_id = (select id from t_concepts where key = 'food.apple') and e.type = 'translate_ab'),
  jsonb_build_object('prompt', 'jabłko', 'accepted', jsonb_build_array('apples')),
  'zadanie z polskiego na angielski ma nową treść'
);

select is(
  (select e.payload ->> 'speak' from public.exercises e
    where e.concept_id = (select id from t_concepts where key = 'food.apple') and e.type = 'listening'),
  'apples',
  'zadanie ze słuchu czyta nowe słowo'
);

-- Dystraktor w cudzym zadaniu zostaje stary i tak ma być: to tylko błędna odpowiedź do wyboru,
-- a przepisywanie cudzych list popsułoby te ułożone ręcznie przy imporcie.
select is(
  (select e.payload -> 'options' from public.exercises e
    where e.concept_id = (select id from t_concepts where key = 'food.pear') and e.type = 'translate_ab'),
  jsonb_build_array('apple', 'pear'),
  'lista wyboru w zadaniu innego słówka zostaje nietknięta'
);

select is(
  (select e.payload ->> 'answer' from public.exercises e
    where e.lesson_id = (select id from t_lesson) and e.type = 'fill_blank_choice'),
  'apple',
  'zadanie ułożone ręcznie zostaje nietknięte'
);

-- --- języki kursu ---
--
-- Terminy wiszą na kodzie języka, a treść zadania jest kopią słowa, więc podmiana języka
-- w kursie z materiałem zostawiłaby słówka w starym języku. Pilnuje tego wyzwalacz.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  $$update public.courses set target_lang = 'de' where slug = 'pl-en-starter'$$,
  '22023',
  'Nie zmienisz języków kursu, w którym są już słówka. Najpierw usuń słówka albo załóż osobny kurs.',
  'w kursie ze słówkami języków nie da się podmienić'
);

select lives_ok(
  $$update public.courses set title = 'Angielski od zera (test)' where slug = 'pl-en-starter'$$,
  'zmiana samej nazwy kursu przechodzi'
);

insert into public.courses (slug, source_lang, target_lang, title)
values ('test-pusty', 'pl', 'en', 'Kurs pusty (test)');
update public.courses set target_lang = 'de' where slug = 'test-pusty';

select is(
  (select c.target_lang from public.courses c where c.slug = 'test-pusty'),
  'de',
  'w kursie bez słówek język uczony da się jeszcze zmienić'
);

reset role;

-- --- kasowanie ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_delete_course(%L)', (select course_id from t_ctx)),
  '42501',
  null,
  'uczeń nie usunie kursu'
);

reset role;

-- Dział idzie zwykłym `delete` pod polityką `units_admin`. Lekcje znikają z nim kaskadą,
-- ale słówka zostają przy kursie — wisi na nich stan powtórek dziecka.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

delete from public.units where slug = 'test-owoce';

select is(
  (select count(*)::integer from public.lessons l where l.id = (select id from t_lesson)),
  0,
  'usunięcie działu kasuje jego lekcje'
);

select is(
  (select count(*)::integer from public.concepts c where c.id in (select id from t_concepts)),
  2,
  'słówka zostają przy kursie, bo wisi na nich stan powtórek'
);

-- Kurs ma słówka wpięte w lekcje, a `lesson_items.concept_id` ma `on delete restrict`:
-- samo `delete from courses` wywaliłoby się tu na kaskadzie. Funkcja kasuje działy pierwsze.
select lives_ok(
  format('select public.admin_delete_course(%L)', (select course_id from t_ctx)),
  'kurs ze słówkami kasuje się mimo „restrict" na pozycjach lekcji'
);

select is(
  (select count(*)::integer from public.concepts c where c.course_id = (select course_id from t_ctx)),
  0,
  'razem z kursem znikają jego słówka'
);

reset role;

-- --- kasowanie lekcji ---
--
-- Lekcja idzie zwykłym `delete` pod polityką `lessons_admin`: wszystkie klucze obce wskazujące
-- lekcję mają `on delete cascade`. Sprawdzamy, że kaskada zabiera zadania i postępy dzieci,
-- ale zostawia dział i kurs. Kurs z poprzednich asercji już nie istnieje, więc stawiamy własny.
create temporary table t_del as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kasowanie-lekcji', 'pl', 'en', 'Kurs do kasowania lekcji', false)
  returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order)
  select id, 'dzial', 'Dział', 1 from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order)
  select id, 'lekcja', 'Lekcja', 1 from d returning id
)
select (select id from l) as lesson_id, (select id from d) as unit_id, (select course_id from d) as course_id;
grant select on t_del to authenticated;

insert into public.exercises (lesson_id, type, sort_order, payload, points)
values (
  (select lesson_id from t_del), 'translate_ab', 1,
  jsonb_build_object('prompt', 'jabłko', 'accepted', jsonb_build_array('apple')), 10
);

insert into public.lesson_progress (user_id, lesson_id, status)
values ((select id from t_ids where name = 'uczen'), (select lesson_id from t_del), 'in_progress');

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

delete from public.lessons where id = (select lesson_id from t_del);

reset role;

select is(
  (select count(*)::integer from public.lessons l where l.id = (select lesson_id from t_del)),
  1,
  'uczeń nie usunie lekcji — polityka nie daje mu do niej żadnego wiersza'
);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select lives_ok(
  format('delete from public.lessons where id = %L', (select lesson_id from t_del)),
  'administrator usuwa lekcję'
);

reset role;

select is(
  (select count(*)::integer from public.exercises e where e.lesson_id = (select lesson_id from t_del)),
  0,
  'zadania lekcji znikają razem z nią'
);

select is(
  (select count(*)::integer from public.lesson_progress p where p.lesson_id = (select lesson_id from t_del)),
  0,
  'postępy dzieci z tej lekcji znikają razem z nią'
);

select is(
  (select count(*)::integer from public.units u where u.id = (select unit_id from t_del)),
  1,
  'dział zostaje — kasowanie lekcji nie rusza niczego wyżej'
);

select * from finish();
rollback;
