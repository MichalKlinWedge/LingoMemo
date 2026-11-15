-- Rola rodzica.
--
-- Rodzic nie robi lekcji — ma wgląd w postępy swoich dzieci i nic poza tym. Dzieci przypisuje
-- administrator; rodzic nie dopisze sobie cudzego dziecka, bo tabela powiązań leży w
-- `app_private` i zapisują ją wyłącznie funkcje `security definer`.
--
-- Wzorzec dokładnie taki sam, jak przy administratorze (`20261115090100_admin.sql`): źródłem
-- prawdy jest tabela w `app_private`, a do JWT trafia claim, żeby „czy to rodzic" nie kosztowało
-- zapytania. Różnica jest jedna: lista dzieci do claimu NIE trafia. Zmienia się wtedy, gdy
-- administrator przypisze dziecko, a claim odświeża się dopiero przy nowym tokenie — rodzic
-- czekałby godzinę na dostęp do danych dziecka, które właśnie mu przypisano.

-- 1. Kto jest rodzicem.

create table if not exists app_private.parent_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now()
);

-- 2. Czyim rodzicem. Dziecko może mieć dwoje rodziców, rodzic kilkoro dzieci.

create table if not exists app_private.parent_children (
  parent_id uuid not null references auth.users(id) on delete cascade,
  child_id  uuid not null references auth.users(id) on delete cascade,
  added_by  uuid references auth.users(id),
  added_at  timestamptz not null default now(),
  primary key (parent_id, child_id),
  constraint parent_children_not_self check (parent_id <> child_id)
);

-- Wyszukiwanie „kto jest rodzicem tego dziecka" dla panelu; klucz główny obsługuje drugą stronę.
create index if not exists parent_children_child_idx on app_private.parent_children (child_id);

-- 3. Claim w JWT — jak `is_admin()`, zero wejść do bazy.

create or replace function public.is_parent()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'is_parent')::boolean, false);
$fn$;

comment on function public.is_parent() is
  'Czy bieżący użytkownik jest rodzicem — z claimu w JWT. Sam claim nie mówi, czyim rodzicem; '
  'listę dzieci wydaje my_child_ids().';

create or replace function app_private.sync_parent_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
         || jsonb_build_object('is_parent', exists (select 1 from app_private.parent_users p where p.user_id = v_user))
   where id = v_user;
  return null;
end;
$fn$;

drop trigger if exists trg_sync_parent_claim on app_private.parent_users;
create trigger trg_sync_parent_claim
after insert or delete on app_private.parent_users
for each row execute function app_private.sync_parent_claim();

-- 4. Dzieci bieżącego użytkownika.
--
-- Zbiór, a nie `exists` dla pojedynczego dziecka: `user_id in (select public.my_child_ids())`
-- jest podzapytaniem niezależnym od wiersza, więc Postgres liczy je raz na zapytanie jako
-- InitPlan. Funkcja `is_parent_of(user_id)` wykonywałaby się dla każdego wiersza z osobna.

create or replace function public.my_child_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select pc.child_id
    from app_private.parent_children pc
   where pc.parent_id = (select auth.uid());
$fn$;

-- Lista dzieci do wyświetlenia. Imiona i tak są w `profiles`, ale bez tej funkcji rodzic nie
-- miałby skąd wziąć identyfikatorów — tabela powiązań jest niewidoczna dla PostgREST.
create or replace function public.my_children()
returns table (user_id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.id, p.display_name
    from app_private.parent_children pc
    join public.profiles p on p.id = pc.child_id
   where pc.parent_id = (select auth.uid())
   order by p.display_name;
$fn$;

-- 5. Polityki odczytu: to samo, co dla administratora, tylko zawężone do własnych dzieci.
--
-- Dopisujemy warunek do istniejących polityk zamiast dokładać drugi zestaw: jedna polityka na
-- tabelę i widać w niej całą regułę, zamiast szukać po dwóch miejscach, kto to w końcu czyta.

alter policy profiles_read on public.profiles
  using (id = (select auth.uid()) or public.is_admin() or id in (select public.my_child_ids()));

alter policy enrollments_read on public.enrollments
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy lesson_progress_read on public.lesson_progress
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy lesson_sessions_read on public.lesson_sessions
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy attempts_read on public.attempts
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy srs_state_read on public.srs_state
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy points_ledger_read on public.points_ledger
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy user_badges_read on public.user_badges
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

alter policy user_stats_read on public.user_stats
  using (user_id = (select auth.uid()) or public.is_admin() or user_id in (select public.my_child_ids()));

-- Celowo BEZ `exercises`: tam leżą klucze odpowiedzi. Rodzic widzi, co dziecko wpisało i przy
-- którym słówku, ale poprawnej odpowiedzi z bazy nie dostaje — inaczej wystarczyłoby jedno konto
-- rodzica, żeby wyciągnąć odpowiedzi do wszystkich zadań w kursie.

-- 6. Zarządzanie rolą i powiązaniami — wyłącznie administrator.

create or replace function public.admin_set_parent(p_user uuid, p_is_parent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  if p_is_parent then
    insert into app_private.parent_users (user_id, granted_by)
    values (p_user, (select auth.uid()))
    on conflict (user_id) do nothing;
  else
    -- Powiązania znikają razem z rolą: rola odebrana, a dzieci zostawione, to cicha furtka,
    -- gdyby rolę nadać temu samemu kontu ponownie.
    delete from app_private.parent_children where parent_id = p_user;
    delete from app_private.parent_users where user_id = p_user;
  end if;
end;
$fn$;

create or replace function public.admin_set_child(p_parent uuid, p_child uuid, p_linked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  if p_parent = p_child then
    raise exception 'Nie da się przypisać konta do samego siebie' using errcode = '22023';
  end if;

  if not exists (select 1 from app_private.parent_users pu where pu.user_id = p_parent) then
    raise exception 'To konto nie jest rodzicem' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_child) then
    raise exception 'Nie ma takiego konta' using errcode = '22023';
  end if;

  if p_linked then
    insert into app_private.parent_children (parent_id, child_id, added_by)
    values (p_parent, p_child, (select auth.uid()))
    on conflict do nothing;
  else
    delete from app_private.parent_children where parent_id = p_parent and child_id = p_child;
  end if;
end;
$fn$;

-- Dla panelu: kto jest rodzicem i czyim. Jedna funkcja zamiast dwóch, bo rodzic bez dzieci też
-- musi być widoczny — inaczej nie dałoby się mu żadnego przypisać.
create or replace function public.admin_parents()
returns table (user_id uuid, children uuid[])
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();

  return query
    select pu.user_id,
           coalesce(
             (select array_agg(pc.child_id order by pc.added_at) from app_private.parent_children pc
               where pc.parent_id = pu.user_id),
             '{}'::uuid[]
           )
      from app_private.parent_users pu;
end;
$fn$;

-- 7. Zaproszenia z rolą rodzica.

alter table app_private.invitations drop constraint if exists invitations_role_check;
alter table app_private.invitations
  add constraint invitations_role_check check (role in ('student', 'admin', 'parent'));

create or replace function public.create_invite(
  p_role text default 'student',
  p_days integer default 14,
  p_max_uses integer default 1,
  p_course uuid default null,
  p_display_name text default null,
  p_email text default null
)
returns text
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text;
begin
  perform app_private.assert_admin();

  if p_role not in ('student', 'admin', 'parent') then
    raise exception 'Nieznana rola: %', p_role using errcode = '22023';
  end if;

  -- 32 bajty w base64url: bez znaków, które psują adres.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');

  insert into app_private.invitations (
    token_hash, token_prefix, role, email, display_name, course_id, created_by, expires_at, max_uses
  )
  values (
    app_private.token_digest(v_token), left(v_token, 8), p_role, p_email, p_display_name, p_course,
    (select auth.uid()), now() + make_interval(days => greatest(p_days, 1)), greatest(p_max_uses, 1)
  );

  return v_token;
end;
$fn$;

create or replace function public.apply_invitation()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_token text := new.raw_user_meta_data ->> 'invite';
  v_inv   app_private.invitations%rowtype;
begin
  if v_token is null or btrim(v_token) = '' then
    return new;
  end if;

  select * into v_inv from app_private.invitations i
   where i.token_hash = app_private.token_digest(v_token);
  if not found then
    return new;
  end if;

  update app_private.invitations
     set consumed_by = coalesce(consumed_by, new.id), consumed_at = coalesce(consumed_at, now())
   where id = v_inv.id;

  -- Rodzic nie uczy się, więc zapis na kurs byłby dla niego pustym wierszem i kafelkiem kursu
  -- na stronie, której nie ma po co otwierać.
  if v_inv.course_id is not null and v_inv.role <> 'parent' then
    insert into public.enrollments (user_id, course_id) values (new.id, v_inv.course_id)
    on conflict do nothing;
  end if;

  if v_inv.role = 'admin' then
    insert into app_private.admin_users (user_id, granted_by) values (new.id, v_inv.created_by)
    on conflict do nothing;
  end if;

  if v_inv.role = 'parent' then
    insert into app_private.parent_users (user_id, granted_by) values (new.id, v_inv.created_by)
    on conflict do nothing;
  end if;

  return new;
end;
$fn$;

-- 8. Nadania.

revoke execute on function public.my_child_ids() from anon, public;
revoke execute on function public.my_children() from anon, public;
revoke execute on function public.is_parent() from anon;
revoke execute on function public.admin_set_parent(uuid, boolean) from anon, public;
revoke execute on function public.admin_set_child(uuid, uuid, boolean) from anon, public;
revoke execute on function public.admin_parents() from anon, public;

grant execute on function public.my_child_ids() to authenticated;
grant execute on function public.my_children() to authenticated;
grant execute on function public.is_parent() to authenticated;
grant execute on function public.admin_set_parent(uuid, boolean) to authenticated;
grant execute on function public.admin_set_child(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_parents() to authenticated;
