-- Trzy poziomy przy lekcji: łatwy z etapami, średni i trudny jako krótkie wejścia.
--
-- Sprawdzamy to, od czego zależy cała polityka: że łatwy wydaje tylko klikanie i że tylko on
-- otwiera następną lekcję, że trudniejsze wejście bierze najwyżej osiem słówek i jest zamknięte
-- do czasu przejścia łatwego, oraz że jego wynik nie miesza się z postępem lekcji.
-- Poziomy układają się w łańcuch: trudny otwiera dopiero zaliczony średni.

begin;
select plan(16);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-poziomy@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-poziomy@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Kurs z dwiema lekcjami: druga ma się otworzyć dopiero po łatwym poziomie pierwszej.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kwadraciki', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id, course_id
), l1 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-1', 'Lekcja 1', 1, true from d returning id
), l2 as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select id, 'lekcja-2', 'Lekcja 2', 2, true from d returning id
)
select (select course_id from d) as course_id,
       (select id from l1) as lesson_id,
       (select id from l2) as next_id;

insert into public.enrollments (user_id, course_id)
select (select id from t_ids where name = 'uczen'), course_id from t_ctx;

grant select on t_ids, t_ctx to authenticated;

-- Pięć słówek: każde dostaje wybór z kafelków (poziom 1), wpisywanie (2) i ze słuchu (3).
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select public.admin_add_word((select lesson_id from t_ctx), 'school.book', 'książka', 'book');
select public.admin_add_word((select lesson_id from t_ctx), 'school.pen', 'długopis', 'pen');
select public.admin_add_word((select lesson_id from t_ctx), 'school.bag', 'plecak', 'bag');
select public.admin_add_word((select lesson_id from t_ctx), 'school.desk', 'ławka', 'desk');
select public.admin_add_word((select lesson_id from t_ctx), 'school.chair', 'krzesło', 'chair');
select public.admin_add_word((select next_id from t_ctx), 'home.door', 'drzwi', 'door');

reset role;

-- Poprawne odpowiedzi zbieramy jako rola bazy: `exercises` nie ma polityki SELECT dla ucznia.
create temporary table t_klucz as
  select e.id, e.level, e.payload -> 'accepted' ->> 0 as answer
    from public.exercises e
   where e.lesson_id = (select lesson_id from t_ctx);
grant select on t_klucz to authenticated;

select ok(
  (select count(*) from t_klucz where level = 1) > 0
    and (select count(*) from t_klucz where level = 2) > 0
    and (select count(*) from t_klucz where level = 3) > 0,
  'lekcja ma zadania na wszystkich trzech poziomach');

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

-- Zadanie ze słuchu to najtrudniejsze, co jest — na łatwym kwadraciku nie ma prawa się pojawić
-- nawet z zasady ratunkowej, bo każde słówko ma coś łatwiejszego.
select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 1::smallint) x
     join t_klucz k on k.id = x.id
    where k.level = 3),
  0,
  'łatwy kwadracik nie wydaje zadań z pisaniem ze słuchu');

select throws_ok(
  format('select public.start_lesson_session(%L, ''proba-sredni'', 1, 2::smallint)',
         (select lesson_id from t_ctx)),
  '42501',
  null,
  'średni kwadracik jest zamknięty, dopóki łatwy nie jest zrobiony');

select is(
  (select is_unlocked from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 2),
  false,
  'mapa pokazuje średni kwadracik jako zamknięty');

-- `exercises` nie ma polityki SELECT dla ucznia, a widok jest `security_invoker`. Liczba zadań
-- musi i tak dojść — inaczej mapa uznaje, że na tym poziomie nic nie ma, i chowa kwadracik.
select ok(
  (select exercise_count from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 3) > 0,
  'dziecko widzi, że na trudnym poziomie są zadania, choć nie widzi samych zadań');

-- Łatwy poziom od początku do końca.
do $latwy$
declare
  v_sess uuid;
  r      record;
begin
  v_sess := public.start_lesson_session((select lesson_id from t_ctx), 'latwy-1', 1, 1::smallint);
  for r in select x.id, k.answer
             from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 1::smallint) x
             join t_klucz k on k.id = x.id
  loop
    perform public.submit_attempt(
      v_sess, r.id, jsonb_build_object('text', r.answer, 'choice', r.answer));
  end loop;
  perform public.finish_lesson_session(v_sess);
end;
$latwy$;

select is(
  (select status from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 1),
  'completed',
  'przejście łatwego poziomu kończy lekcję');

select ok(
  public.is_lesson_unlocked((select next_id from t_ctx), (select id from t_ids where name = 'uczen')),
  'łatwy poziom otwiera następną lekcję');

select is(
  (select is_unlocked from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 2),
  true,
  'łatwy poziom otwiera średni kwadracik');

-- Łańcuch, nie wachlarz: trudny czeka na zaliczony średni. Inaczej „trudny" byłby otwarty
-- od początku, a dziecko, które poległo na średnim, dostawało go mimo wszystko.
select is(
  (select is_unlocked from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 3),
  false,
  'trudny kwadracik czeka na zaliczony średni');

select throws_ok(
  format('select public.start_lesson_session(%L, ''proba-trudny'', 1, 3::smallint)',
         (select lesson_id from t_ctx)),
  '42501',
  null,
  'trudnego wejścia nie da się zacząć przed zaliczeniem średniego');

select ok(
  (select count(*) from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 2::smallint))
    <= public.level_run_size(),
  'trudniejsze wejście bierze najwyżej osiem słówek');

-- Średni poziom od początku do końca.
do $sredni$
declare
  v_sess uuid;
  r      record;
begin
  v_sess := public.start_lesson_session((select lesson_id from t_ctx), 'sredni-1', 1, 2::smallint);
  for r in select x.id, k.answer
             from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 2::smallint) x
             join t_klucz k on k.id = x.id
  loop
    perform public.submit_attempt(
      v_sess, r.id, jsonb_build_object('text', r.answer, 'choice', r.answer));
  end loop;
  perform public.finish_lesson_session(v_sess);
end;
$sredni$;

select is(
  (select status from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 2),
  'completed',
  'przejście średniego poziomu zapisuje się przy jego kwadraciku');

select is(
  (select count(*)::integer from public.lesson_level_progress
    where lesson_id = (select lesson_id from t_ctx) and level = 1),
  0,
  'poziom łatwy nie dubluje się w tabeli trudniejszych wejść — ma własny postęp lekcji');

select is(
  (select is_unlocked from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 3),
  true,
  'zaliczony średni otwiera trudny');

-- Zaliczenie wymaga gwiazdki, nawet gdy administrator obniży próg lekcji. Bez tego da się
-- ustawić lekcji próg 0,5 i zamalować kwadracik wynikiem, nad którym nie ma ani jednej gwiazdki
-- — a trudniejszy poziom i tak zostałby zamknięty, bo łańcuch pyta o gwiazdkę.
reset role;
update public.lessons set pass_threshold = 0.500 where id = (select lesson_id from t_ctx);

select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

do $trudny$
declare
  v_sess uuid;
  v_ile  integer;
  v_ok   integer;
  v_nr   integer := 0;
  r      record;
begin
  v_sess := public.start_lesson_session((select lesson_id from t_ctx), 'trudny-1', 1, 3::smallint);
  select count(*) into v_ile
    from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 3::smallint);
  -- Sześć dziesiątych: ponad obniżonym progiem 0,5, poniżej pierwszej gwiazdki (0,8).
  v_ok := ceil(v_ile * 0.6);
  for r in select x.id, k.answer
             from public.get_lesson_exercises((select lesson_id from t_ctx), 1, 3::smallint) x
             join t_klucz k on k.id = x.id
  loop
    v_nr := v_nr + 1;
    perform public.submit_attempt(
      v_sess, r.id,
      case when v_nr <= v_ok
           then jsonb_build_object('text', r.answer, 'choice', r.answer)
           else jsonb_build_object('text', 'zzz-nie-ta-odpowiedz', 'choice', 'zzz-nie-ta-odpowiedz')
      end);
  end loop;
  perform public.finish_lesson_session(v_sess);
end;
$trudny$;

select ok(
  (select last_score from public.lesson_level_progress
    where lesson_id = (select lesson_id from t_ctx) and level = 3) between 0.500 and 0.799,
  'wynik trudnego wejścia wyszedł nad obniżonym progiem lekcji, ale pod pierwszą gwiazdką');

select is(
  (select status from public.v_my_lesson_levels
    where lesson_id = (select lesson_id from t_ctx) and level = 3),
  'in_progress',
  'bez gwiazdki poziom zostaje niezaliczony, choćby próg lekcji był niższy');

select * from finish();
rollback;
