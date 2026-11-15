-- Macierz uprawnień: co widzi uczeń, czego nie widzi, co wolno administratorowi.
--
-- RLS to warstwa bezpieczeństwa, więc musi mieć testy — błąd w polityce nie objawia się
-- wyjątkiem, tylko cudzymi danymi na ekranie dziecka.
--
-- „Wejście jako użytkownik" to ustawienie roli bazy i claimów, które czytają auth.uid()
-- i is_admin(). Robione zapytaniem, nie funkcją: zmiana roli wewnątrz funkcji potrafi zostać
-- cofnięta przy wyjściu z niej.

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
grant select on t_ids, t_lessons to authenticated;

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

select is(
  (select count(*)::integer from public.lessons where id = (select id from t_lessons where nr = 2)),
  0,
  'kolejna lekcja jest niewidoczna, dopóki poprzednia nie jest zaliczona'
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
