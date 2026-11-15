-- Poziom trudności: ile dziecko klika, a ile wpisuje.
--
-- Lekcje były za trudne, bo każde słówko dostaje komplet zadań, a wśród nich wpisywanie całych
-- zdań — ośmiolatek, który dopiero poznał słowo, nie ma szans go napisać. Trudność rozdzielamy
-- więc na dwie niezależne rzeczy:
--
--   1. SUFIT dziecka  — `profiles.level` (1–3), ustawia rodzic. Wyżej niż to nie pójdzie nic.
--   2. RAMPA słówka   — stabilność z FSRS. Nowe słowo zaczyna od klikania nawet u dziecka
--                       z poziomem 3; wpisywanie włącza się, gdy słówko jest już rozpoznawane.
--
-- Dopuszczalny poziom zadania to minimum z tych dwóch. Dzięki rampie trudność rośnie słówko po
-- słówku, a nie skokiem na całym koncie.
--
-- Poziom jest kolumną ZADANIA, nie mapą „typ → trudność": `translate_ab` z `options` w payloadzie
-- to klikanie w kafelki, a bez nich wpisywanie z klawiatury. Ten sam typ bywa więc i łatwy,
-- i trudny — o trudności decyduje treść, nie nazwa typu.
--
-- Odrzucone: poziom osobno dla każdego kursu (kolumna w `enrollments`) — przy jednym kursie na
-- dziecko nie widać różnicy, a każde zapytanie robi się o złączenie dłuższe; poziom ustawiany
-- przez dziecko w swoim profilu — dziecko wybrałoby najłatwiejszy i tyle; filtrowanie zadań
-- w przeglądarce — dobór zadań i klucze odpowiedzi nie opuszczają bazy.

-- 1. Sufit dziecka. Kolumny NIE ma w `grant update (...)` z `20261115090700_rls.sql`, więc
-- uczeń jej nie zapisze, choć widzi swój profil. Zmienia ją wyłącznie `set_learner_level`.
alter table public.profiles
  add column if not exists level smallint not null default 1 check (level between 1 and 3);

comment on column public.profiles.level is
  'Sufit trudności zadań: 1 klikanie, 2 pojedyncze słowa, 3 zdania. Ustawia rodzic.';

-- 2. Poziom zadania. Bez `not null` i bez wartości domyślnej, choć pusty być nie może —
-- wypełnia go wyzwalacz niżej, a pilnuje więz `exercises_level_valid`. Powód jest praktyczny:
-- `not null` bez `default` sprawia, że generator typów (`npm run gen`) robi z kolumny pole
-- WYMAGANE w każdym `insert()` w aplikacji, a `default` z kolei ubiegłby wyzwalacz i wszystkie
-- zadania miałyby poziom 1.
alter table public.exercises
  add column if not exists level smallint;

/**
 * Domyślny poziom zadania z jego typu i treści. Granica przebiega tam, gdzie zmienia się to,
 * co dziecko robi rękami: klika, układa kafelki, pisze.
 */
create or replace function public.default_exercise_level(t public.exercise_type, p jsonb)
returns smallint
language sql immutable set search_path = ''
as $fn$
  select case
    -- 1: dziecko tylko wskazuje gotową odpowiedź.
    when t in ('image_choice', 'listen_match', 'match_pairs', 'fill_blank_choice') then 1
    when t in ('translate_ab', 'translate_ba')
         and jsonb_typeof(p -> 'options') = 'array'
         and jsonb_array_length(p -> 'options') >= 2 then 1
    -- 2: układanie z kafelków i wpisywanie jednego słowa.
    when t = 'sentence_order' then 2
    when t in ('translate_ab', 'translate_ba')
         and (select coalesce(max(position(' ' in a)), 0)
                from jsonb_array_elements_text(coalesce(p -> 'accepted', '[]'::jsonb)) a) = 0 then 2
    -- 3: wpisywanie zdań, pisanie ze słuchu, odmiana.
    else 3
  end::smallint;
$fn$;

update public.exercises
   set level = public.default_exercise_level(type, payload)
 where level is null;

alter table public.exercises
  add constraint exercises_level_valid check (level is not null and level between 1 and 3);

/**
 * Poziom nadaje wyzwalacz, a nie wartość domyślna kolumny: `default` nie widzi reszty wiersza,
 * a poziom wynika z typu i payloadu. Import, który poda `level` wprost, zachowuje swój —
 * administrator poprawiający pojedyncze zadanie wie lepiej niż reguła.
 */
create or replace function public.set_exercise_level()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.level is null then
    new.level := public.default_exercise_level(new.type, new.payload);
  end if;
  return new;
end;
$fn$;

drop trigger if exists exercises_level on public.exercises;
create trigger exercises_level
  before insert on public.exercises
  for each row execute function public.set_exercise_level();

-- 3. Rampa z FSRS. Progi w dniach stabilności: 7 dni to słówko rozpoznawane, 21 dni to słówko
-- umiane. Funkcje, nie stałe w kodzie — wartości muszą dać się zmienić w jednym miejscu.
create or replace function public.ramp_recognized() returns double precision
  language sql immutable set search_path = '' as $fn$ select 7.0 $fn$;

create or replace function public.ramp_known() returns double precision
  language sql immutable set search_path = '' as $fn$ select 21.0 $fn$;

create or replace function public.concept_ramp_level(p_stability double precision)
returns smallint
language sql immutable set search_path = ''
as $fn$
  select case
    when coalesce(p_stability, 0) >= public.ramp_known() then 3
    when coalesce(p_stability, 0) >= public.ramp_recognized() then 2
    else 1
  end::smallint;
$fn$;

/** Najtrudniejsze zadanie, jakie wolno pokazać temu dziecku przy tym słówku. */
create or replace function public.allowed_exercise_level(p_user uuid, p_concept uuid)
returns smallint
language sql stable security definer set search_path = ''
as $fn$
  select least(
    coalesce((select p.level from public.profiles p where p.id = p_user), 1),
    case
      -- Zadanie bez słówka (np. rozgrzewka): nie ma czego mierzyć rampą, zostaje sam sufit.
      when p_concept is null then 3
      else coalesce((select public.concept_ramp_level(s.stability)
                       from public.srs_state s
                      where s.user_id = p_user and s.concept_id = p_concept), 1)
    end
  )::smallint;
$fn$;

/**
 * Zadania lekcji widoczne dla tego dziecka. Zasada ratunkowa: jeśli dla słówka nic nie zmieściło
 * się w poziomie, wchodzi jego najłatwiejsze zadanie. Bez tego słówko wypadłoby z lekcji, FSRS
 * nigdy by go nie zobaczył i nigdy nie dojrzałoby do trudniejszych zadań.
 */
create or replace function public.visible_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid)
language sql stable security definer set search_path = ''
as $fn$
  with all_ex as (
    select ex.id,
           -- Zadanie bez słówka jest grupą samo dla siebie: `distinct on` po samym `concept_id`
           -- sklejałby wszystkie NULL-e w jedną grupę.
           coalesce(ex.concept_id::text, ex.id::text) as grp,
           ex.level,
           public.allowed_exercise_level(p_user, ex.concept_id) as cap
      from public.exercises ex
     where ex.lesson_id = p_lesson and ex.is_active
  ),
  fits as (select * from all_ex where level <= cap),
  rescue as (
    select distinct on (a.grp) a.id
      from all_ex a
     where not exists (select 1 from fits f where f.grp = a.grp)
     order by a.grp, a.level, a.id
  )
  select id from fits
  union
  select id from rescue;
$fn$;

-- 4. Liczba zadań lekcji liczy to, co dziecko naprawdę dostanie. Przepisana w całości
-- z `20261115091100_review.sql` — zmienia się ostatnia gałąź `case`.
create or replace function public.lesson_exercise_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select case
    when (select l.kind from public.lessons l where l.id = p_lesson) = 'review'
      then least((select count(*) from public.pick_review_exercises(p_lesson, p_user)), public.review_limit())
    else (select count(*) from public.visible_exercises(p_lesson, p_user))
  end::integer;
$fn$;

-- 5. Etap zadania. Numeracja MUSI iść po tym samym zbiorze co `get_lesson_exercises`, czyli po
-- zadaniach widocznych dla TEGO dziecka. Podpis zostaje dwuargumentowy, a użytkownika bierzemy
-- z `auth.uid()`: `security definer` nie zmienia tego, kto wywołał zapytanie, więc
-- `submit_attempt` i `skip_exercise` zostają nietknięte.
create or replace function public.exercise_stage(p_exercise uuid, p_lesson uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  with numbered as (
    select ex.id,
           row_number() over (order by ex.sort_order, ex.id) as nr,
           count(*) over ()                                  as total
      from public.exercises ex
     where ex.lesson_id = p_lesson
       and ex.is_active
       and ex.id in (select v.exercise_id
                       from public.visible_exercises(p_lesson, (select auth.uid())) v)
  )
  select (((n.nr - 1) * greatest(ceil(n.total::numeric / public.stage_size())::integer, 1)) / n.total + 1)::integer
    from numbered n
   where n.id = p_exercise;
$fn$;

-- 6. Powtórka. Dla każdego słówka losowe zadanie z dozwolonych, a gdy żadne się nie mieści —
-- najłatwiejsze, jakie jest. Przepisana w całości z `20261115091100_review.sql`.
create or replace function public.pick_review_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with scope as (
    select l.review_scope_unit_id as unit_id
    from public.lessons l
    where l.id = p_lesson and l.kind = 'review'
  ),
  due as (
    select s.concept_id,
           case when s.due_on <= current_date then 0 else 1 end as priority,
           s.due_on,
           s.lapses,
           public.allowed_exercise_level(p_user, s.concept_id) as cap
    from public.srs_state s
    where s.user_id = p_user
      and s.concept_id in (
        select li.concept_id
        from public.lesson_items li
        join public.lessons l on l.id = li.lesson_id
        where l.unit_id = (select unit_id from scope)
      )
  )
  select distinct on (d.concept_id) ex.id, d.concept_id, d.priority
  from due d
  join public.exercises ex on ex.concept_id = d.concept_id and ex.is_active
  join public.lessons el on el.id = ex.lesson_id
  where el.unit_id = (select unit_id from scope)
  order by d.concept_id,
           (ex.level > d.cap),
           case when ex.level > d.cap then ex.level end nulls first,
           random();
$fn$;

-- 7. Rodzic ustawia poziom dziecka. Zapis wyłącznie tędy: kolumna nie jest w `grant update`.
create or replace function public.set_learner_level(p_user uuid, p_level smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  if p_level is null or p_level < 1 or p_level > 3 then
    raise exception 'Poziom musi być liczbą od 1 do 3' using errcode = '22023';
  end if;
  update public.profiles set level = p_level, updated_at = now() where id = p_user;
  if not found then
    raise exception 'Nie ma takiego ucznia' using errcode = '22023';
  end if;
end;
$fn$;

revoke execute on function public.set_learner_level(uuid, smallint) from anon, public;
grant execute on function public.set_learner_level(uuid, smallint) to authenticated;

revoke execute on function public.default_exercise_level(public.exercise_type, jsonb) from anon, public;
revoke execute on function public.concept_ramp_level(double precision) from anon, public;
revoke execute on function public.ramp_recognized() from anon, public;
revoke execute on function public.ramp_known() from anon, public;
revoke execute on function public.allowed_exercise_level(uuid, uuid) from anon, public;
revoke execute on function public.visible_exercises(uuid, uuid) from anon, public;
grant execute on function public.allowed_exercise_level(uuid, uuid) to authenticated;
grant execute on function public.visible_exercises(uuid, uuid) to authenticated;

-- 8. Lista uczniów pokazuje poziom. Zmiana typu zwracanego wymaga `drop` — `create or replace`
-- nie potrafi dołożyć kolumny do `returns table`.
drop function if exists public.list_students();

create or replace function public.list_students()
returns table (
  user_id uuid, display_name text, email text, is_admin boolean,
  created_at timestamptz, lessons_done integer, total_points integer,
  streak_days integer, words_seen integer, last_active_on date, level smallint
)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform app_private.assert_admin();
  return query
    select
      p.id, p.display_name, u.email::text,
      exists (select 1 from app_private.admin_users a where a.user_id = p.id),
      p.created_at,
      coalesce(us.lessons_done, 0),
      coalesce((select sum(pl.delta)::integer from public.points_ledger pl where pl.user_id = p.id), 0),
      coalesce(us.streak_days, 0),
      (select count(*)::integer from public.srs_state s where s.user_id = p.id),
      us.last_active_on,
      p.level
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_stats us on us.user_id = p.id
    order by p.created_at;
end;
$fn$;

revoke execute on function public.list_students() from anon, public;
grant execute on function public.list_students() to authenticated;

-- 9. Wydawanie zadań. Funkcja przepisana w całości z `20261115093300_admin_preview_unpublished.sql`
-- (`create or replace` nie zna zmian cząstkowych). Względem tamtej wersji różni się JEDNYM
-- warunkiem w `picked`: zadanie musi być widoczne dla tego dziecka na jego poziomie. Przy
-- kolejnej zmianie tej funkcji porównaj ją z tą migracją, bo to ta nowsza wygrywa.

create or replace function public.get_lesson_exercises(p_lesson uuid, p_stage integer default 1)
returns table (
  id         uuid,
  type       public.exercise_type,
  sort_order integer,
  concept_id uuid,
  points     integer,
  payload    jsonb
)
language plpgsql stable security definer set search_path = ''
as $fn$
declare
  v_user   uuid := (select auth.uid());
  v_kind   public.lesson_kind;
  v_stages integer;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  -- Administrator widzi też lekcję przed publikacją — to jego podgląd roboczy.
  select l.kind into v_kind
    from public.lessons l
   where l.id = p_lesson and (l.is_published or public.is_admin());
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  v_stages := public.lesson_stage_count(p_lesson, v_user);
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  return query
  with picked as (
    select ex.id, ex.type, ex.concept_id, ex.points, ex.payload,
           case when v_kind = 'review' then r.priority else ex.sort_order end as ord
    from public.exercises ex
    left join public.pick_review_exercises(p_lesson, v_user) r on r.exercise_id = ex.id
    where ex.is_active
      and case when v_kind = 'review' then r.exercise_id is not null else ex.lesson_id = p_lesson end
      -- Poziom: powtórka jest już przefiltrowana w `pick_review_exercises`, zwykła lekcja
      -- filtruje się tutaj.
      and (v_kind = 'review'
           or ex.id in (select v.exercise_id from public.visible_exercises(p_lesson, v_user) v))
  ),
  chosen as (
    select p.*, row_number() over (order by p.ord, p.id) as nr
    from picked p
  ),
  visible as (
    select c.* from chosen c
    where c.nr <= case when v_kind = 'review' then public.review_limit() else 1000000 end
  ),
  staged as (
    -- `count(*) over ()` liczy dopiero to, co naprawdę trafi do dziecka — przy powtórce
    -- zestaw jest już przycięty do `review_limit()`.
    select v.*, (((v.nr - 1) * v_stages) / count(*) over () + 1)::integer as stage
    from visible v
  )
  select
    s.id, s.type, s.nr::integer, s.concept_id, s.points,
    case s.type
      when 'match_pairs' then jsonb_build_object(
        'instruction', s.payload -> 'instruction',
        'pairsLeft',  (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p),
        'pairsRight', (select jsonb_agg(p ->> 'b' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p)
      )
      when 'listen_match' then jsonb_build_object(
        'instruction', s.payload -> 'instruction',
        'lang', s.payload -> 'lang',
        'audio', (
          select jsonb_agg(jsonb_build_object('text', p ->> 'b', 'audioPath', p -> 'audioPath') order by random())
            from jsonb_array_elements(s.payload -> 'pairs') p
        ),
        'words', (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(s.payload -> 'pairs') p)
      )
      when 'sentence_order' then jsonb_build_object(
        'prompt', s.payload -> 'prompt',
        'tokens', (select jsonb_agg(t order by random()) from jsonb_array_elements(s.payload -> 'tokens') t)
      )
      else s.payload - 'accepted' - 'answer' - 'solution'
    end
  from staged s
  where s.stage = coalesce(p_stage, 1)
  order by s.nr;
end;
$fn$;
