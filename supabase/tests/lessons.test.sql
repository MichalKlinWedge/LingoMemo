-- Przebieg lekcji: sprawdzanie odpowiedzi, punkty, powtórki, podsumowanie.
--
-- Sprawdza to, co w aplikacji dla dziecka jest widoczne od razu: czy odpowiedź jest uznana,
-- czy punkty nie lecą dwa razy za to samo i czy po zaliczeniu lekcji otwiera się następna.

begin;
select plan(30);

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
    p_email, 'test-nie-do-logowania',
    now(), '{}'::jsonb, jsonb_build_object('display_name', 'zosia'), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_user as select pg_temp.make_user('zosia-lekcje@test.local') as id;

create temporary table t_lesson as
  select l.id, row_number() over (order by u.sort_order, l.sort_order) as nr
  from public.lessons l
  join public.units u on u.id = l.unit_id
  join public.courses c on c.id = u.course_id
  where c.slug = 'pl-en-starter';

-- Słówka z pierwszej lekcji mają po cztery litery, a tolerancja literówki dotyczy dłuższych —
-- dokładamy więc zadanie, na którym da się ją sprawdzić.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
values (
  (select id from t_lesson where nr = 1), 'translate_ba', 999,
  jsonb_build_object('prompt', 'rabbit', 'accepted', jsonb_build_array('królik')), 10
);

-- Wybór obrazka. W starterze go nie ma, a jest to jedyne zadanie, którego odpowiedzią jest
-- ścieżka pliku — porównywana znak w znak, bez normalizacji.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
values (
  (select id from t_lesson where nr = 1), 'image_choice', 998,
  jsonb_build_object(
    'prompt', 'pies',
    'options', jsonb_build_array('2026/pies.png', '2026/kot.png'),
    'answer', '2026/pies.png'
  ), 10
);

create temporary table t_ex as
  select id, type, sort_order, payload
  from public.exercises
  where lesson_id = (select id from t_lesson where nr = 1);

create temporary table t_session (id uuid);
create temporary table t_r (step text primary key, result jsonb);

grant select on t_user, t_lesson, t_ex to authenticated;
grant select, insert on t_session, t_r to authenticated;

-- --- jako uczennica ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated', 'app_metadata', '{}'::jsonb)::text
            from auth.users u where u.id = (select id from t_user)), true);

insert into t_session select public.start_lesson_session((select id from t_lesson where nr = 1), 'test-1');

select is(
  (select count(*)::integer from public.get_lesson_exercises((select id from t_lesson where nr = 1))),
  (select count(*)::integer from t_ex),
  'lekcja wydaje wszystkie swoje zadania'
);

select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select id from t_lesson where nr = 1)) g
    where g.payload ? 'accepted' or g.payload ? 'answer' or g.payload ? 'solution'),
  0,
  'treść zadania nie zawiera poprawnej odpowiedzi'
);

-- Poprawna odpowiedź na zadanie wyboru.
insert into t_r
select 'dobrze', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'translate_ab' order by sort_order limit 1),
  jsonb_build_object('choice',
    (select payload -> 'accepted' ->> 0 from t_ex where type = 'translate_ab' order by sort_order limit 1)),
  2500, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'dobrze'), true,
          'poprawna odpowiedź jest uznana');
select is((select (result ->> 'points')::integer from t_r where step = 'dobrze'), 10,
          'za poprawną odpowiedź są punkty');
select is((select (result ->> 'grade')::integer from t_r where step = 'dobrze'), 4,
          'szybkie dotknięcie to ocena „łatwe” dla harmonogramu powtórek');

-- Błędna odpowiedź.
insert into t_r
select 'zle', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'translate_ba' and sort_order < 999 order by sort_order limit 1),
  jsonb_build_object('text', 'zupełnie nie to słowo'), 5000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'zle'), false,
          'błędna odpowiedź nie jest uznana');
select isnt((select result -> 'correctAnswer' from t_r where step = 'zle'), 'null'::jsonb,
          'przy błędzie pokazujemy poprawną odpowiedź');

-- Literówka.
insert into t_r
select 'literowka', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where sort_order = 999),
  jsonb_build_object('text', 'krolikk'), 6000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'literowka'), true,
          'jedna literówka nie przekreśla odpowiedzi');
select is((select (result ->> 'nearMiss')::boolean from t_r where step = 'literowka'), true,
          'literówka jest odnotowana');
select is((select (result ->> 'grade')::integer from t_r where step = 'literowka'), 2,
          'literówka to ocena „z trudem” dla harmonogramu powtórek');

-- Punkty za to samo zadanie tylko raz w sesji.
insert into t_r
select 'powtorka', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'translate_ab' order by sort_order limit 1),
  jsonb_build_object('choice',
    (select payload -> 'accepted' ->> 0 from t_ex where type = 'translate_ab' order by sort_order limit 1)),
  2500, false
);

select is(
  (select count(*)::integer from public.points_ledger
    where reason = 'exercise_correct'
      and ref_id = (select id from t_ex where type = 'translate_ab' order by sort_order limit 1)),
  1,
  'to samo zadanie nie płaci punktami dwa razy'
);

-- Dopasowywanie ze słuchu. Rozwiązaniem jest przyporządkowanie, więc to ono — a nie same słowa —
-- nie może opuścić bazy.
select is(
  (select count(*)::integer
     from public.get_lesson_exercises((select id from t_lesson where nr = 1)) g
    where g.type = 'listen_match' and g.payload ? 'pairs'),
  0,
  'dopasowywanie ze słuchu nie wydaje gotowych par'
);

select is(
  (select jsonb_array_length(g.payload -> 'audio') + jsonb_array_length(g.payload -> 'words')
     from public.get_lesson_exercises((select id from t_lesson where nr = 1)) g
    where g.type = 'listen_match'),
  8,
  'obie kolumny dopasowywania ze słuchu mają komplet kafelków'
);

insert into t_r
select 'sluch-zle', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'listen_match' limit 1),
  jsonb_build_object('pairs', jsonb_build_array(
    jsonb_build_object('a', 'pies', 'b', 'cat'),
    jsonb_build_object('a', 'kot',  'b', 'dog'),
    jsonb_build_object('a', 'ptak', 'b', 'fish'),
    jsonb_build_object('a', 'ryba', 'b', 'bird'))),
  5000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'sluch-zle'), false,
          'przestawione pary ze słuchu nie są uznane');
select alike((select result ->> 'correctAnswer' from t_r where step = 'sluch-zle'), '%pies — dog%',
          'przy błędzie w dopasowywaniu pokazujemy komplet par');

insert into t_r
select 'sluch-dobrze', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'listen_match' limit 1),
  jsonb_build_object('pairs', (select payload -> 'pairs' from t_ex where type = 'listen_match' limit 1)),
  3000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'sluch-dobrze'), true,
          'komplet poprawnych par ze słuchu jest uznany');
select is((select (result ->> 'grade')::integer from t_r where step = 'sluch-dobrze'), 4,
          'szybkie dopasowanie ze słuchu to ocena „łatwe” dla harmonogramu powtórek');

-- Wybór obrazka. Ścieżka właściwego pliku wraca dopiero przy błędzie — w treści zadania jej nie
-- ma, bo inaczej wystarczyłoby zajrzeć w odpowiedź serwera zamiast patrzeć na obrazki.
insert into t_r
select 'obrazek-zle', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'image_choice' limit 1),
  jsonb_build_object('choice', '2026/kot.png'),
  5000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'obrazek-zle'), false,
          'wskazanie nie tego obrazka nie jest uznane');
select is((select result ->> 'correctAnswer' from t_r where step = 'obrazek-zle'), '2026/pies.png',
          'przy błędzie wraca ścieżka właściwego obrazka');

-- Normalizacja zjadłaby kropkę i ukośnik, więc sąsiednia nazwa pliku stałaby się tą samą
-- odpowiedzią. Tu ma nie zostać uznana.
insert into t_r
select 'obrazek-prawie', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'image_choice' limit 1),
  jsonb_build_object('choice', '2026-pies-png'),
  5000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'obrazek-prawie'), false,
          'ścieżkę obrazka porównujemy znak w znak');

insert into t_r
select 'obrazek-dobrze', public.submit_attempt(
  (select id from t_session),
  (select id from t_ex where type = 'image_choice' limit 1),
  jsonb_build_object('choice', '2026/pies.png'),
  3000, false
);

select is((select (result ->> 'correct')::boolean from t_r where step = 'obrazek-dobrze'), true,
          'wskazanie właściwego obrazka jest uznane');
select is((select (result ->> 'grade')::integer from t_r where step = 'obrazek-dobrze'), 4,
          'szybkie wskazanie obrazka to ocena „łatwe” dla harmonogramu powtórek');

-- Stan powtórek.
select ok(
  (select count(*) from public.srs_state) > 0,
  'odpowiedź zakłada stan powtórek dla słówka'
);

select ok(
  (select min(due_on) from public.srs_state) > current_date,
  'termin powtórki wypada w przyszłości'
);

select throws_ok(
  'select public.submit_attempt(gen_random_uuid(), gen_random_uuid(), ''{}''::jsonb)',
  '42501',
  null,
  'nie da się odpowiadać w nieswojej sesji'
);

-- Reszta lekcji: wszystko poprawnie. Liczy się ostatnia odpowiedź na zadanie, więc wcześniejszy
-- błąd nie psuje wyniku.
do $run$
declare
  r record;
  v jsonb;
begin
  for r in select * from t_ex order by sort_order loop
    v := case r.type
      when 'translate_ab' then jsonb_build_object('choice', r.payload -> 'accepted' ->> 0)
      when 'fill_blank_choice' then jsonb_build_object('choice', r.payload ->> 'answer')
      when 'match_pairs' then jsonb_build_object('pairs', r.payload -> 'pairs')
      when 'listen_match' then jsonb_build_object('pairs', r.payload -> 'pairs')
      when 'image_choice' then jsonb_build_object('choice', r.payload ->> 'answer')
      when 'sentence_order' then jsonb_build_object('tokens', r.payload -> 'solution')
      else jsonb_build_object('text', r.payload -> 'accepted' ->> 0)
    end;
    perform public.submit_attempt((select id from t_session), r.id, v, 9000, false);
  end loop;
end;
$run$;

create temporary table t_finish as select public.finish_lesson_session((select id from t_session)) as result;

select is((select (result ->> 'score')::numeric from t_finish), 1.000::numeric,
          'wszystkie odpowiedzi poprawne dają pełny wynik');
select is((select (result ->> 'stars')::integer from t_finish), 3,
          'pełny wynik to trzy gwiazdki');
select is((select (result ->> 'passed')::boolean from t_finish), true,
          'lekcja zaliczona');

select is(
  (select count(*)::integer from public.lessons where id = (select id from t_lesson where nr = 2)),
  1,
  'po zaliczeniu lekcji otwiera się następna'
);

select ok(
  (select count(*) from public.user_badges where badge_code = 'first_lesson') = 1,
  'za pierwszą ukończoną lekcję jest odznaka'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
