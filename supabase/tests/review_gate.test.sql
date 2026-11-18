-- Bramka zaległych powtórek: dziesięć zaległych słówek zamyka kurs.
--
-- Reguła ma cztery części i każda da się zepsuć osobno: licznik (co liczymy jako zaległe),
-- zamek (co się zamyka), wyjście (zdany test) i zatrzask (raz podjęty test trzeba zdać).
-- Dlatego test idzie etapami — najpierw dziewięć zaległych i otwarty kurs, potem piętnaście
-- i kurs zamknięty, potem oblany test, na końcu zdany.
--
-- Dwie asercje są tu najważniejsze i obie pilnują pułapek, na które reguła już raz wpadła:
--
--   * oblany test NIE otwiera kursu, choć licznik zaległych spada po nim tak samo jak po zdanym
--     (błędna odpowiedź też przesuwa termin słówka — FSRS liczy odstępy w dniach),
--   * zdany test otwiera kurs, choć zaległych zostało więcej niż dziesięć (drugie dziecko
--     w tym samym kursie) — inaczej po dłuższej przerwie dziecko dostawałoby test za testem.

begin;
select plan(28);

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
insert into t_ids values ('uczen', pg_temp.make_user('uczen-bramka@test.local'));
insert into t_ids values ('uczen2', pg_temp.make_user('uczen2-bramka@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-bramka@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

with c as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-bramka', 'pl', 'en', 'Kurs testowy', true)
  returning id
), u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from c returning id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, 'lekcja', 'Lekcja', 1, true from u;

create temporary table t_kurs as select id from public.courses where slug = 'test-bramka';
create temporary table t_lesson as
select l.id from public.lessons l
  join public.units un on un.id = l.unit_id
 where un.course_id = (select id from t_kurs) and l.slug = 'lekcja';

insert into public.enrollments (user_id, course_id)
select t.id, (select id from t_kurs) from t_ids t where t.name in ('uczen', 'uczen2');

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;

grant select on t_ids, t_kurs, t_lesson, t_claims to authenticated;

-- Dwadzieścia cztery słówka, każde z trzema zadaniami — tyle, żeby zaległych było więcej,
-- niż test powtórkowy pomieści (`review_limit`, dziś 12).
select set_config('request.jwt.claims', (select claims from t_claims where name = 'admin'), true),
       set_config('role', 'authenticated', true);

do $$
declare
  i integer;
begin
  for i in 1..24 loop
    perform public.admin_add_word(
      (select id from t_lesson), 'bramka.' || i, 'slowo' || i, 'word' || i);
  end loop;
end;
$$;

reset role;

create temporary table t_slowka as
select c.id as concept_id, split_part(c.key, '.', 2)::integer as nr
  from public.concepts c
 where c.key like 'bramka.%';

create temporary table t_gate as select public.review_gate_lesson((select id from t_kurs)) as id;
create temporary table t_test_dzialu as
select l.id from public.lessons l
  join public.units un on un.id = l.unit_id
 where un.course_id = (select id from t_kurs) and l.kind = 'test';

-- Odpowiedzi wyciągamy jako rola bazy: `exercises` nie ma polityki SELECT dla ucznia,
-- bo w payloadzie leżą klucze odpowiedzi.
create temporary table t_odp as
select ex.id as exercise_id, ex.payload -> 'accepted' ->> 0 as odp, s.nr
  from public.exercises ex
  join t_slowka s on s.concept_id = ex.concept_id
 where ex.type = 'translate_ba';

-- Sesje zakłada już uczeń, więc do tej jednej tabeli potrzebuje też zapisu.
create temporary table t_sesja (nazwa text primary key, id uuid);
grant select on t_slowka, t_gate, t_test_dzialu, t_odp to authenticated;
grant select, insert on t_sesja to authenticated;

-- --- etap 1: dziewięć zaległych, kurs otwarty ---

insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, reps)
select (select id from t_ids where name = 'uczen'), s.concept_id, (select id from t_kurs),
       10, 5, current_date - 1, 2
  from t_slowka s
 where s.nr <= 9;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen'), true),
       set_config('role', 'authenticated', true);

select is(public.review_gate_limit(), 10, 'bramka stoi przy dziesięciu zaległych słówkach');

select is(
  (select count(*)::integer from public.lessons l where l.review_scope_course_id = (select id from t_kurs)),
  1,
  'kurs ze słówkami dostaje dokładnie jeden test powtórkowy'
);

select is(
  public.course_due_words((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  9,
  'dziewięć słówek z terminem na wczoraj to dziewięć zaległych'
);

select ok(
  not public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  'dziewięć zaległych jeszcze nie zamyka kursu'
);

select ok(
  public.is_lesson_unlocked((select id from t_lesson), (select id from t_ids where name = 'uczen')),
  'zwykła lekcja jest otwarta, dopóki bramka nie stoi'
);

-- Dziewięć zaległych nie zamyka jeszcze lekcji, ale test już stoi otworem: kto chce, nadrabia
-- od razu, zamiast czekać, aż kolejka urośnie do progu i zatrzaśnie kurs.
select ok(
  public.is_lesson_unlocked((select id from t_gate), (select id from t_ids where name = 'uczen')),
  'test powtórkowy jest otwarty, choć bramka jeszcze nie stoi'
);

-- --- etap 2: piętnaście zaległych, kurs zamknięty ---

reset role;

insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, reps)
select (select id from t_ids where name = 'uczen'), s.concept_id, (select id from t_kurs),
       10, 5, current_date - 1, 2
  from t_slowka s
 where s.nr between 10 and 15;

-- Trzy słówka z terminem na przyszłość: nie są zaległe, więc nie powinny ani zwiększać
-- licznika, ani wchodzić do testu.
insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, reps)
select (select id from t_ids where name = 'uczen'), s.concept_id, (select id from t_kurs),
       40, 5, current_date + 7, 3
  from t_slowka s
 where s.nr between 16 and 18;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen'), true),
       set_config('role', 'authenticated', true);

select is(
  public.course_due_words((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  15,
  'słówko z terminem na przyszłość nie jest zaległe'
);

select ok(
  public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  'piętnaście zaległych zamyka kurs'
);

select ok(
  not public.is_lesson_unlocked((select id from t_lesson), (select id from t_ids where name = 'uczen')),
  'zamknięty kurs zamyka zwykłą lekcję'
);

select ok(
  not public.is_lesson_unlocked((select id from t_test_dzialu), (select id from t_ids where name = 'uczen')),
  'zamknięty kurs zamyka też test działu'
);

select ok(
  public.is_lesson_unlocked((select id from t_gate), (select id from t_ids where name = 'uczen')),
  'test powtórkowy jest jedynym otwartym wejściem'
);

select is(
  public.lesson_exercise_count((select id from t_gate), (select id from t_ids where name = 'uczen')),
  public.review_limit(),
  'test powtórkowy bierze najwyżej tyle słówek, co zwykła powtórka'
);

select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select id from t_gate)) g
     join t_slowka s on s.concept_id = g.concept_id
    where s.nr between 16 and 18),
  0,
  'do testu nie wchodzi słówko, którego termin jeszcze nie nadszedł'
);

select ok(
  (select bool_and(not (g.payload ? 'accepted'))
     from public.get_lesson_exercises((select id from t_gate)) g),
  'klucz odpowiedzi nie opuszcza bazy także w teście powtórkowym'
);

-- --- etap 3: oblany test nie zdejmuje blokady ---

insert into t_sesja
select 'oblana', public.start_lesson_session((select id from t_gate), 'bramka-oblana');

do $$
declare
  r record;
begin
  for r in select o.exercise_id from t_odp o where o.nr <= 12 order by o.nr loop
    perform public.submit_attempt(
      (select id from t_sesja where nazwa = 'oblana'),
      r.exercise_id,
      jsonb_build_object('text', 'kompletnie-nie-to-slowo'));
  end loop;
end;
$$;

select is(
  (select public.finish_lesson_session((select id from t_sesja where nazwa = 'oblana')) ->> 'passed'),
  'false',
  'dwanaście błędnych odpowiedzi to oblany test'
);

-- Tu właśnie reguła raz już pękła: błędna odpowiedź przesuwa termin na jutro, więc po oblanym
-- teście zaległych jest mniej niż dziesięć. Sam licznik otworzyłby kurs za nic.
select cmp_ok(
  public.course_due_words((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  '<',
  public.review_gate_limit(),
  'po oblanym teście licznik zaległych spada pod próg'
);

select ok(
  public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  'oblany test nie zdejmuje blokady, choć licznik już nie wystarcza'
);

select ok(
  not public.is_lesson_unlocked((select id from t_lesson), (select id from t_ids where name = 'uczen')),
  'po oblanym teście zwykła lekcja dalej jest zamknięta'
);

-- --- etap 4: zdany test zdejmuje blokadę ---

insert into t_sesja
select 'zdana', public.start_lesson_session((select id from t_gate), 'bramka-zdana');

do $$
declare
  r record;
begin
  for r in select o.exercise_id, o.odp from t_odp o where o.nr between 13 and 15 order by o.nr loop
    perform public.submit_attempt(
      (select id from t_sesja where nazwa = 'zdana'),
      r.exercise_id,
      jsonb_build_object('text', r.odp));
  end loop;
end;
$$;

select is(
  (select public.finish_lesson_session((select id from t_sesja where nazwa = 'zdana')) ->> 'passed'),
  'true',
  'dobre odpowiedzi na całą resztę kolejki to zdany test'
);

select ok(
  not public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen')),
  'zdany test zdejmuje blokadę'
);

select ok(
  public.is_lesson_unlocked((select id from t_lesson), (select id from t_ids where name = 'uczen')),
  'po zdanym teście zwykła lekcja jest znowu otwarta'
);

-- --- etap 5: drugie dziecko, kolejka dłuższa niż test ---
--
-- Dwadzieścia cztery zaległe, test obejmuje dwanaście. Po zdanym teście zostaje dwanaście
-- zaległych, czyli więcej niż próg — a kurs musi być otwarty do końca dnia.

reset role;

insert into public.srs_state (user_id, concept_id, course_id, stability, difficulty, due_on, reps)
select (select id from t_ids where name = 'uczen2'), s.concept_id, (select id from t_kurs),
       10, 5, current_date - 1, 2
  from t_slowka s;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen2'), true),
       set_config('role', 'authenticated', true);

select ok(
  public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen2')),
  'drugie dziecko ma zamknięty kurs po swojemu, niezależnie od pierwszego'
);

insert into t_sesja
select 'druga', public.start_lesson_session((select id from t_gate), 'bramka-drugie-dziecko');

do $$
declare
  r record;
begin
  for r in select o.exercise_id, o.odp from t_odp o where o.nr <= 12 order by o.nr loop
    perform public.submit_attempt(
      (select id from t_sesja where nazwa = 'druga'),
      r.exercise_id,
      jsonb_build_object('text', r.odp));
  end loop;
end;
$$;

select is(
  (select public.finish_lesson_session((select id from t_sesja where nazwa = 'druga')) ->> 'passed'),
  'true',
  'drugie dziecko zdaje swój test'
);

select cmp_ok(
  public.course_due_words((select id from t_kurs), (select id from t_ids where name = 'uczen2')),
  '>=',
  public.review_gate_limit(),
  'zaległych zostało więcej niż próg — sam licznik dalej by blokował'
);

select ok(
  not public.review_gate_on((select id from t_kurs), (select id from t_ids where name = 'uczen2')),
  'zdany test otwiera kurs do końca dnia, choć kolejka nie jest pusta'
);

select ok(
  public.is_lesson_unlocked((select id from t_lesson), (select id from t_ids where name = 'uczen2')),
  'drugie dziecko wraca do lekcji'
);

-- Zdany test zwalnia lekcje, ale sam zostaje otwarty: kolejka ma czterdzieści słówek, a jedno
-- podejście bierze dwanaście. Bez tego resztę dałoby się powtórzyć dopiero jutro.
select ok(
  public.is_lesson_unlocked((select id from t_gate), (select id from t_ids where name = 'uczen2')),
  'test powtórkowy zostaje otwarty, dopóki jest co powtarzać'
);

reset role;

-- Pusta kolejka zamyka test: nie ma z czego go ułożyć, więc kafelek znika.
delete from public.srs_state where user_id = (select id from t_ids where name = 'uczen2');

select ok(
  not public.is_lesson_unlocked((select id from t_gate), (select id from t_ids where name = 'uczen2')),
  'bez zaległych słówek kafelek testu znika'
);

select * from finish();
rollback;
