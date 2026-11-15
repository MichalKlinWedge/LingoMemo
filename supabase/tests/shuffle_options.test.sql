-- Losowa kolejność odpowiedzi na liście wyboru.
--
-- Poprawna odpowiedź stoi w plikach importu zwykle pierwsza i tak też leżała w `payload`.
-- Dziecko, któremu pierwszy kafelek zawsze wychodzi dobry, przestaje czytać listę — i tyle
-- z nauki. Tasuje `get_lesson_exercises` przy wydawaniu zadania, więc sprawdzamy ją, a nie
-- zawartość tabeli.

begin;
select plan(5);

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
insert into t_ids values ('uczen', pg_temp.make_user('uczen-tasowanie@test.local'));

with c as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-tasowanie', 'pl', 'en', 'Kurs testowy', true)
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
 where co.slug = 'test-tasowanie';
grant select on t_ids, t_lesson to authenticated;

-- Poprawna odpowiedź celowo PIERWSZA w payloadzie — dokładnie tak, jak wychodzi z importu.
insert into public.exercises (lesson_id, type, sort_order, payload, points)
select id, 'translate_ab', 1,
       jsonb_build_object(
         'prompt', 'Przeczytajcie tekst.',
         'accepted', jsonb_build_array('Read the text.'),
         'options', jsonb_build_array('Read the text.', 'Write your name.', 'Close your books.', 'Work in pairs.')),
       10
  from t_lesson;

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;
grant select on t_claims to authenticated;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'uczen'), true),
       set_config('role', 'authenticated', true);

-- Dwadzieścia wydań tego samego zadania. Przy czterech odpowiedziach szansa, że dwadzieścia razy
-- z rzędu wypadnie ta sama pierwsza, to jeden do biliona — test nie będzie migotał.
--
-- Pętla, a nie `generate_series` z podzapytaniem: `get_lesson_exercises` jest `stable`, więc
-- w jednym zapytaniu Postgres ma prawo policzyć ją RAZ i podstawić ten sam wynik do wszystkich
-- wierszy — wyszłoby z tego dwadzieścia identycznych list i test „udowodniłby" brak tasowania.
create temporary table t_wydania (n integer, options jsonb);

do $$
declare
  i integer;
  v jsonb;
begin
  for i in 1..20 loop
    select e.payload -> 'options' into v
      from public.get_lesson_exercises((select id from t_lesson)) e
     limit 1;
    insert into t_wydania values (i, v);
  end loop;
end;
$$;

select is(
  (select count(distinct jsonb_array_length(options))::integer from t_wydania),
  1,
  'każde wydanie ma tyle samo odpowiedzi'
);

select is(
  (select jsonb_array_length(options) from t_wydania limit 1),
  4,
  'tasowanie nie gubi ani nie dokłada odpowiedzi'
);

select ok(
  (select bool_and(options @> jsonb_build_array('Read the text.')) from t_wydania),
  'poprawna odpowiedź jest na każdej wydanej liście'
);

select cmp_ok(
  (select count(distinct options ->> 0)::integer from t_wydania),
  '>',
  1,
  'pierwsza odpowiedź na liście bywa różna'
);

-- Przy okazji: tasowanie nie może przy okazji wypuścić klucza odpowiedzi.
select ok(
  (select bool_and(not (
     select e.payload ? 'accepted' from public.get_lesson_exercises((select id from t_lesson)) e limit 1
   )) from generate_series(1, 3)),
  'klucz odpowiedzi dalej nie opuszcza bazy'
);

reset role;

select * from finish();
rollback;
