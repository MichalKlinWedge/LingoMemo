-- Biblioteka mediów: gdzie używany jest plik i obrazek przy słówku.
--
-- `media_usage` jest po to, żeby kasowanie w bibliotece nie było ruletką — administrator ma
-- przed usunięciem zobaczyć, że na pliku wisi zadanie „wskaż obrazek". Skasowanie pliku nie
-- rusza wierszy, które go wskazują, więc policzenie ich jest jedynym ostrzeżeniem, jakie można
-- mu dać.

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
insert into t_ids values ('admin', pg_temp.make_user('admin-media@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-media@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-media', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

grant select on t_ids, t_ctx to authenticated;

-- --- jako administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');

reset role;

create temporary table t_slowko as
  select li.concept_id as id from public.lesson_items li where li.lesson_id = (select lesson_id from t_ctx);
grant select on t_slowko to authenticated;

-- Zadanie „wskaż obrazek" wskazujące dwa pliki.
insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
select (select lesson_id from t_ctx), 'image_choice', 500, (select id from t_slowko),
       jsonb_build_object(
         'prompt', 'jabłko',
         'options', jsonb_build_array('2026/jablko.png', '2026/gruszka.png'),
         'answer', '2026/jablko.png'
       ), 10;

select is(
  (select count(*)::integer from public.media_usage(array['2026/jablko.png', '2026/nikomu.png'])),
  2,
  'każda zapytana ścieżka dostaje wiersz, także nieużywana'
);
select is(
  (select exercises from public.media_usage(array['2026/jablko.png']) where path = '2026/jablko.png'),
  1,
  'plik użyty w zadaniu jest policzony'
);
select is(
  (select exercises from public.media_usage(array['2026/gruszka.png']) where path = '2026/gruszka.png'),
  1,
  'dystraktor zadania też się liczy — skasowany zostawi pustą kratkę'
);
select is(
  (select concepts + exercises from public.media_usage(array['2026/nikomu.png']) where path = '2026/nikomu.png'),
  0,
  'plik, którego nic nie wskazuje, ma zero, a nie brak wiersza'
);

-- --- jako administrator: obrazek przy słówku ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select lives_ok(
  format('select public.admin_set_concept_image(%L, ''2026/jablko.png'')', (select id from t_slowko)),
  'administrator przypina obrazek do słówka bez importu'
);

select throws_ok(
  format('select public.admin_set_concept_image(%L, ''https://example.com/jablko.png'')', (select id from t_slowko)),
  'To nie jest ścieżka pliku z panelu „Obrazki"',
  'adres zamiast ścieżki nie przechodzi'
);

reset role;

select is(
  (select concepts from public.media_usage(array['2026/jablko.png']) where path = '2026/jablko.png'),
  1,
  'słówko z obrazkiem liczy się w użyciu pliku'
);

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_set_concept_image(%L, ''2026/cokolwiek.png'')', (select id from t_slowko)),
  'Tylko administrator',
  'dziecko nie przypnie obrazka do słówka'
);

reset role;

-- Puste pole odpina obrazek, ale pliku nie rusza — może go używać coś jeszcze.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_set_concept_image((select id from t_slowko), '');

reset role;

select is(
  (select concepts from public.media_usage(array['2026/jablko.png']) where path = '2026/jablko.png'),
  0,
  'puste pole odpina obrazek od słówka'
);

select * from finish();
rollback;
