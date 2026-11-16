-- Dostęp do kursu: zapis jako warunek nauki i prośba, którą uczeń wysyła sam.
--
-- Plik sprawdza jedną regułę z dwóch stron: bez zapisu lekcja jest zamknięta (i to baza o tym
-- mówi, nie przeglądarka), a jedyne, co dziecko może samo zrobić, to poprosić. Zapisać je
-- może administrator albo zaproszenie.

begin;
select plan(14);

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
insert into t_ids values ('uczen', pg_temp.make_user('uczen-dostep@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-dostep@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Dwa kursy opublikowane i jeden ukryty. Dział bez słówek, więc nie dorabia się do niego test
-- działu, i na początku kursu (`sort_order` 0), żeby nic go nie zamykało poza brakiem zapisu.
create temporary table t_kursy (nazwa text primary key, course_id uuid, lesson_id uuid);

do $setup$
declare
  k record;
  v_course uuid;
  v_unit   uuid;
  v_lesson uuid;
begin
  for k in
    select * from (values ('moj', 'dostep-moj', true), ('obcy', 'dostep-obcy', true),
                          ('ukryty', 'dostep-ukryty', false)) as v(nazwa, slug, opublikowany)
  loop
    insert into public.courses (slug, title, source_lang, target_lang, sort_order, is_published)
    values (k.slug, 'Kurs ' || k.nazwa, 'pl', 'en', 1, k.opublikowany)
    returning id into v_course;

    insert into public.units (course_id, slug, title, sort_order, is_published)
    values (v_course, 'dzial', 'Dział', 0, true)
    returning id into v_unit;

    insert into public.lessons (unit_id, slug, title, sort_order, is_published)
    values (v_unit, 'lekcja', 'Lekcja', 1, true)
    returning id into v_lesson;

    insert into t_kursy values (k.nazwa, v_course, v_lesson);
  end loop;
end;
$setup$;

-- Zapis tylko na pierwszy kurs — drugi jest tym, o który trzeba będzie poprosić.
insert into public.enrollments (user_id, course_id)
values ((select id from t_ids where name = 'uczen'), (select course_id from t_kursy where nazwa = 'moj'));

grant select on t_ids, t_kursy to authenticated;

-- --- uczeń ---

select pg_temp.jako((select id from t_ids where name = 'uczen'));

select is(
  public.is_lesson_unlocked((select lesson_id from t_kursy where nazwa = 'moj'),
                            (select id from t_ids where name = 'uczen')),
  true,
  'kurs z zapisem jest otwarty');

select is(
  public.is_lesson_unlocked((select lesson_id from t_kursy where nazwa = 'obcy'),
                            (select id from t_ids where name = 'uczen')),
  false,
  'kurs bez zapisu jest zamknięty');

select throws_ok(
  format('select public.get_lesson_exercises(%L)', (select lesson_id from t_kursy where nazwa = 'obcy')),
  '42501',
  null,
  'i nie da się z niego wziąć zadań');

-- To jest druga połowa bramki: gdyby dziecko mogło zapisać się samo, pierwsza nie znaczyłaby nic.
select throws_ok(
  format('insert into public.enrollments (user_id, course_id) values (%L, %L)',
         (select id from t_ids where name = 'uczen'), (select course_id from t_kursy where nazwa = 'obcy')),
  '42501',
  null,
  'uczeń nie zapisze się sam');

-- --- prośba ---

select lives_ok(
  format('select public.request_course_access(%L)', (select course_id from t_kursy where nazwa = 'obcy')),
  'o dostęp można poprosić');

select is(
  (select count(*)::integer from public.my_course_requests()),
  1,
  'prośba jest zapisana i uczeń ją widzi');

select lives_ok(
  format('select public.request_course_access(%L)', (select course_id from t_kursy where nazwa = 'obcy')),
  'powtórne kliknięcie nie wybucha');

select is(
  (select count(*)::integer from public.my_course_requests()),
  1,
  'ani nie zakłada drugiej prośby');

-- O kursie ukrytym dziecko nie wie, więc nie ma o co prosić — i nie dowie się tą drogą,
-- że taki kurs w ogóle istnieje.
select throws_ok(
  format('select public.request_course_access(%L)', (select course_id from t_kursy where nazwa = 'ukryty')),
  '22023',
  null,
  'o kurs ukryty poprosić się nie da');

select lives_ok(
  format('select public.request_course_access(%L)', (select course_id from t_kursy where nazwa = 'moj')),
  'prośba o kurs, na którym już się jest, przechodzi bez śladu');

select is(
  (select count(*)::integer from public.my_course_requests()),
  1,
  'i nic nie dokłada');

select throws_ok(
  'select public.admin_course_requests()',
  '42501',
  null,
  'cudzych próśb uczeń nie przeczyta');

-- --- administrator ---

reset role;
select pg_temp.jako((select id from t_ids where name = 'admin'));

select is(
  (select count(*)::integer from public.admin_course_requests()
    where user_id = (select id from t_ids where name = 'uczen')),
  1,
  'administrator widzi, kto prosi');

-- Rozpatrzenie prośby to zwykły zapis na kurs. Ślad ma zniknąć sam, bez drugiego przycisku.
insert into public.enrollments (user_id, course_id)
values ((select id from t_ids where name = 'uczen'), (select course_id from t_kursy where nazwa = 'obcy'));

select is(
  (select count(*)::integer from public.admin_course_requests()),
  0,
  'zapis kasuje prośbę');

reset role;

select * from finish();
rollback;
