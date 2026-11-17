-- Zadanie wracające po błędzie i jego udział w wyniku etapu.
--
-- Przebieg lekcji (`lesson-runner.tsx`) dokłada źle zrobione zadanie na koniec kolejki etapu,
-- więc dziecko dostaje drugie podejście od razu, a nie dopiero w powtórkach za kilka dni.
-- Poprawka liczy się jako dobra odpowiedź, ale sam błąd zostaje w wyniku: mianownikiem jest
-- liczba ODPOWIEDZI, nie liczba zadań w etapie. Bez tego każdy etap z powtórką kończyłby się
-- kompletem gwiazdek, bo poprawna odpowiedź stoi na ekranie tuż przed powtórzonym zadaniem.

begin;
select plan(5);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-powtorka@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-powtorka@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Własna lekcja: dwa słówka, czyli jeden etap i dwa zadania w kolejce.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-powtorka', 'pl', 'en', 'Kurs testowy', true) returning id
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

select public.admin_add_word((select lesson_id from t_ctx), 'food.apple', 'jabłko', 'apple');
select public.admin_add_word((select lesson_id from t_ctx), 'food.bread', 'chleb', 'bread');

reset role;

-- Ten plik sprawdza liczenie wyniku, nie dobór trudności: lekcja idzie na poziomie łatwym,
-- a do etapu wchodzi jedno zadanie na słówko (`…_word_on_every_level.sql`).
update public.exercises set level = 1 where lesson_id = (select lesson_id from t_ctx);
delete from public.exercises
 where lesson_id = (select lesson_id from t_ctx) and type <> 'translate_ab';

create temporary table t_ex as
  select e.id, c.key, e.payload -> 'accepted' ->> 0 as dobra
    from public.exercises e
    join public.concepts c on c.id = e.concept_id
   where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'translate_ab';
grant select on t_ex to authenticated;

-- --- jako uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

create temporary table t_sesja as
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'test-powtorka-1') as id;
grant select on t_sesja to authenticated;

-- Pierwsze słówko źle. Odpowiedź jako `choice`, żeby nie wejść w prośbę o poprawienie
-- literówki — tamta nie zapisuje próby, a tu chodzi właśnie o zapisane odpowiedzi.
select public.submit_attempt(
  (select id from t_sesja),
  (select id from t_ex where key = 'food.apple'),
  jsonb_build_object('choice', 'zupełnie nie to słowo'), 5000, false
);

-- Drugie słówko dobrze.
select public.submit_attempt(
  (select id from t_sesja),
  (select id from t_ex where key = 'food.bread'),
  jsonb_build_object('choice', (select dobra from t_ex where key = 'food.bread')), 3000, false
);

-- Pierwsze słówko wraca na koniec kolejki i tym razem wychodzi.
select public.submit_attempt(
  (select id from t_sesja),
  (select id from t_ex where key = 'food.apple'),
  jsonb_build_object('choice', (select dobra from t_ex where key = 'food.apple')), 3000, false
);

create temporary table t_koniec as
  select public.finish_lesson_session((select id from t_sesja)) as v;
grant select on t_koniec to authenticated;

select is((select (v ->> 'total')::integer from t_koniec), 3,
          'powtórzone zadanie liczy się jako kolejne zadanie etapu');
select is((select (v ->> 'correct')::integer from t_koniec), 2,
          'poprawiona odpowiedź liczy się jako dobra');
select is((select (v ->> 'score')::numeric from t_koniec), 0.667::numeric,
          'wynik etapu to dwie dobre odpowiedzi z trzech');
select is((select (v ->> 'stars')::integer from t_koniec), 0,
          'poprawka nie daje gwiazdek za darmo');
select is((select (v ->> 'passed')::boolean from t_koniec), false,
          'etap z poprawianym błędem nie jest od razu zaliczony');

reset role;

select * from finish();
rollback;
