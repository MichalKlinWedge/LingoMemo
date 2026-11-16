-- Przestawiona kolejność jako prośba o poprawkę.
--
-- „jak się to literuje" zamiast „jak to się literuje" to dla levenshteina odległość rzędu
-- kilkunastu liter — większa niż przy zupełnie innej odpowiedzi. Dlatego progu literówki nie
-- da się tu rozciągnąć i potrzebny jest osobny warunek: te same litery, inny porządek.
--
-- Test pilnuje obu stron: że przestawienie dostaje drugie podejście i że go nie zalicza.
-- Kolejność w zdaniu ma znaczenie, więc poprawka to szansa, a nie zaliczka.

begin;
select plan(9);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-kolejnosc@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-kolejnosc@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kolejnosc', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

grant select on t_ids, t_ctx to authenticated;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

-- Zwrot z czterech wyrazów (przestawienie), krótkie słowo (zamiana liter) i słowo na literówkę.
select public.admin_add_word((select lesson_id from t_ctx), 'phrase.spell',
                             'jak to się literuje', 'how do you spell that');
select public.admin_add_word((select lesson_id from t_ctx), 'animal.fish', 'ryba', 'fish');
select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');

reset role;

update public.exercises set level = 1 where lesson_id = (select lesson_id from t_ctx);

create temporary table t_ex as
  select e.id, c.key
    from public.exercises e
    join public.concepts c on c.id = e.concept_id
   where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'translate_ba';
grant select on t_ex to authenticated;

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

create temporary table t_sesja as
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'test-kolejnosc-1') as id;
grant select on t_sesja to authenticated;

create temporary table t_r (step text primary key, v jsonb);
grant select, insert on t_r to authenticated;

create or replace function pg_temp.ex(p_key text) returns uuid
language sql stable as $$ select id from t_ex where key = p_key $$;

-- 1. Przestawione wyrazy w zdaniu.
insert into t_r values ('kolejnosc', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('phrase.spell'),
  jsonb_build_object('text', 'jak się to literuje'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'kolejnosc'), true,
          'przestawione wyrazy dostają prośbę o poprawkę');
select is((select v ->> 'reason' from t_r where step = 'kolejnosc'), 'order',
          'powód poprawki to kolejność, nie literówka');
select is((select v -> 'correctAnswer' from t_r where step = 'kolejnosc'), 'null'::jsonb,
          'prośba o poprawkę nie zdradza poprawnej odpowiedzi');
select is(
  (select count(*)::integer from public.attempts where exercise_id = pg_temp.ex('phrase.spell')),
  0,
  'prośba o poprawkę nie zapisuje próby'
);

-- 2. To samo jeszcze raz: kolejność w zdaniu ma znaczenie, więc to już błąd.
insert into t_r values ('kolejnosc-2', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('phrase.spell'),
  jsonb_build_object('text', 'jak się to literuje'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'kolejnosc-2'), false,
          'o poprawkę baza prosi tylko raz na zadanie');
select is((select (v ->> 'correct')::boolean from t_r where step = 'kolejnosc-2'), false,
          'przestawiona kolejność nie staje się poprawną odpowiedzią');

-- 3. Zamienione litery w krótkim słowie — dotąd przepadało, bo levenshtein liczy to jako dwie
-- poprawki, a przy czterech literach próg wynosi jedną.
insert into t_r values ('litery', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('animal.fish'),
  jsonb_build_object('text', 'rbya'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'litery'), true,
          'zamienione litery w krótkim słowie też dostają poprawkę');

-- 4. Zwykła literówka dalej działa i dalej ma swój powód.
insert into t_r values ('literowka', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('food.apple'),
  jsonb_build_object('text', 'jablke'), 4000, false));

select is((select v ->> 'reason' from t_r where step = 'literowka'), 'typo',
          'literówka ma powód „typo", nie „order"');

-- 5. Zupełnie inna odpowiedź nie dostaje niczego — inaczej każda pomyłka byłaby „prawie".
insert into t_r values ('inna', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('animal.fish'),
  jsonb_build_object('text', 'samochód'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'inna'), false,
          'inna odpowiedź nie dostaje drugiego podejścia');

select * from finish();
rollback;
