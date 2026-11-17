-- Macierz uprawnień: co widzi uczeń, czego nie widzi, co wolno administratorowi.
--
-- RLS to warstwa bezpieczeństwa, więc musi mieć testy — błąd w polityce nie objawia się
-- wyjątkiem, tylko cudzymi danymi na ekranie dziecka.
--
-- „Wejście jako użytkownik" to ustawienie roli bazy i claimów, które czytają auth.uid()
-- i is_admin(). Robione zapytaniem, nie funkcją: zmiana roli wewnątrz funkcji potrafi zostać
-- cofnięta przy wyjściu z niej.

begin;
select plan(24);

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
    now(), '{}'::jsonb, jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('zosia', pg_temp.make_user('zosia@test.local'));
insert into t_ids values ('janek', pg_temp.make_user('janek@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin@test.local'));

-- 1. Profil powstaje razem z kontem.
select is(
  (select display_name from public.profiles where id = (select id from t_ids where name = 'zosia')),
  'zosia',
  'trigger zakłada profil przy zakładaniu konta'
);

-- 2. Nadanie roli administratora przepisuje claim do app_metadata.
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

select is(
  (select (raw_app_meta_data ->> 'is_admin')::boolean from auth.users
    where id = (select id from t_ids where name = 'admin')),
  true,
  'nadanie administratora przepisuje claim do app_metadata'
);

select is(
  (select coalesce((raw_app_meta_data ->> 'is_admin')::boolean, false) from auth.users
    where id = (select id from t_ids where name = 'zosia')),
  false,
  'zwykły uczeń nie ma claimu administratora'
);

-- Lekcje z kursu demonstracyjnego: pierwsza otwarta, druga zamknięta.
create temporary table t_lessons as
  select l.id, row_number() over (order by u.sort_order, l.sort_order) as nr
  from public.lessons l
  join public.units u on u.id = l.unit_id
  join public.courses c on c.id = u.course_id
  where c.slug = 'pl-en-starter';

-- Tabele tymczasowe należą do postgresa; bez tego odwołanie do nich po zmianie roli padłoby
-- na brak uprawnień i test przeszedłby z niewłaściwego powodu.
-- Lekcja robocza: gotowa, ale jeszcze nieopublikowana. Dla dziecka nie istnieje, administrator
-- ma ją podejrzeć przed pokazaniem jej komukolwiek. Zadanie musi być choć jedno — bez zadań
-- lekcja nie ma ani jednego etapu i wejście w nią kończy się innym błędem.
create temporary table t_draft as
with nowa as (
  insert into public.lessons (unit_id, slug, title, sort_order, is_published)
  select u.id, 'robocza', 'Lekcja robocza', 99, false
    from public.units u
    join public.courses c on c.id = u.course_id
   where c.slug = 'pl-en-starter'
   order by u.sort_order
   limit 1
  returning id
)
select id from nowa;

insert into public.exercises (lesson_id, type, sort_order, payload, points)
values (
  (select id from t_draft), 'translate_ab', 1,
  jsonb_build_object('prompt', 'pies', 'accepted', jsonb_build_array('dog')), 10
);

grant select on t_ids, t_lessons, t_draft to authenticated;

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'zosia')), true);

select is(
  (select count(*)::integer from public.profiles),
  1,
  'uczeń widzi wyłącznie własny profil'
);

-- Zadania zawierają poprawne odpowiedzi. Uczeń nie dostaje błędu, tylko pustkę — polityka
-- SELECT na tej tabeli obejmuje wyłącznie administratora.
select is(
  (select count(*)::integer from public.exercises),
  0,
  'uczeń nie zobaczy ani jednego zadania wprost z tabeli (są tam poprawne odpowiedzi)'
);

select throws_ok(
  'insert into public.points_ledger (user_id, delta, reason) values (auth.uid(), 1000000, ''manual'')',
  '42501',
  null,
  'uczeń nie dopisze sobie punktów'
);

select throws_ok(
  'select 1 from app_private.admin_users',
  '42501',
  null,
  'uczeń nie zajrzy do listy administratorów'
);

select throws_ok(
  'insert into public.lesson_progress (user_id, lesson_id, status) '
  'values (auth.uid(), (select id from t_lessons where nr = 2), ''completed'')',
  '42501',
  null,
  'uczeń nie oznaczy sobie lekcji jako zaliczonej'
);

select is(
  (select count(*)::integer from public.lessons where id = (select id from t_lessons where nr = 1)),
  1,
  'pierwsza lekcja w kursie jest otwarta'
);

-- Zamknięta lekcja jest widoczna na ekranie kursu (kafelek z kłódką), ale nie da się jej zacząć
-- ani podejrzeć jej zadań.
select is(
  (select is_unlocked from public.v_my_lessons where id = (select id from t_lessons where nr = 2)),
  false,
  'kolejna lekcja jest widoczna, ale zamknięta'
);

select throws_ok(
  'select public.get_lesson_exercises((select id from t_lessons where nr = 2))',
  '42501',
  null,
  'zadań z zamkniętej lekcji nie da się pobrać'
);

select throws_ok(
  'select public.start_lesson_session((select id from t_lessons where nr = 2), ''proba'')',
  '42501',
  null,
  'zamkniętej lekcji nie da się zacząć'
);

select throws_ok(
  'select public.get_lesson_exercises((select id from t_draft))',
  '22023',
  null,
  'lekcja przed publikacją dla dziecka nie istnieje'
);

-- Zmiana cudzego profilu przechodzi bez błędu, ale nie zmienia ani jednego wiersza.
update public.profiles set display_name = 'wlamywacz'
 where id = (select id from t_ids where name = 'janek');

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

select is(
  (select display_name from public.profiles where id = (select id from t_ids where name = 'janek')),
  'janek',
  'uczeń nie zmieni cudzego profilu'
);

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select ok(
  (select count(*) from public.exercises) > 0,
  'administrator widzi zadania'
);

select ok(
  (select count(*) from public.lessons) >= 6,
  'administrator widzi także lekcje zamknięte dla ucznia'
);

-- Nauka administratora idzie na tych samych zasadach co nauka dziecka: warunek wstępny
-- obowiązuje też jego. Obejście jest jedno i trzeba o nie poprosić wprost — `p_preview`,
-- czyli podgląd z panelu.
select is(
  public.is_lesson_unlocked((select id from t_lessons where nr = 2), (select id from t_ids where name = 'admin')),
  false,
  'administrator ucząc się ma tę samą kłódkę co dziecko'
);

select throws_ok(
  'select public.get_lesson_exercises((select id from t_lessons where nr = 2))',
  'Ta lekcja jest jeszcze zamknięta',
  'bez podglądu zamknięta lekcja nie wydaje zadań także administratorowi'
);

select lives_ok(
  'select public.get_lesson_exercises((select id from t_lessons where nr = 2), 1, 1::smallint, true)',
  'z podglądem administrator obejrzy zadania z lekcji zamkniętej dla ucznia'
);

-- Pytanie o cudzy postęp dalej mówi o tamtym dziecku: claim administratora nie może odemknąć
-- lekcji na ekranie ucznia, bo to jego postępy, nie oglądającego.
select is(
  public.is_lesson_unlocked((select id from t_lessons where nr = 2), (select id from t_ids where name = 'janek')),
  false,
  'patrząc na ucznia, administrator widzi jego kłódkę'
);

-- Podgląd roboczy: inaczej trzeba by opublikować lekcję, żeby ją sprawdzić, czyli pokazać
-- dzieciom coś niesprawdzonego.
select throws_ok(
  'select public.get_lesson_exercises((select id from t_draft))',
  'Nie ma takiej lekcji',
  'bez podglądu lekcja przed publikacją nie istnieje nawet dla administratora'
);

select ok(
  (select count(*) from public.get_lesson_exercises((select id from t_draft), 1, 1::smallint, true)) > 0,
  'z podglądem administrator obejrzy lekcję przed publikacją'
);

select lives_ok(
  'select public.start_lesson_session((select id from t_draft), ''podglad'', 1, 1::smallint, true)',
  'z podglądem administrator zacznie lekcję przed publikacją'
);

select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);

-- --- asercja całościowa ---
select is(
  (select count(*)::integer from pg_tables t
    where t.schemaname = 'public'
      and not exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
      )),
  0,
  'każda tabela w schemacie public ma włączone RLS'
);

select * from finish();
rollback;
