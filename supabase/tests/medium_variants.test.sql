-- Średni poziom dorabiany tam, gdzie słówko go nie ma.
--
-- Lekcja, w której wszystkie tłumaczenia mają gotowe kafelki, nie miała ani jednego zadania na
-- poziomie 2 — kwadracik średniego nie pokazywał się wcale. Sprawdzamy obie drogi: słówko
-- jednowyrazowe dostaje wpisywanie, a zdanie rozsypankę z dystraktorami.

begin;
select plan(7);

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

create temporary table t_admin as select pg_temp.make_user('admin-sredni@test.local') as id;
insert into app_private.admin_users (user_id) select id from t_admin;

create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-sredni', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id
)
select (select course_id from d) as course_id, (select id from l) as lesson_id;

grant select on t_admin, t_ctx to authenticated;

-- Trzy słówka: z nich wezmą się dystraktory do rozsypanki.
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_admin)), true);

select public.admin_add_word((select lesson_id from t_ctx), 'school.book', 'książka', 'book');
select public.admin_add_word((select lesson_id from t_ctx), 'school.pen', 'długopis', 'pen');
select public.admin_add_word((select lesson_id from t_ctx), 'school.bag', 'plecak', 'bag');

reset role;

-- Lekcja jak „Classroom language": wszystko na klikanie, nic do wpisania. Zdejmujemy więc
-- dorobione przez `admin_add_word` tłumaczenia na polski (to one są poziomem 2) i zostawiamy
-- same zadania z gotowymi kafelkami.
delete from public.exercises
 where lesson_id = (select lesson_id from t_ctx) and level = 2;

update public.exercises
   set payload = payload || jsonb_build_object('options', jsonb_build_array('book', 'pen', 'bag')),
       level = 1
 where lesson_id = (select lesson_id from t_ctx) and type = 'translate_ab';

select is(
  (select count(*)::integer from public.exercises
    where lesson_id = (select lesson_id from t_ctx) and level = 2),
  0,
  'punkt wyjścia: w lekcji nie ma ani jednego zadania na poziomie średnim');

-- Zdanie z gotowymi kafelkami: po polsku polecenie, po angielsku całe zdanie.
insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points)
select lesson_id, 'translate_ab', 400,
       (select id from public.concepts where key = 'school.book'),
       jsonb_build_object(
         'prompt', 'Otwórz książki.',
         'accepted', jsonb_build_array('Open your books.'),
         'options', jsonb_build_array('Open your books.', 'Close your books.')),
       10
  from t_ctx;

create temporary table t_dorobione as
  select public.build_medium_variants((select lesson_id from t_ctx)) as ile;

select ok((select ile from t_dorobione) > 0, 'generator dorabia zadania średniego poziomu');

select ok(
  (select count(*) from public.exercises
    where lesson_id = (select lesson_id from t_ctx) and level = 2) > 0,
  'po przebiegu lekcja ma czym wypełnić kwadracik średniego poziomu');

select ok(
  exists (
    select 1 from public.exercises e
     where e.lesson_id = (select lesson_id from t_ctx)
       and e.level = 2
       and e.type in ('translate_ab', 'translate_ba')
       and not (e.payload ? 'options')
  ),
  'słówko jednowyrazowe dostaje zadanie z wpisywaniem');

select ok(
  exists (
    select 1 from public.exercises e
     where e.lesson_id = (select lesson_id from t_ctx)
       and e.level = 2
       and e.type = 'sentence_order'
       and jsonb_array_length(e.payload -> 'tokens') > jsonb_array_length(e.payload -> 'solution')
  ),
  'zdanie dostaje rozsypankę z dystraktorami, też na średnim');

select is(
  public.build_medium_variants((select lesson_id from t_ctx)),
  0,
  'drugi przebieg nic nie dokłada, bo każde słówko ma już średni poziom');

select ok(
  not exists (
    select 1 from public.exercises e
     where e.lesson_id = (select lesson_id from t_ctx)
       and e.payload ? 'options'
       and e.level = 2
  ),
  'zadania z gotowymi kafelkami zostają na poziomie łatwym');

select * from finish();
rollback;
