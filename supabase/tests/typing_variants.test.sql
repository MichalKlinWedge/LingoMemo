-- Wpisanie słowa w języku kursu dorabiane tam, gdzie słówko ma tylko kafelki.
--
-- Lekcja jak w kursach pl-de / pl-es / pl-fr / pl-it: tłumaczenie na język kursu zawsze z gotową
-- listą, a jedynym zadaniem z pisaniem jest tłumaczenie na polski. Słówko ma więc poziom 2
-- i `build_medium_variants` je mija — a dziecko nigdy nie pisze w języku, którego się uczy.
-- Sprawdzamy, że piąty generator ten kierunek dokłada, zwrotu nie rusza i nie dubluje.

begin;
select plan(6);

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

create temporary table t_admin as select pg_temp.make_user('admin-wpisywanie@test.local') as id;
insert into app_private.admin_users (user_id) select id from t_admin;

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-wpisywanie', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

grant select on t_admin, t_ctx to authenticated;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_admin)), true);

select public.admin_add_word((select lesson_id from t_ctx), 'school.book', 'książka', 'book');
select public.admin_add_word((select lesson_id from t_ctx), 'school.pen', 'długopis', 'pen');
select public.admin_add_word((select lesson_id from t_ctx), 'school.bag', 'plecak', 'bag');
-- Zwrot: wpisywanie go z klawiatury to poziom trudny, więc generator ma go minąć.
select public.admin_add_word((select lesson_id from t_ctx), 'greet.morning', 'dzień dobry', 'good morning');

reset role;

-- Kurs jak pl-de: każde tłumaczenie na język kursu dostaje gotową listę. Przy pierwszym słówku
-- `admin_add_word` nie miało z czego jej zrobić, więc dokładamy ją wszystkim.
update public.exercises
   set payload = payload || jsonb_build_object('options', jsonb_build_array('book', 'pen', 'bag')),
       level = 1
 where lesson_id = (select lesson_id from t_ctx)
   and type = 'translate_ab';

select is(
  (select count(*)::integer from public.exercises
    where lesson_id = (select lesson_id from t_ctx)
      and type = 'translate_ab' and not (payload ? 'options')),
  0,
  'punkt wyjścia: w lekcji nie ma czego wpisywać w języku kursu');

select ok(
  (select count(*) from public.exercises
    where lesson_id = (select lesson_id from t_ctx) and level = 2) > 0,
  'punkt wyjścia: poziom średni jednak jest — to tłumaczenia na polski');

create temporary table t_dorobione as
  select public.build_typing_variants((select lesson_id from t_ctx)) as ile;

select is((select ile::integer from t_dorobione), 3,
  'generator dokłada wpisywanie każdemu słowu jednowyrazowemu');

select is(
  (select count(*)::integer from public.exercises
    where lesson_id = (select lesson_id from t_ctx)
      and type = 'translate_ab' and not (payload ? 'options') and level = 2),
  3,
  'dorobione zadania stoją na poziomie średnim');

select ok(
  not exists (
    select 1 from public.exercises e
     where e.lesson_id = (select lesson_id from t_ctx)
       and e.type = 'translate_ab'
       and not (e.payload ? 'options')
       and e.concept_id = (select id from public.concepts where key = 'greet.morning')
  ),
  'zwrotu do wpisania generator nie dorabia');

select is(
  public.build_typing_variants((select lesson_id from t_ctx)),
  0,
  'drugi przebieg nic nie dokłada');

select * from finish();
rollback;
