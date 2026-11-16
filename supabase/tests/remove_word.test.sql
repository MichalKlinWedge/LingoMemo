-- Usuwanie słówka z lekcji.
--
-- Sedno jest w tym, czego funkcja NIE kasuje: słówka, które dziecko już widziało (wisi na nim
-- stan powtórek), i słówka używanego w innej lekcji. Kasuje się tylko to, czego nikt nie tknął
-- i co nigdzie już nie pracuje — inaczej literówki zostawiałyby w kursie niewidoczne śmieci.

begin;
select plan(12);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-rw@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-rw@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Własny kurs: dwie lekcje w jednym dziale.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-usuwanie-slowek', 'pl', 'en', 'Kurs testowy', false) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order)
  select id, 'dzial', 'Dział', 1 from k returning id, course_id
), l1 as (
  insert into public.lessons (unit_id, slug, title, sort_order)
  select id, 'lekcja-1', 'Lekcja 1', 1 from d returning id
), l2 as (
  insert into public.lessons (unit_id, slug, title, sort_order)
  select id, 'lekcja-2', 'Lekcja 2', 2 from d returning id
)
select (select course_id from d) as course_id, (select id from l1) as lesson1, (select id from l2) as lesson2;

grant select on t_ids, t_ctx to authenticated;

-- Wejście jako administrator: słówka dokłada funkcja, więc potrzebuje roli.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

-- „jabłko" tylko w lekcji 1, „gruszka" w obu, „banan" w lekcji 1 i już przerabiany przez dziecko.
select public.admin_add_word((select lesson1 from t_ctx), 'test.apple', 'jabłko', 'apple');
select public.admin_add_word((select lesson1 from t_ctx), 'test.pear', 'gruszka', 'pear');
select public.admin_add_word((select lesson2 from t_ctx), 'test.pear', 'gruszka', 'pear');
select public.admin_add_word((select lesson1 from t_ctx), 'test.banana', 'banan', 'banana');

reset role;

-- Klucze z przedrostkiem `test.`, a nie `food.`: asercje niżej liczą pojęcia po samym kluczu,
-- a `food.apple` siedzi też w treści `pl-en-starter` z `content/pl-en/jedzenie-owoce.json`.
-- Klucz pojęcia jest unikalny w obrębie KURSU, nie całej bazy — więc własny kurs nie wystarczy,
-- żeby liczenie po kluczu dawało to, co ten plik zakłada.
create temporary table t_concepts as
select key, id from public.concepts where key in ('test.apple', 'test.pear', 'test.banana');
grant select on t_concepts to authenticated;

-- Dziecko przerobiło już banana — stan powtórek ma zostać.
insert into public.srs_state (user_id, concept_id, course_id)
values (
  (select id from t_ids where name = 'uczen'),
  (select id from t_concepts where key = 'test.banana'),
  (select course_id from t_ctx)
);

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_remove_word(%L, %L)',
         (select lesson1 from t_ctx), (select id from t_concepts where key = 'test.apple')),
  '42501',
  null,
  'uczeń nie usunie słówka z lekcji'
);

reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  format('select public.admin_remove_word(%L, %L)',
         (select lesson2 from t_ctx), (select id from t_concepts where key = 'test.apple')),
  '22023',
  null,
  'nie da się usunąć słówka z lekcji, w której go nie ma'
);

-- 1. Słówko nietknięte i nigdzie indziej nieużywane: znika z kursu.
select is(
  (select public.admin_remove_word((select lesson1 from t_ctx), (select id from t_concepts where key = 'test.apple'))),
  jsonb_build_object('key', 'test.apple', 'exercises', 3, 'removed', 'course'),
  'słówko, którego nikt nie widział, znika razem z zadaniami i terminami'
);

-- 2. Słówko używane w drugiej lekcji: schodzi tylko z tej jednej.
select is(
  (select public.admin_remove_word((select lesson1 from t_ctx), (select id from t_concepts where key = 'test.pear'))),
  jsonb_build_object('key', 'test.pear', 'exercises', 3, 'removed', 'lesson'),
  'słówko z drugiej lekcji zostaje przy kursie'
);

-- 3. Słówko ze stanem powtórek: zostaje, choć nigdzie już nie występuje.
select is(
  (select public.admin_remove_word((select lesson1 from t_ctx), (select id from t_concepts where key = 'test.banana'))),
  jsonb_build_object('key', 'test.banana', 'exercises', 3, 'removed', 'lesson'),
  'słówko, które dziecko już przerabiało, zostaje mimo zdjęcia z lekcji'
);

reset role;

-- --- co zostało ---
select is(
  (select count(*)::integer from public.concepts c where c.key = 'test.apple'),
  0,
  'pojęcie nietkniętego słówka zniknęło'
);

select is(
  (select count(*)::integer from public.terms t
     join public.concepts c on c.id = t.concept_id where c.key = 'test.apple'),
  0,
  'razem z pojęciem znikają jego terminy'
);

select is(
  (select count(*)::integer from public.concepts c where c.key in ('test.pear', 'test.banana')),
  2,
  'gruszka i banan zostają przy kursie'
);

select is(
  (select count(*)::integer from public.srs_state s
    where s.concept_id = (select id from t_concepts where key = 'test.banana')),
  1,
  'stan powtórek dziecka zostaje nietknięty'
);

select is(
  (select count(*)::integer from public.lesson_items li where li.lesson_id = (select lesson1 from t_ctx)),
  0,
  'w lekcji nie ma już żadnego z usuniętych słówek'
);

select is(
  (select count(*)::integer from public.exercises e where e.lesson_id = (select lesson1 from t_ctx)),
  0,
  'zadania tych słówek zniknęły z lekcji'
);

select is(
  (select count(*)::integer from public.exercises e where e.lesson_id = (select lesson2 from t_ctx)),
  3,
  'zadania drugiej lekcji zostają nietknięte'
);

select * from finish();
rollback;
