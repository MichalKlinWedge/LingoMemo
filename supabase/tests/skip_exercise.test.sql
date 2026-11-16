-- Pomijanie zadania w lekcji.
--
-- „Pomiń" to odpowiedź `{"skipped": true}`. Dla bazy ma być tym samym co zła odpowiedź:
-- zero punktów, próba zapisana jako błędna i ocena „powtórz" dla harmonogramu powtórek —
-- inaczej dziecko klikałoby „Pomiń" przez całą lekcję i kończyło ją z kompletem punktów.

begin;
select plan(8);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-skip@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-skip@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Własna lekcja: jedno słówko, czyli trzy zadania i jeden etap.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-pomijanie', 'pl', 'en', 'Kurs testowy', true) returning id
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

reset role;

-- Ten plik sprawdza pomijanie zadań, nie dobór trudności: lekcja idzie na poziomie łatwym,
-- żeby zadanie z wpisywaniem w ogóle zostało wydane.
update public.exercises set level = 1 where lesson_id = (select lesson_id from t_ctx);

-- Do etapu wchodzi jedno zadanie na słówko (`…_word_on_every_level.sql`), więc zostawiamy
-- w lekcji tylko to, które ten plik pomija.
delete from public.exercises
 where lesson_id = (select lesson_id from t_ctx) and type <> 'translate_ab';

create temporary table t_ex as
  select e.id, e.type, e.concept_id, e.points
    from public.exercises e where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'translate_ab';
grant select on t_ex to authenticated;

-- --- jako uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

create temporary table t_sesja as
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'test-pomijanie-1') as id;
grant select on t_sesja to authenticated;

create temporary table t_wynik as
  select public.submit_attempt(
           (select id from t_sesja),
           (select id from t_ex),
           jsonb_build_object('skipped', true)
         ) as v;
grant select on t_wynik to authenticated;

select is((select (v ->> 'correct')::boolean from t_wynik), false, 'pominięte zadanie nie jest zaliczone');
select is((select (v ->> 'skipped')::boolean from t_wynik), true, 'werdykt mówi, że to pominięcie');
select is((select (v ->> 'points')::integer from t_wynik), 0, 'za pominięcie nie ma punktów');
select is((select (v ->> 'grade')::integer from t_wynik), 1, 'harmonogram powtórek dostaje ocenę „powtórz"');
select isnt((select v -> 'correctAnswer' from t_wynik), 'null'::jsonb, 'dziecko widzi poprawną odpowiedź');

reset role;

select is(
  (select a.is_correct from public.attempts a where a.exercise_id = (select id from t_ex)),
  false,
  'próba zapisana jako błędna'
);

select is(
  (select coalesce(sum(p.delta), 0)::integer from public.points_ledger p
    where p.user_id = (select id from t_ids where name = 'uczen')),
  0,
  'na koncie dziecka nie przybyło punktów'
);

select is(
  (select s.lapses from public.srs_state s
    where s.user_id = (select id from t_ids where name = 'uczen')
      and s.concept_id = (select concept_id from t_ex)),
  1,
  'słówko trafia do powtórek jako pomyłka'
);

select * from finish();
rollback;
