-- Zmiana kolejności lekcji w dziale.
--
-- Funkcja przepisuje `sort_order` całej liście naraz, więc testujemy głównie to, czego NIE
-- wolno: niepełnej listy, cudzej lekcji i duplikatu. Każdy z tych przypadków zostawiłby mapę
-- kursu z dwiema lekcjami na tej samej pozycji.

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
insert into t_ids values ('admin', pg_temp.make_user('admin-ord@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-ord@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));

-- Dział z trzema lekcjami i drugi dział z jedną — do sprawdzenia, że obce lekcje nie przechodzą.
create temporary table t_ctx as
with k as (
  insert into public.courses (slug, source_lang, target_lang, title, is_published)
  values ('test-kolejnosc', 'pl', 'en', 'Kurs testowy', false) returning id
), d1 as (
  insert into public.units (course_id, slug, title, sort_order)
  select id, 'dzial-1', 'Dział 1', 1 from k returning id
), d2 as (
  insert into public.units (course_id, slug, title, sort_order)
  select id, 'dzial-2', 'Dział 2', 2 from k returning id
), l as (
  insert into public.lessons (unit_id, slug, title, sort_order)
  select d1.id, x.slug, x.title, x.nr
    from d1, (values ('a', 'Lekcja A', 1), ('b', 'Lekcja B', 2), ('c', 'Lekcja C', 3)) as x(slug, title, nr)
  returning id, slug
), obca as (
  insert into public.lessons (unit_id, slug, title, sort_order)
  select id, 'obca', 'Lekcja z drugiego działu', 1 from d2 returning id
)
select (select id from d1) as unit1,
       (select id from l where slug = 'a') as lekcja_a,
       (select id from l where slug = 'b') as lekcja_b,
       (select id from l where slug = 'c') as lekcja_c,
       (select id from obca) as obca;

grant select on t_ids, t_ctx to authenticated;

-- --- uczeń ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'uczen')), true);

select throws_ok(
  format('select public.admin_reorder_lessons(%L, array[%L, %L, %L]::uuid[])',
         (select unit1 from t_ctx), (select lekcja_c from t_ctx),
         (select lekcja_b from t_ctx), (select lekcja_a from t_ctx)),
  '42501',
  null,
  'uczeń nie przestawi lekcji'
);

reset role;

-- --- administrator ---
select set_config('role', 'authenticated', true),
       set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_ids where name = 'admin')), true);

select throws_ok(
  format('select public.admin_reorder_lessons(%L, array[%L, %L]::uuid[])',
         (select unit1 from t_ctx), (select lekcja_c from t_ctx), (select lekcja_b from t_ctx)),
  '22023',
  null,
  'niepełna lista nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_lessons(%L, array[%L, %L, %L]::uuid[])',
         (select unit1 from t_ctx), (select lekcja_a from t_ctx),
         (select lekcja_b from t_ctx), (select obca from t_ctx)),
  '22023',
  null,
  'lekcja z innego działu nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_lessons(%L, array[%L, %L, %L]::uuid[])',
         (select unit1 from t_ctx), (select lekcja_a from t_ctx),
         (select lekcja_a from t_ctx), (select lekcja_b from t_ctx)),
  '22023',
  null,
  'ta sama lekcja dwa razy nie przechodzi'
);

select throws_ok(
  format('select public.admin_reorder_lessons(''00000000-0000-0000-0000-000000000007''::uuid, array[%L]::uuid[])',
         (select lekcja_a from t_ctx)),
  '22023',
  null,
  'dział bez lekcji albo nieistniejący nie przechodzi'
);

select is(
  (select public.admin_reorder_lessons(
            (select unit1 from t_ctx),
            array[(select lekcja_c from t_ctx), (select lekcja_a from t_ctx), (select lekcja_b from t_ctx)]::uuid[])),
  jsonb_build_object('lessons', 3),
  'administrator przestawia lekcje'
);

reset role;

select is(
  (select array_agg(l.slug order by l.sort_order) from public.lessons l
    where l.unit_id = (select unit1 from t_ctx)),
  array['c', 'a', 'b'],
  'lekcje stoją w nowej kolejności'
);

select is(
  (select l.sort_order from public.lessons l where l.id = (select obca from t_ctx)),
  1,
  'lekcja z drugiego działu zostaje nietknięta'
);

select * from finish();
rollback;
