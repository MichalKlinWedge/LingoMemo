-- Rodzic uczy się swoich kursów.
--
-- Rola rodzica zaczęła jako czysty wgląd, więc łatwo o założenie, że nauka jest dla niej
-- zamknięta. Ten plik pilnuje, że nie jest — i że mimo to nic się nie rozszczelniło: rodzic
-- wchodzi w lekcję dopiero po zapisie (zapis dziecka mu nie wystarczy), a kluczy odpowiedzi
-- nie dostaje ani przed zapisem, ani po nim.

begin;
select plan(11);

create or replace function pg_temp.make_user(p_email text, p_token text default null) returns uuid
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
    case when p_token is null then jsonb_build_object('display_name', split_part(p_email, '@', 1))
         else jsonb_build_object('display_name', split_part(p_email, '@', 1), 'invite', p_token) end,
    now(), now()
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
  perform set_config('role', 'postgres', true);
  select json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
    into v_claims
    from auth.users u where u.id = p_user;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('admin', pg_temp.make_user('admin-rn@test.local'));
insert into t_ids values ('rodzic', pg_temp.make_user('rodzic-rn@test.local'));
insert into t_ids values ('dziecko', pg_temp.make_user('dziecko-rn@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
insert into app_private.parent_users (user_id) values ((select id from t_ids where name = 'rodzic'));
insert into app_private.parent_children (parent_id, child_id)
values ((select id from t_ids where name = 'rodzic'), (select id from t_ids where name = 'dziecko'));

-- Dział na początku kursu (`sort_order` 0), żeby lekcji nie zamykało nic poza brakiem zapisu.
create temporary table t_ctx (course_id uuid, lesson_id uuid);

with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-rodzic-uczy', 'pl', 'en', 'Kurs rodzica', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 0, true from k returning id, course_id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja', 'Lekcja', 1, true from d returning id, unit_id
)
insert into t_ctx select d.course_id, l.id from l join d on d.id = l.unit_id;

grant select on t_ids, t_ctx to authenticated;

-- Słówka, żeby lekcja miała co wydać. Dodaje je administrator — jego własny claim nie bierze
-- udziału w tym, co dalej sprawdzamy u rodzica.
select pg_temp.jako((select id from t_ids where name = 'admin'));

do $$
declare
  i integer;
begin
  for i in 1..4 loop
    perform public.admin_add_word((select lesson_id from t_ctx), 'rodzic.' || i, 'slowo' || i, 'word' || i);
  end loop;
end;
$$;

reset role;

-- Dziecko ma zapis, rodzic jeszcze nie. To jest sedno pierwszej asercji: wgląd w postępy
-- dziecka nie jest dostępem do nauki.
insert into public.enrollments (user_id, course_id)
values ((select id from t_ids where name = 'dziecko'), (select course_id from t_ctx));

create temporary table t_sesja (id uuid);
grant select, insert on t_sesja to authenticated;

-- --- rodzic bez zapisu ---

select pg_temp.jako((select id from t_ids where name = 'rodzic'));

select is(public.is_parent(), true, 'konto ma rolę rodzica');

select is(
  public.is_lesson_unlocked((select lesson_id from t_ctx), (select id from t_ids where name = 'rodzic')),
  false,
  'zapis dziecka nie otwiera kursu rodzicowi');

select throws_ok(
  format('select public.get_lesson_exercises(%L)', (select lesson_id from t_ctx)),
  '42501',
  null,
  'i bez zapisu rodzic nie weźmie zadań');

select lives_ok(
  format('select public.request_course_access(%L)', (select course_id from t_ctx)),
  'rodzic prosi o dostęp tym samym przyciskiem co dziecko');

select is(
  (select count(*)::integer from public.my_course_requests()),
  1,
  'prośba rodzica jest zapisana');

-- --- rodzic po zapisie ---

reset role;

insert into public.enrollments (user_id, course_id)
values ((select id from t_ids where name = 'rodzic'), (select course_id from t_ctx));

select pg_temp.jako((select id from t_ids where name = 'rodzic'));

select is(
  public.is_lesson_unlocked((select lesson_id from t_ctx), (select id from t_ids where name = 'rodzic')),
  true,
  'po zapisie kurs jest dla rodzica otwarty');

select lives_ok(
  format('insert into t_sesja select public.start_lesson_session(%L, %L, 1, 1::smallint)',
         (select lesson_id from t_ctx), 'klucz-rodzic'),
  'rodzic zaczyna lekcję jak dziecko');

select cmp_ok(
  (select s.total_exercises from public.lesson_sessions s join t_sesja t on t.id = s.id),
  '>',
  0,
  'i dostaje zadania do zrobienia');

-- Nauka rodzica nie jest szczeliną na klucze odpowiedzi: zadania wydaje mu
-- `get_lesson_exercises` bez pól `accepted` / `answer` / `solution`, a tabeli nie czyta wcale.
select is(
  (select count(*)::integer from public.exercises),
  0,
  'a tabeli zadań dalej nie widzi');

-- --- zaproszenie z kursem ---

reset role;
select pg_temp.jako((select id from t_ids where name = 'admin'));

create temporary table t_tok (token text);
insert into t_tok
select public.create_invite('parent', 14, 1, (select course_id from t_ctx), 'Mama', null);

reset role;

insert into t_ids values ('mama', pg_temp.make_user('mama-rn@test.local', (select token from t_tok)));

select is(
  (select count(*)::integer from public.enrollments e
    where e.user_id = (select id from t_ids where name = 'mama')
      and e.course_id = (select course_id from t_ctx)),
  1,
  'zaproszenie z kursem zapisuje też rodzica');

select is(
  (select count(*)::integer from app_private.parent_users pu
    where pu.user_id = (select id from t_ids where name = 'mama')),
  1,
  'i nadaje mu rolę rodzica');

select * from finish();
rollback;
