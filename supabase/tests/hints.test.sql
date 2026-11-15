-- Podpowiedzi: pięć na dobę, każda zamienia zadanie na łatwiejszą wersję tego samego słówka.
--
-- Sprawdzamy to, od czego zależy uczciwość tej mechaniki: że zamiennik jest naprawdę łatwiejszy
-- i dotyczy tego samego słówka, że da się na niego odpowiedzieć (migawka sesji!), że pula spada
-- tylko raz na zadanie, że kończy się po pięciu i że wczorajsze użycia jej nie zjadają.

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
insert into t_ids values ('admin', pg_temp.make_user('admin-podpowiedzi@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-podpowiedzi@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-podpowiedzi', 'pl', 'en', 'Kurs testowy', true) returning id
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

select public.admin_add_word((select lesson_id from t_ctx), 'school.book', 'książka', 'book');
select public.admin_add_word((select lesson_id from t_ctx), 'school.pen', 'długopis', 'pen');
select public.admin_add_word((select lesson_id from t_ctx), 'school.bag', 'plecak', 'bag');

reset role;

-- Zadanie ze słuchu (poziom 3) ma być z czego ułatwić: to samo słówko ma wybór z kafelków.
create temporary table t_trudne as
  select e.id, e.concept_id, e.level
    from public.exercises e
   where e.lesson_id = (select lesson_id from t_ctx)
     and e.type = 'listening'
   order by e.sort_order
   limit 1;
grant select on t_trudne to authenticated;

-- Zadanie, z którego nie da się zrobić nic łatwiejszego: łączenie par jest już na klikanie,
-- nie ma `options` do przycięcia i nie wisi przy żadnym słówku.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select lesson_id, 'match_pairs', 300,
       jsonb_build_object('pairs', jsonb_build_array(
         jsonb_build_object('a', 'książka', 'b', 'book'),
         jsonb_build_object('a', 'długopis', 'b', 'pen'),
         jsonb_build_object('a', 'plecak', 'b', 'bag'))), 10
  from t_ctx;

create temporary table t_samotne as
  select e.id from public.exercises e
   where e.lesson_id = (select lesson_id from t_ctx) and e.type = 'match_pairs'
   order by e.sort_order limit 1;
grant select on t_samotne to authenticated;

-- Zadanie na klikanie z trzema kafelkami: nie ma nic łatwiejszego w lekcji, więc podpowiedź
-- powinna uprościć je samo — zostawić dwa kafelki, w tym poprawny.
create temporary table t_wyborem as
  select e.id, jsonb_array_length(e.payload -> 'options') as ile
    from public.exercises e
   where e.lesson_id = (select lesson_id from t_ctx)
     and jsonb_typeof(e.payload -> 'options') = 'array'
     and jsonb_array_length(e.payload -> 'options') > 2
   order by e.sort_order limit 1;
grant select on t_wyborem to authenticated;

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(public.hints_left(), 5, 'nowe konto ma pięć podpowiedzi na dziś');

create temporary table t_sesja as
  select public.start_lesson_session((select lesson_id from t_ctx)::uuid, 'podpowiedzi-1') as id;
grant select on t_sesja to authenticated;

create temporary table t_hint as
  select public.use_hint((select id from t_sesja), (select id from t_trudne)) as v;
grant select on t_hint to authenticated;

select ok(
  (select (v ->> 'id')::uuid from t_hint) <> (select id from t_trudne),
  'podpowiedź oddaje inne zadanie niż to, na którym dziecko utknęło');

-- Do kolumn `exercises` zaglądamy jako rola bazy: uczeń nie ma do tej tabeli polityki SELECT,
-- więc jego zapytanie zwróciłoby NULL i asercja mówiłaby o uprawnieniach, nie o podpowiedzi.
reset role;

select is(
  (select e.concept_id from public.exercises e where e.id = (select (v ->> 'id')::uuid from t_hint)),
  (select concept_id from t_trudne),
  'zamiennik dotyczy tego samego słówka');

select ok(
  (select e.level from public.exercises e where e.id = (select (v ->> 'id')::uuid from t_hint))
    < (select level from t_trudne),
  'zamiennik jest naprawdę łatwiejszy');

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(
  (select v -> 'payload' ? 'accepted' from t_hint),
  false,
  'w zadaniu z podpowiedzi nie ma poprawnej odpowiedzi');

select is((select (v ->> 'hintsLeft')::integer from t_hint), 4, 'podpowiedź zabiera jedną z puli');

select is(
  (select (public.use_hint((select id from t_sesja), (select id from t_trudne)) ->> 'hintsLeft')::integer),
  4,
  'druga podpowiedź do tego samego zadania nic nie kosztuje');

-- Na zamiennik musi dać się odpowiedzieć: sesja wydała go zamiast trudnego zadania.
select is(
  (select public.submit_attempt(
            (select id from t_sesja),
            (select (v ->> 'id')::uuid from t_hint),
            jsonb_build_object('text', 'cokolwiek', 'choice', 'cokolwiek'),
            null, true) ? 'correct'),
  true,
  'odpowiedź na zadanie z podpowiedzi jest przyjmowana przez sesję');

select throws_ok(
  format('select public.use_hint(%L, %L)', (select id from t_sesja), (select id from t_samotne)),
  '22023',
  null,
  'zadanie bez łatwiejszej wersji nie zużywa podpowiedzi, tylko mówi wprost');

-- Wczorajsze użycia nie mogą zjadać dzisiejszej puli.
reset role;
insert into public.hint_uses (user_id, session_id, exercise_id, easier_id, used_on)
select (select id from t_ids where name = 'uczen'), null, e.id, null,
       public.learner_today((select id from t_ids where name = 'uczen')) - 1
  from public.exercises e
 where e.lesson_id = (select lesson_id from t_ctx)
 limit 5;

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select is(public.hints_left(), 4, 'wczorajsze podpowiedzi nie liczą się do dzisiejszej puli');

-- Poziom łatwy: nie ma łatwiejszego zadania, więc podpowiedź upraszcza to, które jest.
create temporary table t_prostsze as
  select public.use_hint((select id from t_sesja), (select id from t_wyborem)) as v;

select is(
  (select (v ->> 'id')::uuid from t_prostsze),
  (select id from t_wyborem),
  'uproszczenie zostaje tym samym zadaniem, więc sesja i ocenianie się nie zmieniają');

select is(
  (select jsonb_array_length(v -> 'payload' -> 'options') from t_prostsze),
  2,
  'z trzech kafelków zostają dwa');

select * from finish();
rollback;
