-- Zmiana kolejności działów w kursie.
--
-- Funkcja przepisuje `sort_order` całej liście naraz, więc testujemy głównie to, czego NIE
-- wolno: niepełnej listy, działu z innego kursu i duplikatu. Każdy z tych przypadków zostawiłby
-- ekran kursu z dwoma działami na tej samej pozycji.

begin;
select plan(8);

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
insert into t_ids values ('admin', pg_temp.make_user('admin-uord@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-uord@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Kurs z trzema działami i drugi kurs z jednym — do sprawdzenia, że obce działy nie przechodzą.
create temporary table t_ctx as
with k1 as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kolejnosc-dzialow', 'pl', 'en', 'Kurs testowy', false) returning id
), k2 as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kolejnosc-obcy', 'pl', 'en', 'Kurs obok', false) returning id
), d as (
  insert into public.units (course_id, slug, title, sort_order)
  select k1.id, x.slug, x.title, x.nr
    from k1, (values ('a', 'Dział A', 1), ('b', 'Dział B', 2), ('c', 'Dział C', 3)) as x(slug, title, nr)
  returning id, slug
), obcy as (
  insert into public.units (course_id, slug, title, sort_order)
  select id, 'obcy', 'Dział z innego kursu', 1 from k2 returning id
)
select (select id from k1) as kurs,
       (select id from d where slug = 'a') as dzial_a,
       (select id from d where slug = 'b') as dzial_b,
       (select id from d where slug = 'c') as dzial_c,
       (select id from obcy) as obcy;

grant select on t_ids, t_ctx to authenticated;

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_reorder_units(%L, array[%L, %L, %L]::uuid[])',
         (select kurs from t_ctx), (select dzial_c from t_ctx),
         (select dzial_b from t_ctx), (select dzial_a from t_ctx)),
  '42501',
  null,
  'uczeń nie przestawi działów'
);

reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  format('select public.admin_reorder_units(%L, array[%L, %L]::uuid[])',
         (select kurs from t_ctx), (select dzial_c from t_ctx), (select dzial_b from t_ctx)),
  '22023',
  null,
  'niepełna lista nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_units(%L, array[%L, %L, %L]::uuid[])',
         (select kurs from t_ctx), (select dzial_a from t_ctx),
         (select dzial_b from t_ctx), (select obcy from t_ctx)),
  '22023',
  null,
  'dział z innego kursu nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_units(%L, array[%L, %L, %L]::uuid[])',
         (select kurs from t_ctx), (select dzial_a from t_ctx),
         (select dzial_a from t_ctx), (select dzial_b from t_ctx)),
  '22023',
  null,
  'ten sam dział dwa razy nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_units(''00000000-0000-0000-0000-000000000008''::uuid, array[%L]::uuid[])',
         (select dzial_a from t_ctx)),
  '22023',
  null,
  'kurs bez działów albo nieistniejący nie przechodzi'
);

select is(
  (select public.admin_reorder_units(
            (select kurs from t_ctx),
            array[(select dzial_c from t_ctx), (select dzial_a from t_ctx), (select dzial_b from t_ctx)]::uuid[])),
  jsonb_build_object('units', 3),
  'administrator przestawia działy'
);

reset role;

select is(
  (select array_agg(u.slug order by u.sort_order) from public.units u
    where u.course_id = (select kurs from t_ctx)),
  array['c', 'a', 'b'],
  'działy stoją w nowej kolejności'
);

select is(
  (select u.sort_order from public.units u where u.id = (select obcy from t_ctx)),
  1,
  'dział z drugiego kursu zostaje nietknięty'
);

select * from finish();
rollback;
