-- Test działu i zamek na kolejnym dziale.
--
-- Sprawdza to, co dziecko widzi na mapie kursu: że dział kończy się testem, że test czeka
-- na komplet lekcji działu, a następny dział czeka na zdany test. I że żadna z tych blokad
-- nie dotyczy administratora oglądającego kurs oczami dziecka.

begin;
select plan(15);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-dzialy@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-dzialy@test.local'));
insert into app_private.admin_users (user_id)
  values ((select id from t_ids where name = 'admin'));

-- Kurs z trzema działami: dwa ze słówkami i trzeci pusty, który nie ma czym blokować.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-dzialy', 'pl', 'en', 'Kurs testowy', true) returning id
), d1 as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial-1', 'Dział 1', 1, true from k returning id, course_id
), d2 as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial-2', 'Dział 2', 2, true from k returning id
), d3 as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial-3', 'Dział 3', 3, true from k returning id
), l1 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-1', 'Lekcja 1', 1, true from d1 returning id
), l2 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-2', 'Lekcja 2', 1, true from d2 returning id
)
select (select course_id from d1) as course_id,
       (select id from d1) as unit1, (select id from d2) as unit2, (select id from d3) as unit3,
       (select id from l1) as lekcja1, (select id from l2) as lekcja2;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

grant select on t_ids, t_ctx to authenticated;

-- --- jako administrator: słówka do obu działów ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lekcja1 from t_ctx), 'food.apple', 'jabłko', 'apple');
select public.admin_add_word((select lekcja1 from t_ctx), 'food.bread', 'chleb', 'bread');
select public.admin_add_word((select lekcja2 from t_ctx), 'animal.dog', 'pies', 'dog');

reset role;

create temporary table t_test as
  select u.sort_order as dzial, l.id, l.kind, l.review_scope_unit_id
    from public.lessons l
    join public.units u on u.id = l.unit_id
   where u.course_id = (select course_id from t_ctx) and l.kind = 'test';
grant select on t_test to authenticated;

select is((select count(*)::integer from t_test), 2,
          'test powstaje sam w każdym dziale ze słówkami');
select is((select count(*)::integer from public.lessons l
            where l.unit_id = (select unit3 from t_ctx)), 0,
          'dział bez słówek nie dostaje testu');
select is((select review_scope_unit_id from t_test where dzial = 1), (select unit1 from t_ctx),
          'test wskazuje dział, który sprawdza');

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(public.is_lesson_unlocked((select lekcja1 from t_ctx), (select id from t_ids where name = 'uczen')),
          true, 'pierwsza lekcja pierwszego działu jest otwarta');
select is(public.is_lesson_unlocked((select id from t_test where dzial = 1), (select id from t_ids where name = 'uczen')),
          false, 'test czeka na komplet lekcji działu');
select is(public.is_lesson_unlocked((select lekcja2 from t_ctx), (select id from t_ids where name = 'uczen')),
          false, 'drugi dział jest zamknięty, dopóki test pierwszego nie jest zdany');
select is(public.is_unit_unlocked((select unit2 from t_ctx), (select id from t_ids where name = 'uczen')),
          false, 'zamek stoi na dziale, nie na pojedynczej lekcji');

select throws_ok(
  format('select * from public.start_lesson_session(%L, %L)', (select lekcja2 from t_ctx), 'test-zamek'),
  'Ta lekcja jest jeszcze zamknięta',
  'w zamkniętą lekcję nie da się wejść bokiem'
);

reset role;

-- Lekcja pierwszego działu zaliczona.
insert into public.lesson_progress (user_id, lesson_id, status, best_score, last_score, stars, attempts_count, completed_at)
select (select id from t_ids where name = 'uczen'), (select lekcja1 from t_ctx), 'completed', 1, 1, 3, 1, now();

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(public.is_lesson_unlocked((select id from t_test where dzial = 1), (select id from t_ids where name = 'uczen')),
          true, 'po zaliczeniu lekcji działu test się otwiera');
select is(public.is_lesson_unlocked((select lekcja2 from t_ctx), (select id from t_ids where name = 'uczen')),
          false, 'sama zaliczona lekcja jeszcze nie otwiera następnego działu');

-- Test bierze zadania z lekcji działu, po jednym na słówko.
create temporary table t_zadania as
  select * from public.get_lesson_exercises((select id from t_test where dzial = 1), 1, 1::smallint);
grant select on t_zadania to authenticated;

select is((select count(*)::integer from t_zadania), 2,
          'test obejmuje oba słówka działu, po jednym zadaniu na słówko');
select is((select count(distinct concept_id)::integer from t_zadania), 2,
          'to samo słówko nie wraca w teście dwa razy');
select is((select count(*)::integer from t_zadania
            where payload ? 'accepted' or payload ? 'answer' or payload ? 'solution'), 0,
          'treść zadania testu też nie zawiera poprawnej odpowiedzi');

reset role;

-- Test zdany.
insert into public.lesson_progress (user_id, lesson_id, status, best_score, last_score, stars, attempts_count, completed_at)
select (select id from t_ids where name = 'uczen'), (select id from t_test where dzial = 1), 'completed', 1, 1, 3, 1, now();

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(public.is_lesson_unlocked((select lekcja2 from t_ctx), (select id from t_ids where name = 'uczen')),
          true, 'zdany test otwiera następny dział');

reset role;

-- --- jako administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select is(public.is_lesson_unlocked((select id from t_test where dzial = 2), (select id from t_ids where name = 'admin')),
          true, 'administrator wchodzi w test działu bez zaliczania lekcji');

reset role;

select * from finish();
rollback;
