-- Rodzic widzi kursy i lekcje swojego dziecka.
--
-- Ekran `/dziecko/[id]` nie sprawdza uprawnień sam — opiera się w całości na politykach `*_read`
-- poszerzonych w `20261115110000_parent_role.sql` i na tym, że widoki `v_my_*` są
-- `security_invoker`. Ten plik sprawdza dokładnie tę ścieżkę: że rodzic dostaje wiersze swojego
-- dziecka, że nie dostaje cudzych i że po drodze nie otwiera się dostęp do kluczy odpowiedzi.

begin;
select plan(10);

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

/** Claim składamy PRZED zmianą roli: `auth.users` jest niedostępne dla `authenticated`. */
create or replace function pg_temp.jako(p_user uuid) returns void
language plpgsql as $$
declare
  v_claims text;
begin
  select json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
    into v_claims
    from auth.users u where u.id = p_user;

  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('rodzic', pg_temp.make_user('rodzic-kursy@test.local'));
insert into t_ids values ('moje',   pg_temp.make_user('moje-kursy@test.local'));
insert into t_ids values ('obce',   pg_temp.make_user('obce-kursy@test.local'));

insert into app_private.parent_users (user_id) values ((select id from t_ids where name = 'rodzic'));
insert into app_private.parent_children (parent_id, child_id)
values ((select id from t_ids where name = 'rodzic'), (select id from t_ids where name = 'moje'));

-- Kurs z jedną opublikowaną lekcją. Oba dzieci są na niego zapisane, oba mają po podejściu —
-- różnica w wynikach ma brać się wyłącznie z uprawnień, a nie z tego, że czegoś nie ma.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, title, source_lang, target_lang, sort_order, is_published)
  values ('kurs-rodzica', 'Kurs rodzica', 'pl', 'en', 1, true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja o kotach', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

grant select on t_ids, t_ctx to authenticated;

insert into public.enrollments (user_id, course_id)
select id, (select course_id from t_ctx) from t_ids where name in ('moje', 'obce');

insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises, correct_count)
select id, (select lesson_id from t_ctx), 'test-' || name, 6, 5 from t_ids where name in ('moje', 'obce');

-- --- rodzic ---

select pg_temp.jako((select id from t_ids where name = 'rodzic'));

select is(public.is_parent(), true, 'rodzic rozpoznany po claimie');

select is(
  (select count(*)::integer from public.v_my_courses
    where user_id = (select id from t_ids where name = 'moje')),
  1,
  'rodzic widzi kurs swojego dziecka');

select is(
  (select course_title from public.v_my_courses
    where user_id = (select id from t_ids where name = 'moje')),
  'Kurs rodzica',
  'razem z nazwą i licznikami z widoku');

select is(
  (select count(*)::integer from public.v_my_courses
    where user_id = (select id from t_ids where name = 'obce')),
  0,
  'kursu cudzego dziecka już nie');

select is(
  (select count(*)::integer from public.lesson_sessions
    where user_id = (select id from t_ids where name = 'moje')),
  1,
  'rodzic widzi podejście swojego dziecka do lekcji');

select is(
  (select count(*)::integer from public.lesson_sessions
    where user_id = (select id from t_ids where name = 'obce')),
  0,
  'podejścia cudzego dziecka już nie');

select is(
  (select title from public.lessons where id = (select lesson_id from t_ctx)),
  'Lekcja o kotach',
  'tytuł opublikowanej lekcji rodzic przeczyta');

-- To jest granica, której poszerzenie polityk nie miało przesunąć: w `exercises` leżą klucze
-- odpowiedzi do całego kursu, a rodzic nie ma do tej tabeli polityki SELECT tak samo jak dziecko.
select is(
  (select count(*)::integer from public.exercises),
  0,
  'kluczy odpowiedzi rodzic nie widzi');

-- --- ktoś, kto rodzicem nie jest ---

reset role;
select pg_temp.jako((select id from t_ids where name = 'obce'));

select is(
  (select count(*)::integer from public.v_my_courses
    where user_id = (select id from t_ids where name = 'moje')),
  0,
  'obce dziecko nie zajrzy w kursy cudzego konta');

select is(
  (select count(*)::integer from public.lesson_sessions
    where user_id = (select id from t_ids where name = 'moje')),
  0,
  'ani w jego podejścia do lekcji');

reset role;

select * from finish();
rollback;
