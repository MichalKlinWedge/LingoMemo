-- Każde słówko na każdym poziomie, a do etapu raz.
--
-- Dwie reguły, dwa końce pliku. Najpierw generatory: po przebiegu każde słówko lekcji ma
-- zadanie na łatwym, średnim i trudnym — także słówko, które nie miało ani jednego zadania.
-- Potem wydawanie: słówko z kilkoma zadaniami tego samego poziomu wchodzi do lekcji RAZ,
-- a wariant zależy od dziecka i od jego doby.

begin;
select plan(13);

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
insert into t_ids values ('ala', pg_temp.make_user('ala-poziomy@test.local'));
insert into t_ids values ('bartek', pg_temp.make_user('bartek-poziomy@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-poziomy', 'pl', 'en', 'Kurs testowy', true) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order, is_published)
  select id, 'dzial', 'Dział', 1, true from k returning id
)
insert into public.lessons (unit_id, slug, title, sort_order, is_published)
select id, 'lekcja', 'Lekcja', 1, true from d;

create temporary table t_ctx as
select l.id as lesson_id, un.course_id
  from public.lessons l
  join public.units un on un.id = l.unit_id
  join public.courses co on co.id = un.course_id
 where co.slug = 'test-poziomy';

create temporary table t_claims as
select t.name,
       json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text as claims
  from t_ids t join auth.users u on u.id = t.id;

grant select on t_ids, t_ctx, t_claims to authenticated;

-- Osiem słówek. Pierwsze dodane nie ma jeszcze z czego wziąć dystraktorów, więc jego
-- tłumaczenie powstaje bez kafelków — i właśnie dlatego nie ma poziomu łatwego.
select set_config('request.jwt.claims', (select claims from t_claims where name = 'admin'), true),
       set_config('role', 'authenticated', true);

do $$
declare
  i integer;
begin
  for i in 1..8 loop
    perform public.admin_add_word((select lesson_id from t_ctx), 'poziom.' || i, 'slowo' || i, 'word' || i);
  end loop;
end;
$$;

reset role;

-- Słówko dołożone bez ani jednego zadania: w panelu stoi w liście słówek z „zadań: 0".
with c as (
  insert into public.concepts (course_id, key) select course_id, 'poziom.goly' from t_ctx returning id
), ts as (
  insert into public.terms (concept_id, lang, text, is_primary)
  select id, 'pl', 'linijka', true from c
  union all
  select id, 'en', 'ruler', true from c
  returning concept_id
)
insert into public.lesson_items (lesson_id, concept_id, sort_order)
select (select lesson_id from t_ctx), (select id from c), 99;

select cmp_ok(
  (select count(distinct li.concept_id)::integer
     from public.lesson_items li
    where li.lesson_id = (select lesson_id from t_ctx)
      and not exists (
        select 1 from public.exercises e
         where e.lesson_id = li.lesson_id and e.is_active
           and e.concept_id = li.concept_id and e.level = 1
      )),
  '>',
  0,
  'punkt wyjścia: są słówka bez zadania na poziomie łatwym'
);

-- --- generatory ---

create temporary table t_dorobione as
select public.build_easy_variants((select lesson_id from t_ctx)) as latwe;
insert into t_dorobione
select public.build_medium_variants((select lesson_id from t_ctx));
insert into t_dorobione
select public.build_hard_variants((select lesson_id from t_ctx));

select cmp_ok((select min(latwe) from t_dorobione), '>', 0, 'generatory dorabiają brakujące zadania');

select is(
  (select count(*)::integer
     from public.lesson_items li
     cross join generate_series(1, 3) poziom
    where li.lesson_id = (select lesson_id from t_ctx)
      and not exists (
        select 1 from public.exercises e
         where e.lesson_id = li.lesson_id and e.is_active
           and e.concept_id = li.concept_id and e.level = poziom
      )),
  0,
  'każde słówko lekcji ma zadanie na każdym z trzech poziomów'
);

select cmp_ok(
  (select count(*)::integer from public.exercises e
     join public.concepts c on c.id = e.concept_id
    where e.lesson_id = (select lesson_id from t_ctx) and c.key = 'poziom.goly'),
  '>=',
  3,
  'słówko dołożone bez zadań dostaje komplet trzech'
);

select is(
  (select e.payload ->> 'lang' from public.exercises e
     join public.concepts c on c.id = e.concept_id
    where e.lesson_id = (select lesson_id from t_ctx) and c.key = 'poziom.goly' and e.type = 'listening'),
  'en-GB',
  'zadanie trudne czyta głosem języka kursu'
);

select is(
  public.build_easy_variants((select lesson_id from t_ctx)),
  0,
  'drugi przebieg nie dokłada łatwych — każde słówko już je ma'
);

select is(
  public.build_hard_variants((select lesson_id from t_ctx)),
  0,
  'drugi przebieg nie dokłada trudnych'
);

-- --- jedno zadanie na słówko w etapie ---
--
-- Każde słówko dostaje DRUGIE zadanie poziomu łatwego, żeby było z czego losować.

insert into public.exercises (lesson_id, type, sort_order, concept_id, payload, points, level)
select e.lesson_id, e.type, e.sort_order + 500, e.concept_id, e.payload, e.points, 1
  from public.exercises e
 where e.lesson_id = (select lesson_id from t_ctx) and e.level = 1 and e.concept_id is not null;

create temporary table t_slowka as
select count(distinct li.concept_id)::integer as ile
  from public.lesson_items li where li.lesson_id = (select lesson_id from t_ctx);

grant select on t_ctx, t_slowka to authenticated;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'ala'), true),
       set_config('role', 'authenticated', true);

select is(
  (select count(*)::integer from public.lesson_exercises_at_level((select lesson_id from t_ctx), 1::smallint)),
  (select ile from t_slowka),
  'do lekcji wchodzi tyle zadań, ile słówek — każde słówko raz'
);

select is(
  public.lesson_exercise_count((select lesson_id from t_ctx), (select id from t_ids where name = 'ala')),
  (select ile from t_slowka),
  'na tej samej liczbie opiera się podział lekcji na etapy'
);

select is(
  (select count(*)::integer
     from public.lesson_exercises_at_level((select lesson_id from t_ctx), 1::smallint) v
     join public.exercises e on e.id = v.exercise_id
    where e.level <> 1),
  0,
  'wybrane zadania są z poziomu, o który pytamy'
);

-- Reguła wyboru: z zadań słówka wypada to, które ma dziś najmniejsze ziarno.
select is(
  (select count(*)::integer
     from public.lesson_exercises_at_level((select lesson_id from t_ctx), 1::smallint) v
     join public.exercises e on e.id = v.exercise_id
    where e.concept_id is not null
      and e.id <> (
        select e2.id from public.exercises e2
         where e2.lesson_id = e.lesson_id and e2.is_active and e2.level = 1
           and e2.concept_id = e.concept_id
         order by public.variant_pick(e2.id)
         limit 1
      )),
  0,
  'wchodzi dokładnie ten wariant, który dziś wypada pierwszy'
);

-- Identyfikator zadania bierzemy jako rola bazy: uczeń nie ma polityki SELECT na `exercises`
-- (w payloadzie są klucze odpowiedzi), więc jego zapytanie zwróciłoby pustkę.
reset role;

create temporary table t_jedno as
select e.id from public.exercises e
 where e.lesson_id = (select lesson_id from t_ctx) and e.level = 1
 order by e.id limit 1;

create temporary table t_ziarno (kto text, pick text);
grant select on t_jedno to authenticated;
grant select, insert on t_ziarno to authenticated;

select set_config('request.jwt.claims', (select claims from t_claims where name = 'ala'), true),
       set_config('role', 'authenticated', true);

insert into t_ziarno select 'ala', public.variant_pick((select id from t_jedno));

-- To samo zadanie, drugie dziecko: ziarno ma być inne, bo inaczej rodzeństwo robiłoby
-- co do zadania tę samą lekcję.
select set_config('request.jwt.claims', (select claims from t_claims where name = 'bartek'), true),
       set_config('role', 'authenticated', true);

insert into t_ziarno select 'bartek', public.variant_pick((select id from t_jedno));

select isnt(
  (select pick from t_ziarno where kto = 'ala'),
  (select pick from t_ziarno where kto = 'bartek'),
  'każde dziecko losuje swój wariant'
);

reset role;

-- Doba dziecka, nie doba serwera: strefy oddalone o 26 godzin mają zawsze różną datę.
update public.profiles set time_zone = 'Pacific/Kiritimati' where id = (select id from t_ids where name = 'ala');

select set_config('request.jwt.claims', (select claims from t_claims where name = 'ala'), true),
       set_config('role', 'authenticated', true);

insert into t_ziarno select 'ala-jutro', public.variant_pick((select id from t_jedno));

reset role;

update public.profiles set time_zone = 'Etc/GMT+12' where id = (select id from t_ids where name = 'ala');

select set_config('request.jwt.claims', (select claims from t_claims where name = 'ala'), true),
       set_config('role', 'authenticated', true);

insert into t_ziarno select 'ala-wczoraj', public.variant_pick((select id from t_jedno));

select isnt(
  (select pick from t_ziarno where kto = 'ala-jutro'),
  (select pick from t_ziarno where kto = 'ala-wczoraj'),
  'inny dzień to inny wariant'
);

reset role;

select * from finish();
rollback;
