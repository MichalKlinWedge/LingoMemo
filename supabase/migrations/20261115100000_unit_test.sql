-- Test na koniec działu, a zdany test otwiera następny dział.
--
-- Dział kończył się powtórką, czyli ćwiczeniem bez progu — dziecko przechodziło do kolejnego
-- działu niezależnie od tego, czy cokolwiek z poprzedniego zostało mu w głowie. Enum
-- `lesson_kind` miał wartość 'test' od pierwszej migracji, ale nic jej nie używało.
--
-- Od teraz każdy dział ze słówkami ma na końcu „Test działu":
--
--   * zadania bierze z całego działu, po jednym na słówko (powtórka bierze tylko te, które
--     dziecko już widziało — test ma sprawdzić dział, a nie stan powtórek),
--   * otwiera się, gdy wszystkie zwykłe lekcje działu są zaliczone,
--   * zdany (próg lekcji, domyślnie 80%) otwiera następny dział.
--
-- Dopóki test działu nie jest zdany, lekcje kolejnych działów są zamknięte — tak samo jak
-- lekcja za nieukończoną poprzedniczką. Dział bez testu (bo nie ma w nim ani jednego słówka)
-- niczego nie blokuje: brak testu nie może być warunkiem nie do spełnienia.
--
-- Test powstaje sam, wyzwalaczem przy pierwszym słówku w dziale — tak jak powtórka powstaje
-- przy imporcie. Gdyby trzeba go było zakładać ręcznie, dział bez testu byłby stanem
-- domyślnym, a wtedy reguła „zdany test otwiera dział" nie znaczyłaby nic.
--
-- Odrzucone: test jako osobny rodzaj treści do napisania ręcznie (po jednym na dział, czyli
-- kilkadziesiąt plików importu do utrzymania, a zadania i tak byłyby tymi z lekcji); próg
-- liczony z całego działu zamiast z testu (dziecko nie wie wtedy, co dokładnie zdaje);
-- blokowanie tylko następnego działu zamiast wszystkich dalszych (dałoby się przeskoczyć
-- dział, wchodząc od razu w trzeci).

-- 1. Ile zadań ma test. Tyle co etap zwykłej lekcji, żeby test był jednym podejściem,
-- a nie kilkoma etapami pod rząd.
create or replace function public.test_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 15 $fn$;

/**
 * Zadania do testu działu: po jednym na słówko działu, w losowej kolejności i z losowym
 * typem zadania. W odróżnieniu od powtórki nie zagląda do `srs_state` — test obejmuje też
 * słówka, których dziecko nigdy nie powtarzało.
 */
create or replace function public.pick_test_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with scope as (
    select l.review_scope_unit_id as unit_id
    from public.lessons l
    where l.id = p_lesson and l.kind = 'test'
  ),
  slowka as (
    select distinct li.concept_id
    from public.lesson_items li
    join public.lessons l on l.id = li.lesson_id
    where l.unit_id = (select unit_id from scope)
  ),
  wybrane as (
    select distinct on (s.concept_id) s.concept_id, ex.id as exercise_id
    from slowka s
    join public.exercises ex on ex.concept_id = s.concept_id and ex.is_active
    join public.lessons el on el.id = ex.lesson_id
    where el.unit_id = (select unit_id from scope)
    order by s.concept_id, random()
  )
  -- `p_user` nie wpływa na dobór, ale sygnatura jest ta sama co w powtórce: obie funkcje
  -- wołane są z tego samego miejsca w `get_lesson_exercises`.
  select w.exercise_id, w.concept_id, (row_number() over (order by random()))::integer
  from wybrane w
  where p_user is not null;
$fn$;

-- 2. Liczba zadań lekcji. Dochodzi gałąź testu — reszta przepisana z `…_lesson_levels.sql`.
create or replace function public.lesson_exercise_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select case
    when (select l.kind from public.lessons l where l.id = p_lesson) = 'review'
      then least((select count(*) from public.pick_review_exercises(p_lesson, p_user)), public.review_limit())
    when (select l.kind from public.lessons l where l.id = p_lesson) = 'test'
      then least((select count(*) from public.pick_test_exercises(p_lesson, p_user)), public.test_limit())
    else (select count(*) from public.lesson_exercises_at_level(p_lesson, 1::smallint))
  end::integer;
$fn$;

-- 3. Zadanie testu pochodzi z lekcji działu, nie z samego testu — jak w powtórce.
create or replace function public.exercise_allowed_in_lesson(p_exercise uuid, p_lesson uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when l.kind in ('review', 'test') then exists (
      select 1 from public.exercises ex
      join public.lessons el on el.id = ex.lesson_id
      where ex.id = p_exercise and el.unit_id = l.review_scope_unit_id
    )
    else exists (select 1 from public.exercises ex where ex.id = p_exercise and ex.lesson_id = p_lesson)
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

-- 4. Czy dział jest otwarty: wszystkie wcześniejsze działy kursu muszą mieć zdany test.
-- Dział bez testu nie blokuje niczego.
create or replace function public.is_unit_unlocked(p_unit uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when p_user = (select auth.uid()) and public.is_admin() then true
    else not exists (
      select 1
      from public.units wcze
      join public.lessons t on t.unit_id = wcze.id and t.kind = 'test'
      where wcze.course_id = u.course_id
        and wcze.sort_order < u.sort_order
        and not exists (
          select 1 from public.lesson_progress lp
          where lp.user_id = p_user and lp.lesson_id = t.id and lp.status = 'completed'
        )
    )
  end
  from public.units u
  where u.id = p_unit;
$fn$;

comment on function public.is_unit_unlocked(uuid, uuid) is
  'Czy dział jest dla tego ucznia otwarty: każdy wcześniejszy dział kursu ma zdany test działu.';

-- 5. Otwarcie lekcji. Dochodzi zamek działu i reguła testu — reszta przepisana
-- z `…_admin_preview.sql`.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when p_user = (select auth.uid()) and public.is_admin() then true
    -- Zamek działu stoi przed wszystkim innym: zamknięty dział zamyka też swoją powtórkę
    -- i swój test, inaczej dałoby się przeskoczyć dział testem.
    when not public.is_unit_unlocked(l.unit_id, p_user) then false
    -- Test sprawdza dział, więc czeka na komplet jego lekcji. Lekcje nieopublikowane się
    -- nie liczą — dziecko ich nie widzi, nie ma jak ich zaliczyć.
    when l.kind = 'test' then not exists (
      select 1 from public.lessons sl
      where sl.unit_id = l.unit_id and sl.kind = 'standard' and sl.is_published
        and not exists (
          select 1 from public.lesson_progress lp
          where lp.user_id = p_user and lp.lesson_id = sl.id and lp.status = 'completed'
        )
    )
    when l.kind = 'review' then exists (
      select 1
      from public.lesson_progress lp
      join public.lessons sl on sl.id = lp.lesson_id
      where lp.user_id = p_user
        and lp.status = 'completed'
        and sl.unit_id = l.review_scope_unit_id
    )
    when l.prerequisite_lesson_id is null then true
    else exists (
      select 1 from public.lesson_progress lp
      where lp.user_id = p_user
        and lp.lesson_id = l.prerequisite_lesson_id
        and lp.status = 'completed'
    )
  end
  from public.lessons l
  where l.id = p_lesson;
$fn$;

comment on function public.is_lesson_unlocked(uuid, uuid) is
  'Czy lekcja jest dla tego ucznia otwarta: otwarty dział, a w nim warunek wstępny lekcji '
  '(test działu czeka na komplet lekcji). Administrator pytający o siebie ma otwarte wszystko.';

-- 6. Wydawanie zadań. Test idzie tą samą drogą co powtórka — reszta przepisana
-- z `…_lesson_levels.sql`.
create or replace function public.get_lesson_exercises(
  p_lesson uuid,
  p_stage integer default 1,
  p_level smallint default 1
)
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
  v_level  smallint := coalesce(p_level, 1);
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if v_level < 1 or v_level > 3 then
    raise exception 'Poziom to 1, 2 albo 3' using errcode = '22023';
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

  -- Powtórka i test mają własny dobór zadań i własną trudność — poziomów się do nich
  -- nie stosuje.
  if v_kind in ('review', 'test') then
    v_level := 1;
  end if;

  if v_level > 1 and not public.is_level_unlocked(p_lesson, v_user, v_level) and not public.is_admin() then
    raise exception 'Najpierw przejdź tę lekcję na poziomie łatwym' using errcode = '42501';
  end if;

  -- Etapy ma tylko poziom łatwy: trudniejsze wejście to osiem zadań, czyli jeden kawałek.
  v_stages := case when v_level > 1 then 1 else public.lesson_stage_count(p_lesson, v_user) end;
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  return query
  with picked as (
    select ex.id, ex.type, ex.concept_id, ex.points, ex.payload,
           case
             when v_kind = 'review' then r.priority
             when v_kind = 'test' then t.priority
             when v_level > 1 then h.priority
             else ex.sort_order
           end as ord
    from public.exercises ex
    left join public.pick_review_exercises(p_lesson, v_user) r on r.exercise_id = ex.id
    left join public.pick_test_exercises(p_lesson, v_user) t on t.exercise_id = ex.id
    left join public.pick_level_exercises(p_lesson, v_level) h on h.exercise_id = ex.id
    where ex.is_active
      and case
            when v_kind = 'review' then r.exercise_id is not null
            when v_kind = 'test' then t.exercise_id is not null
            when v_level > 1 then h.exercise_id is not null
            else ex.lesson_id = p_lesson
                 and ex.id in (select v.exercise_id
                                 from public.lesson_exercises_at_level(p_lesson, 1::smallint) v)
          end
  ),
  chosen as (
    select p.*, row_number() over (order by p.ord, p.id) as nr
    from picked p
  ),
  visible as (
    select c.* from chosen c
    where c.nr <= case
                    when v_kind = 'review' then public.review_limit()
                    when v_kind = 'test' then public.test_limit()
                    else 1000000
                  end
  ),
  staged as (
    -- `count(*) over ()` liczy dopiero to, co naprawdę trafi do dziecka — przy powtórce
    -- i teście zestaw jest już przycięty do swojego limitu.
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
      -- Lista wyboru w losowej kolejności. `jsonb_agg(... order by random())` układa ją od nowa
      -- przy każdym wydaniu zadania, więc poprawna odpowiedź nie siedzi stale na pierwszym
      -- miejscu. Zadania bez `options` (pisane, ze słuchu) idą dalej bez zmian.
      else case
        when s.payload ? 'options' then
          (s.payload - 'accepted' - 'answer' - 'solution')
            || jsonb_build_object('options', (
                 select jsonb_agg(o order by random()) from jsonb_array_elements(s.payload -> 'options') o
               ))
        else s.payload - 'accepted' - 'answer' - 'solution'
      end
    end
  from staged s
  where s.stage = coalesce(p_stage, 1)
  order by s.nr;
end;
$fn$;

-- 7. Start sesji. Test, jak powtórka, losuje zestaw przy każdym wywołaniu, więc migawka
-- zadań zostaje pusta — reszta przepisana z `…_lesson_levels.sql`.
create or replace function public.start_lesson_session(
  p_lesson uuid,
  p_idempotency_key text,
  p_stage integer default 1,
  p_level smallint default 1
)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
  v_kind    public.lesson_kind;
  v_stages  integer;
  v_total   integer;
  v_ids     uuid[];
  v_level   smallint := coalesce(p_level, 1);
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if v_level < 1 or v_level > 3 then
    raise exception 'Poziom to 1, 2 albo 3' using errcode = '22023';
  end if;
  -- Podgląd administratora wchodzi też w lekcję przed publikacją. Punkty i postęp zapisują się
  -- na jego własnym koncie, więc nie dotykają niczyjej nauki.
  select l.kind into v_kind from public.lessons l
   where l.id = p_lesson and (l.is_published or public.is_admin());
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  if v_kind in ('review', 'test') then
    v_level := 1;
  end if;

  if v_level > 1 and not public.is_level_unlocked(p_lesson, v_user, v_level) and not public.is_admin() then
    raise exception 'Najpierw przejdź tę lekcję na poziomie łatwym' using errcode = '42501';
  end if;

  v_stages := case when v_level > 1 then 1 else public.lesson_stage_count(p_lesson, v_user) end;
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  -- Klucz idempotencji jest nadawany na etap: przeglądarka losuje nowy przy wejściu w kolejny.
  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  select coalesce(array_agg(x.id order by x.sort_order), '{}')
    into v_ids
    from public.get_lesson_exercises(p_lesson, coalesce(p_stage, 1), v_level) x;

  v_total := coalesce(array_length(v_ids, 1), 0);

  insert into public.lesson_sessions (
    user_id, lesson_id, idempotency_key, total_exercises, stage_nr, level, exercise_ids
  )
  values (
    v_user, p_lesson, p_idempotency_key, v_total, coalesce(p_stage, 1), v_level,
    case when v_kind in ('review', 'test') or v_level > 1 then '{}'::uuid[] else v_ids end
  )
  returning id into v_session;

  return v_session;
end;
$fn$;

-- 8. Test powstaje sam przy pierwszym słówku w dziale. Dział bez słówek nie dostaje testu,
-- bo nie miałby z czego ułożyć zadań — i słusznie niczego nie blokuje.
create or replace function public.add_unit_test()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_unit uuid;
begin
  select l.unit_id into v_unit from public.lessons l where l.id = new.lesson_id;
  if v_unit is null then
    return new;
  end if;

  insert into public.lessons (
    unit_id, slug, title, icon, kind, sort_order, review_scope_unit_id, xp_reward, is_published
  )
  select v_unit, 'test-dzialu', 'Test działu', '🏁', 'test', 100, v_unit, 60, true
   where not exists (
     select 1 from public.lessons t where t.unit_id = v_unit and t.kind = 'test'
   )
  on conflict do nothing;

  return new;
end;
$fn$;

drop trigger if exists lesson_items_unit_test on public.lesson_items;
create trigger lesson_items_unit_test
  after insert on public.lesson_items
  for each row execute function public.add_unit_test();

-- 9. Działy, które już mają słówka, dostają test od razu — bez tego reguła „zdany test
-- otwiera dział" nie dotyczyłaby ani jednego istniejącego kursu.
insert into public.lessons (
  unit_id, slug, title, icon, kind, sort_order, review_scope_unit_id, xp_reward, is_published
)
select u.id, 'test-dzialu', 'Test działu', '🏁', 'test', 100, u.id, 60, true
  from public.units u
 where exists (
         select 1 from public.lesson_items li
         join public.lessons l on l.id = li.lesson_id
         where l.unit_id = u.id
       )
   and not exists (select 1 from public.lessons t where t.unit_id = u.id and t.kind = 'test');

comment on column public.lessons.review_scope_unit_id is
  'Dział, którego dotyczy powtórka albo test działu. Dla zwykłej lekcji puste.';

revoke execute on function public.pick_test_exercises(uuid, uuid) from anon, public;
revoke execute on function public.is_unit_unlocked(uuid, uuid) from anon, public;
revoke execute on function public.add_unit_test() from anon, public;
grant execute on function public.test_limit() to authenticated;
grant execute on function public.pick_test_exercises(uuid, uuid) to authenticated;
grant execute on function public.is_unit_unlocked(uuid, uuid) to authenticated;
