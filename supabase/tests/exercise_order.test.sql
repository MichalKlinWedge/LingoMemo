-- Kolejność zadań w lekcji: pomieszana, ale stała.
--
-- Pliki treści są pisane typami, więc `sort_order` idzie blokami: najpierw wszystkie
-- tłumaczenia w jedną stronę, potem w drugą. Lekcja ma wydawać zadania w innej kolejności —
-- i w TEJ SAMEJ przy każdym wywołaniu, bo `start_lesson_session` zapisuje migawkę etapu
-- osobnym wywołaniem niż to, z którego renderuje się ekran dziecka.

begin;
select plan(4);

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

create temporary table t_user as select pg_temp.make_user('zosia-kolejnosc@test.local') as id;
create temporary table t_lesson (id uuid);

-- Dwadzieścia zadań w dwóch blokach po dziesięć, dokładnie tak jak w plikach treści.
-- Dział na początku kursu (`sort_order` 0), bo dalsze czekają na test działu wcześniejszego.
do $setup$
declare
  v_course uuid;
  v_unit   uuid;
  v_lesson uuid;
  i        integer;
begin
  select c.id into v_course from public.courses c where c.slug = 'pl-en-starter';

  insert into public.units (course_id, slug, title, sort_order, is_published)
  values (v_course, 'kolejnosc-test', 'Kolejność', 0, true)
  returning id into v_unit;

  insert into public.lessons (unit_id, slug, title, kind, sort_order, is_published, xp_reward, pass_threshold)
  values (v_unit, 'blokami', 'Lekcja pisana blokami', 'standard', 1, true, 50, 0.8)
  returning id into v_lesson;

  insert into t_lesson values (v_lesson);

  for i in 1..20 loop
    insert into public.exercises (lesson_id, type, sort_order, payload, points)
    values (
      v_lesson,
      case when i <= 10 then 'translate_ab' else 'translate_ba' end::public.exercise_type,
      i,
      jsonb_build_object('prompt', 'slowo' || i, 'accepted', jsonb_build_array('word' || i)), 10
    );
  end loop;
end;
$setup$;

-- Cała lekcja na poziomie łatwym: ten plik sprawdza kolejność, nie dobór trudności.
update public.exercises set level = 1 where lesson_id = (select id from t_lesson);

-- Kolejność z pliku treści zbieramy JESZCZE jako postgres: dziecko nie ma polityki SELECT
-- na `exercises` i samo tej tabeli nie przeczyta.
create temporary table t_plik as
  select ex.id, ex.sort_order
    from public.exercises ex
   where ex.lesson_id = (select id from t_lesson);

grant select on t_user, t_lesson, t_plik to authenticated;

-- Tożsamość dziecka ustawiamy już tu, rolę dopiero niżej: `auth.uid()` czyta claim, nie rolę.
select set_config('request.jwt.claims',
         (select json_build_object('sub', u.id, 'role', 'authenticated',
                 'app_metadata', coalesce(u.raw_app_meta_data, '{}'::jsonb))::text
            from auth.users u where u.id = (select id from t_user)), true);

-- Dwadzieścia zadań to dwa etapy (po piętnaście na etap), a `get_lesson_exercises` wydaje
-- po jednym etapie naraz — stąd `lateral`. `sort_order` w wyniku to numer w kolejności
-- wydawania, nie ten z pliku.
create or replace function pg_temp.wydane()
returns table (nr integer, id uuid, typ text, etap integer)
language sql stable as $$
  select row_number() over (order by g.etap, x.sort_order)::integer, x.id, x.type::text, g.etap
    from generate_series(1, 2) as g(etap),
         lateral public.get_lesson_exercises((select id from t_lesson), g.etap) x;
$$;

-- Pierwsze wydanie lekcji, zapisane osobnym poleceniem — do porównania niżej.
create temporary table t_pierwsze as select w.nr, w.id from pg_temp.wydane() w;
grant select on t_pierwsze to authenticated;

select set_config('role', 'authenticated', true);

select isnt(
  (select array_agg(w.id order by w.nr) from pg_temp.wydane() w),
  (select array_agg(p.id order by p.sort_order) from t_plik p),
  'kolejność wydawania nie jest kolejnością z pliku treści'
);

select ok(
  (select count(*)::integer
     from (select w.typ, lag(w.typ) over (order by w.nr) as poprzedni from pg_temp.wydane() w) z
    where z.poprzedni is not null and z.poprzedni <> z.typ) > 1,
  'typy zadań przeplatają się — przy układzie blokami zmiana typu byłaby dokładnie jedna'
);

-- Najważniejsza asercja tego pliku: bez tego migawka sesji i ekran dziecka miałyby inne listy.
-- Porównanie musi być z listą zapisaną WCZEŚNIEJ, osobnym poleceniem (`t_pierwsze` wyżej):
-- `get_lesson_exercises` jest `stable`, więc dwa wywołania w jednym zapytaniu nic by nie
-- dowiodły — baza może je policzyć raz.
select is(
  (select array_agg(w.id order by w.nr) from pg_temp.wydane() w),
  (select array_agg(p.id order by p.nr) from t_pierwsze p),
  'ta sama lekcja układa się przy każdym wywołaniu identycznie'
);

select is(
  (select count(*)::integer from pg_temp.wydane() w
    where public.exercise_stage(w.id, (select id from t_lesson)) is distinct from w.etap),
  0,
  'etap liczony osobno zgadza się z etapem, w którym zadanie wyszło'
);

reset role;

select * from finish();
rollback;
