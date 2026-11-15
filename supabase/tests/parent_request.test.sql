-- Prośba rodzica o przypisanie dziecka: kto ją zostawia i kiedy znika.
--
-- Funkcję woła strona rodzica przy każdym wejściu, więc test sprawdza przede wszystkim to, czy
-- nie zostawia śladu tam, gdzie nie powinna: na koncie ucznia i na koncie rodzica, który dzieci
-- już ma. Prośba od konta bez roli byłaby w panelu wpisem, którego nie da się załatwić.

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
    p_email, extensions.crypt('haslo-testowe', extensions.gen_salt('bf', 10)),
    now(), '{}'::jsonb, jsonb_build_object('display_name', split_part(p_email, '@', 1)), now(), now()
  );
  return v_id;
end;
$$;

create or replace function pg_temp.login(p_id uuid) returns void
language plpgsql as $$
declare
  v_claims text;
begin
  perform set_config('role', 'postgres', true);
  select json_build_object('sub', u.id, 'role', 'authenticated',
         'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
    into v_claims
    from auth.users u where u.id = p_id;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create temporary table t_ids (name text primary key, id uuid);
insert into t_ids values ('rodzic', pg_temp.make_user('rodzic-req@test.local'));
insert into t_ids values ('uczen', pg_temp.make_user('uczen-req@test.local'));
insert into t_ids values ('dziecko', pg_temp.make_user('dziecko-req@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-req@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
insert into app_private.parent_users (user_id) values ((select id from t_ids where name = 'rodzic'));
grant select on t_ids to authenticated;

-- --- rodzic bez dziecka ---

select pg_temp.login((select id from t_ids where name = 'rodzic'));
select public.request_child_access();

reset role;
select is(
  (select count(*)::integer from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'rodzic')),
  1,
  'rodzic bez dziecka zostawia prośbę'
);

-- Drugie wejście nie dokłada wiersza, tylko odświeża datę ostatniej próby.
select pg_temp.login((select id from t_ids where name = 'rodzic'));
select public.request_child_access();

reset role;
-- Po `parent_id`, nie po całej tabeli: baza deweloperska miewa prawdziwe prośby z klikania
-- w aplikacji, a wtedy test padał na „have: 2, want: 1" — na czymś, czego nie sprawdza.
select is(
  (select count(*)::integer from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'rodzic')),
  1,
  'kolejne wejście nie dubluje prośby'
);

select isnt(
  (select last_at from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'rodzic')),
  null,
  'data ostatniej próby jest zapisana'
);

-- --- uczeń ---

select pg_temp.login((select id from t_ids where name = 'uczen'));
select public.request_child_access();

reset role;
select is(
  (select count(*)::integer from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'uczen')),
  0,
  'konto bez roli rodzica nie zostawia prośby'
);

-- --- administrator widzi prośbę na liście ---

select pg_temp.login((select id from t_ids where name = 'admin'));

select isnt(
  (select requested_at from public.admin_parents()
    where user_id = (select id from t_ids where name = 'rodzic')),
  null,
  'panel pokazuje datę prośby przy rodzicu'
);

-- --- przypisanie dziecka załatwia prośbę ---

select public.admin_set_child(
  (select id from t_ids where name = 'rodzic'),
  (select id from t_ids where name = 'dziecko'),
  true
);

select is(
  (select requested_at from public.admin_parents()
    where user_id = (select id from t_ids where name = 'rodzic')),
  null,
  'przypisanie dziecka kasuje prośbę'
);

-- --- rodzic z dzieckiem już nie prosi ---

select pg_temp.login((select id from t_ids where name = 'rodzic'));
select public.request_child_access();

reset role;
select is(
  (select count(*)::integer from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'rodzic')),
  0,
  'rodzic z przypisanym dzieckiem nie zostawia prośby'
);

-- Po odpięciu dziecka prośba wraca przy następnym wejściu — rodzic znowu nic nie widzi.
delete from app_private.parent_children
 where parent_id = (select id from t_ids where name = 'rodzic');

select pg_temp.login((select id from t_ids where name = 'rodzic'));
select public.request_child_access();

reset role;
select is(
  (select count(*)::integer from app_private.parent_requests
    where parent_id = (select id from t_ids where name = 'rodzic')),
  1,
  'po odpięciu wszystkich dzieci prośba zgłasza się ponownie'
);

select * from finish();
rollback;
