-- Prośba o poprawienie literówki w zadaniu z wpisywaniem.
--
-- Bliska pomyłka (jedna litera, przy dłuższym słowie dwie) nie jest od razu oceniana: baza
-- oddaje `retry` i czeka na drugie podejście, nie zapisując próby ani nie ruszając powtórek.
-- Drugi raz w tym samym zadaniu już nie poprosi — inaczej dziecko poprawiałoby w kółko,
-- aż trafi.

begin;
select plan(13);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-literowka@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-literowka@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-literowka', 'pl', 'en', 'Kurs testowy', true) returning id
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

-- Cztery słówka różnej długości: na każdym sprawdza się inna granica progu.
select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');
select public.admin_add_word((select lesson_id from t_ctx), 'school.calendar', 'kalendarz', 'calendar');
select public.admin_add_word((select lesson_id from t_ctx), 'animal.cat', 'kot', 'cat');
select public.admin_add_word((select lesson_id from t_ctx), 'food.banana', 'banan', 'banana');

reset role;

-- Ten plik sprawdza ocenianie, nie dobór trudności: wszystko na poziomie łatwym, żeby etap
-- wydał komplet zadań.
update public.exercises set level = 1 where lesson_id = (select lesson_id from t_ctx);

-- Pisanie po polsku, czyli `translate_ba` — `translate_ab` przy kilku słówkach w lekcji
-- dostaje listę opcji i staje się klikaniem.
--
-- Reszta zadań znika z lekcji: od `…_word_on_every_level.sql` do etapu wchodzi JEDNO zadanie
-- na słówko, losowane z jego wariantów. Zostawiamy więc po jednym — tym, które ten plik ocenia.
delete from public.exercises
 where lesson_id = (select lesson_id from t_ctx) and type <> 'translate_ba';

create temporary table t_ex as
  select e.id, e.concept_id, c.key
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
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'test-literowka-1') as id;
grant select on t_sesja to authenticated;

create temporary table t_r (step text primary key, v jsonb);
grant select, insert on t_r to authenticated;

create or replace function pg_temp.ex(p_key text) returns uuid
language sql stable as $$ select id from t_ex where key = p_key $$;

-- 1. Jedna litera w sześcioliterowym słowie: „jablke" zamiast „jabłko".
insert into t_r values ('jedna', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('food.apple'), jsonb_build_object('text', 'jablke'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'jedna'), true,
          'jedna litera obok to prośba o poprawkę');
select is((select (v ->> 'correct')::boolean from t_r where step = 'jedna'), false,
          'prośba o poprawkę nie jest zaliczeniem');
select is((select v -> 'correctAnswer' from t_r where step = 'jedna'), 'null'::jsonb,
          'prośba o poprawkę nie zdradza poprawnej odpowiedzi');

-- 2. To samo zadanie jeszcze raz: drugi raz baza już ocenia.
insert into t_r values ('jedna-drugi-raz', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('food.apple'), jsonb_build_object('text', 'jablke'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'jedna-drugi-raz'), false,
          'o poprawkę baza prosi tylko raz na zadanie');
select is((select (v ->> 'correct')::boolean from t_r where step = 'jedna-drugi-raz'), true,
          'po poprawce jedna literówka nadal jest zaliczana');
select is((select (v ->> 'nearMiss')::boolean from t_r where step = 'jedna-drugi-raz'), true,
          'zaliczenie z literówką jest odnotowane');

-- 3. Dwie litery, ale słowo długie (dziewięć liter).
insert into t_r values ('dwie', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('school.calendar'), jsonb_build_object('text', 'kalandaz'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'dwie'), true,
          'przy długim słowie dwie litery też dostają poprawkę');

insert into t_r values ('dwie-drugi-raz', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('school.calendar'), jsonb_build_object('text', 'kalandaz'), 4000, false));

select is((select (v ->> 'correct')::boolean from t_r where step = 'dwie-drugi-raz'), false,
          'dwie litery po poprawce to już błąd');

-- 4. Krótkie słowo: „kol" zamiast „kot" to nie potknięcie palca, tylko inne słowo.
insert into t_r values ('krotkie', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('animal.cat'), jsonb_build_object('text', 'kol'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'krotkie'), false,
          'przy trzyliterowym słowie nie ma drugiego podejścia');

-- 5. Klikanie nie dostaje poprawki — kafelka nie da się poprawić o literę.
insert into t_r values ('klikniecie', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('food.banana'), jsonb_build_object('choice', 'banam'), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'klikniecie'), false,
          'odpowiedź z listy nie dostaje prośby o poprawkę');

-- 6. „Nie wiem, pomiń" zostaje pominięciem, nawet gdy w polu było prawie dobre słowo.
insert into t_r values ('pominiecie', public.submit_attempt(
  (select id from t_sesja), pg_temp.ex('food.banana'), jsonb_build_object('skipped', true), 4000, false));

select is((select (v ->> 'retry')::boolean from t_r where step = 'pominiecie'), false,
          'pominięcie nie zamienia się w prośbę o poprawkę');

reset role;

-- 7. Prośba o poprawkę nie zostawia po sobie śladu w statystykach: zapisana jest jedna próba
-- (ta po poprawce), a nie dwie.
select is(
  (select count(*)::integer from public.attempts a
    where a.exercise_id = pg_temp.ex('food.apple')),
  1,
  'prośba o poprawkę nie jest zapisaną próbą'
);

select is(
  (select s.reps from public.srs_state s
    where s.user_id = (select id from t_ids where name = 'uczen')
      and s.concept_id = (select concept_id from t_ex where key = 'food.apple')),
  1,
  'harmonogram powtórek widzi jedną odpowiedź, nie dwie'
);

select * from finish();
rollback;
