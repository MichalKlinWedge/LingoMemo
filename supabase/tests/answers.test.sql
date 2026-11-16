-- Pisanie bez polskich liter.
--
-- Dziecko uczy się słówek, a nie klawiszologii: „zazolc" ma być zaliczone tak samo jak
-- „zażółć". Robi to `normalize_answer`, ale każdy nowy typ zadania przepisuje blok porównania
-- u siebie (dziś są cztery takie kopie w migracjach), więc łatwo go w kolejnej kopii zgubić.
-- Ten plik pilnuje, żeby każda droga odpowiedzi przechodziła przez tę samą normalizację.

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

-- --- sama normalizacja ---
select is(public.normalize_answer('Zażółć gęślą jaźń'), 'zazolc gesla jazn', 'ogonki znikają, wielkie litery też');
select is(public.normalize_answer('ŻÓŁW'), public.normalize_answer('zolw'), '„ł" po normalizacji to „l"');
select is(public.normalize_answer('Łódź!'), 'lodz', 'znak przestankowy nie zmienia odpowiedzi');
select is(public.normalize_answer('  idę   do   szkoły '), 'ide do szkoly', 'nadmiarowe spacje nie zmieniają odpowiedzi');

-- --- cała droga odpowiedzi ---
create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('uczen', pg_temp.make_user('uczen-ogonki@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-ogonki@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

with c as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-ogonki', 'pl', 'en', 'Kurs testowy', true)
  returning id
), u as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from c returning id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, 'lekcja', 'Lekcja', 1, true from u;

create temporary table t_lesson as
select l.id from public.lessons l
  join public.units un on un.id = l.unit_id
  join public.courses co on co.id = un.course_id
 where co.slug = 'test-ogonki';

-- Cztery zadania, bo cztery różne gałęzie porównania w `submit_attempt`. Bez `concept_id`:
-- sprawdzamy ocenę odpowiedzi, a nie harmonogram powtórek.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select id, 'translate_ba', 1,
       jsonb_build_object('prompt', 'turtle', 'accepted', jsonb_build_array('żółw')), 10 from t_lesson;
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select id, 'fill_blank_choice', 2,
       jsonb_build_object('sentence', 'To moja {{blank}}.',
         'options', jsonb_build_array('książka', 'gąska', 'łódź'), 'answer', 'książka'), 10 from t_lesson;
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select id, 'sentence_order', 3,
       jsonb_build_object('tokens', jsonb_build_array('szkoły', 'Idę', 'do'),
         'solution', jsonb_build_array('Idę', 'do', 'szkoły')), 10 from t_lesson;
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select id, 'match_pairs', 4,
       jsonb_build_object('pairs', jsonb_build_array(
         jsonb_build_object('a', 'żółw', 'b', 'turtle'),
         jsonb_build_object('a', 'gęś', 'b', 'goose'),
         jsonb_build_object('a', 'łódź', 'b', 'boat'))), 10 from t_lesson;

create temporary table t_ex as
select e.type::text as type, e.id from public.exercises e where e.lesson_id = (select id from t_lesson);

grant select on t_ids, t_lesson, t_ex to authenticated;

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;
grant select on t_claims to authenticated;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen'), true),
       set_config('role', 'authenticated', true);

create temporary table t_session as
select public.start_lesson_session((select id from t_lesson), 'ogonki-1') as id;
grant select on t_session to authenticated;

select is(
  (select public.submit_attempt((select id from t_session), (select id from t_ex where type = 'translate_ba'),
     jsonb_build_object('text', 'zolw')) ->> 'correct'),
  'true',
  'wpisane „zolw" zalicza się jak „żółw"'
);

select is(
  (select public.submit_attempt((select id from t_session), (select id from t_ex where type = 'translate_ba'),
     jsonb_build_object('text', 'ropucha')) ->> 'correct'),
  'false',
  'zupełnie inne słowo dalej jest błędem'
);

select is(
  (select public.submit_attempt((select id from t_session), (select id from t_ex where type = 'fill_blank_choice'),
     jsonb_build_object('choice', 'ksiazka')) ->> 'correct'),
  'true',
  'luka w zdaniu przyjmuje wybór bez ogonków'
);

select is(
  (select public.submit_attempt((select id from t_session), (select id from t_ex where type = 'sentence_order'),
     jsonb_build_object('tokens', jsonb_build_array('Ide', 'do', 'szkoly'))) ->> 'correct'),
  'true',
  'rozsypanka przyjmuje zdanie bez ogonków'
);

select is(
  (select public.submit_attempt((select id from t_session), (select id from t_ex where type = 'match_pairs'),
     jsonb_build_object('pairs', jsonb_build_array(
       jsonb_build_object('a', 'zolw', 'b', 'turtle'),
       jsonb_build_object('a', 'ges', 'b', 'goose'),
       jsonb_build_object('a', 'lodz', 'b', 'boat')))) ->> 'correct'),
  'true',
  'pary łączą się mimo braku ogonków po lewej stronie'
);

reset role;

-- --- kilka poprawnych odpowiedzi ---
--
-- Jedno obce słowo ma po polsku zwykle więcej niż jeden odpowiednik. Panel przyjmuje je
-- w jednym polu, po przecinku; pierwsze jest główne, reszta to synonimy.
select is(
  public.split_answers('ziemniak, kartofel / pyra ; ziemniak'),
  array['ziemniak', 'kartofel', 'pyra'],
  'pole formularza rozbija się na listę, bez pustych i bez powtórzeń'
);

select set_config('request.jwt.claims', (select claims from t_claims where name = 'admin'), true),
       set_config('role', 'authenticated', true);

select public.admin_add_word((select id from t_lesson), 'food.potato', 'ziemniak, kartofel', 'potato');

reset role;

-- Do etapu wchodzi jedno zadanie na słówko (`…_word_on_every_level.sql`), losowane z jego
-- wariantów. Zostawiamy ziemniakowi tylko to, które ten plik ocenia — inaczej o wyniku testu
-- decydowałoby losowanie.
delete from public.exercises e
 using public.concepts c
 where c.id = e.concept_id and c.key = 'food.potato' and e.type <> 'translate_ba';

-- Identyfikator zadania wyciągamy jako rola bazy: `exercises` nie ma polityki SELECT dla
-- ucznia (w payloadzie są klucze odpowiedzi), więc jego zapytanie zwróciłoby pustkę.
create temporary table t_potato as
select e.id from public.exercises e
  join public.concepts c on c.id = e.concept_id
 where c.key = 'food.potato' and e.type = 'translate_ba';
grant select on t_potato to authenticated;

-- Poziom: sesja wydaje zadania poziomu łatwego, a ten plik sprawdza samo ocenianie odpowiedzi,
-- więc cała lekcja idzie na łatwym.
update public.exercises set level = 1 where lesson_id = (select id from t_lesson);

select is(
  (select e.payload -> 'accepted' from public.exercises e
     join public.concepts c on c.id = e.concept_id
    where c.key = 'food.potato' and e.type = 'translate_ba'),
  jsonb_build_array('ziemniak', 'kartofel'),
  'tłumaczenie na polski przyjmuje obie formy'
);

select is(
  (select t.text from public.terms t
     join public.concepts c on c.id = t.concept_id
    where c.key = 'food.potato' and t.lang = 'pl' and t.is_primary),
  'ziemniak',
  'pierwsza forma zostaje słowem głównym'
);

select is(
  (select count(*)::integer from public.terms t
     join public.concepts c on c.id = t.concept_id
    where c.key = 'food.potato' and t.lang = 'pl' and not t.is_primary),
  1,
  'druga forma ląduje w słowniku jako synonim'
);

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen'), true),
       set_config('role', 'authenticated', true);

-- Nowa sesja, nie ta otwarta na początku pliku: słówko powstało dopiero teraz, więc w zadaniach
-- wydanych tamtej sesji go nie było. Od migracji 094200 sesja przyjmuje tylko to, co sama
-- wydała — dokładnie tak jak w aplikacji, gdzie dziecko dostaje słówko dołożone w trakcie
-- dopiero przy następnym wejściu w lekcję.
select is(
  (select public.submit_attempt(
     public.start_lesson_session((select id from t_lesson), 'ogonki-po-dodaniu-slowka'),
     (select id from t_potato),
     jsonb_build_object('text', 'kartofel')) ->> 'correct'),
  'true',
  'drugi odpowiednik też jest zaliczany'
);

reset role;

-- Poprawka z jedną formą zabiera synonim: w polu stoi dokładnie to, co ma być przyjmowane.
select set_config('request.jwt.claims', (select claims from t_claims where name = 'admin'), true),
       set_config('role', 'authenticated', true);

select public.admin_update_word(
  (select id from public.concepts where key = 'food.potato'), 'ziemniak', 'potato');

reset role;

select is(
  (select e.payload -> 'accepted' from public.exercises e
     join public.concepts c on c.id = e.concept_id
    where c.key = 'food.potato' and e.type = 'translate_ba'),
  jsonb_build_array('ziemniak'),
  'skasowany synonim znika też z zadania'
);

select * from finish();
rollback;
