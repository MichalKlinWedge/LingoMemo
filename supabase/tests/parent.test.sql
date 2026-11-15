-- Rola rodzica: kto widzi dane którego dziecka.
--
-- Sedno roli to jedno zdanie: rodzic widzi swoje dzieci i nikogo więcej. Test sprawdza obie
-- strony tego zdania — że widzi przypisane dziecko i że NIE widzi cudzego — bo polityka
-- przepuszczająca wszystkich wyglądałaby w aplikacji identycznie jak poprawna.

begin;
select plan(17);

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

/**
 * Wejście w skórę użytkownika: rola `authenticated` i claimy z `auth.users`.
 *
 * Najpierw powrót do roli bazy — claimy czyta się z `auth.users`, a rola `authenticated`
 * tej tabeli nie widzi, więc drugie i każde kolejne logowanie padałoby na „permission denied".
 */
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
insert into t_ids values ('dziecko', pg_temp.make_user('dziecko-par@test.local'));
insert into t_ids values ('obce', pg_temp.make_user('obce-par@test.local'));
insert into t_ids values ('rodzic', pg_temp.make_user('rodzic-par@test.local'));
insert into t_ids values ('nikt', pg_temp.make_user('nikt-par@test.local'));
insert into t_ids values ('admin', pg_temp.make_user('admin-par@test.local'));
insert into app_private.admin_users (user_id) values ((select id from t_ids where name = 'admin'));
grant select on t_ids to authenticated;

-- Postępy obojga dzieci. Punkty wystarczą: polityki wszystkich tabel postępu mają identyczny
-- warunek, więc jedna sprawdzona pokazuje, czy mechanizm działa.
insert into public.points_ledger (user_id, delta, reason)
values ((select id from t_ids where name = 'dziecko'), 30, 'lesson_completed'),
       ((select id from t_ids where name = 'obce'), 70, 'lesson_completed');
insert into public.user_stats (user_id, lessons_done)
values ((select id from t_ids where name = 'dziecko'), 3),
       ((select id from t_ids where name = 'obce'), 9);

-- --- administrator nadaje rolę i przypisuje dziecko ---

select pg_temp.login((select id from t_ids where name = 'admin'));

select lives_ok(
  format('select public.admin_set_parent(%L, true)', (select id from t_ids where name = 'rodzic')),
  'administrator nadaje rolę rodzica'
);

select lives_ok(
  format('select public.admin_set_child(%L, %L, true)',
         (select id from t_ids where name = 'rodzic'), (select id from t_ids where name = 'dziecko')),
  'administrator przypisuje dziecko do rodzica'
);

select throws_ok(
  format('select public.admin_set_child(%L, %L, true)',
         (select id from t_ids where name = 'nikt'), (select id from t_ids where name = 'dziecko')),
  '22023',
  null,
  'nie da się przypisać dziecka do konta, które nie jest rodzicem'
);

select throws_ok(
  format('select public.admin_set_child(%L, %L, true)',
         (select id from t_ids where name = 'rodzic'), (select id from t_ids where name = 'rodzic')),
  '22023',
  null,
  'nie da się przypisać konta do samego siebie'
);

-- Claim trafia do `auth.users` od razu, inaczej rodzic czekałby na odświeżenie tokenu.
reset role;
select is(
  (select (raw_app_meta_data ->> 'is_parent')::boolean from auth.users
    where id = (select id from t_ids where name = 'rodzic')),
  true,
  'nadanie roli przepisuje claim w JWT'
);

-- --- rodzic ---

select pg_temp.login((select id from t_ids where name = 'rodzic'));

select is(public.is_parent(), true, 'rodzic rozpoznany po claimie');
select is(public.is_admin(), false, 'rodzic nie jest administratorem');

select is(
  (select count(*)::integer from public.my_children()),
  1,
  'rodzic widzi dokładnie jedno swoje dziecko'
);

select is(
  (select count(*)::integer from public.profiles where id = (select id from t_ids where name = 'dziecko')),
  1,
  'rodzic czyta profil swojego dziecka'
);

select is(
  (select count(*)::integer from public.profiles where id = (select id from t_ids where name = 'obce')),
  0,
  'rodzic NIE czyta profilu cudzego dziecka'
);

select is(
  (select coalesce(sum(delta), 0)::integer from public.points_ledger),
  30,
  'rodzic widzi punkty swojego dziecka i tylko jego'
);

select is(
  (select count(*)::integer from public.user_stats
    where user_id = (select id from t_ids where name = 'obce')),
  0,
  'rodzic NIE widzi statystyk cudzego dziecka'
);

-- Tabele postępu nie mają polityki INSERT dla nikogo — rodzic też nie dopisze dziecku punktów.
select throws_ok(
  format('insert into public.points_ledger (user_id, delta, reason) values (%L, 999, ''lesson_completed'')',
         (select id from t_ids where name = 'dziecko')),
  '42501',
  null,
  'rodzic nie dopisze dziecku punktów'
);

select throws_ok(
  format('select public.admin_set_child(%L, %L, true)',
         (select id from t_ids where name = 'rodzic'), (select id from t_ids where name = 'obce')),
  '42501',
  null,
  'rodzic nie przypisze sobie kolejnego dziecka'
);

-- --- konto bez żadnej roli ---

select pg_temp.login((select id from t_ids where name = 'nikt'));

select is(
  (select count(*)::integer from public.my_children()),
  0,
  'konto bez dzieci dostaje pustą listę'
);

select is(
  (select count(*)::integer from public.profiles where id = (select id from t_ids where name = 'dziecko')),
  0,
  'obce konto nie czyta cudzego profilu'
);

-- --- odebranie roli zabiera też powiązania ---

select pg_temp.login((select id from t_ids where name = 'admin'));
select public.admin_set_parent((select id from t_ids where name = 'rodzic'), false);

reset role;
select is(
  (select count(*)::integer from app_private.parent_children
    where parent_id = (select id from t_ids where name = 'rodzic')),
  0,
  'odebranie roli kasuje przypisane dzieci'
);

select * from finish();
rollback;
