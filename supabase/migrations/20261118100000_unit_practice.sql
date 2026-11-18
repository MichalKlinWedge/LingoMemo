-- Powtórka działu: dobrowolna lekcja na końcu działu, do zrobienia ile razy się chce.
--
-- Dział kończył się jednym kafelkiem: „Test działu". Test jest bramką — otwiera następny dział,
-- ma próg i robi się go raz, bo po zdaniu nie ma po co wracać. Nie było więc niczego, czym
-- dziecko mogłoby po prostu poćwiczyć dział jeszcze raz, bez stawki.
--
-- Od tej migracji każdy dział ze słówkami dostaje drugi kafelek końcowy, „Powtórkę działu":
--
--   * piętnaście zadań losowanych z CAŁEGO działu, po jednym na słówko, losowy typ zadania,
--   * otwiera się tak samo jak test działu — gdy wszystkie lekcje działu są zaliczone,
--   * nie blokuje niczego: ani testu, ani następnego działu, ani żadnej lekcji,
--   * można ją robić wielokrotnie, a każde podejście losuje zestaw od nowa.
--
-- Rodzaj `review` z zasięgiem działu (`review_scope_unit_id`) istniał od pierwszych migracji
-- i robił prawie to samo, tylko brał słówka wyłącznie ze stanu powtórek FSRS (`srs_state`) —
-- czyli te, które dziecko już widziało i które akurat są zaległe. Dla „chcę przećwiczyć dział"
-- to zły dobór: tuż po przerobieniu działu zaległych nie ma prawie wcale, więc powtórka bywała
-- pusta dokładnie wtedy, kiedy jest najbardziej potrzebna. Dlatego zasięg działowy losuje teraz
-- z całego działu, jak test. Zasięg kursu (`review_scope_course_id`, czyli „Test powtórkowy"
-- z bramki zaległości) zostaje bez zmian — tam cała rzecz polega właśnie na kolejce FSRS.
--
-- Odrzucone: czwarta wartość w `lesson_kind` (to samo zachowanie co `review` z zasięgiem
-- działu, tylko pod inną nazwą — i trzecia gałąź do dopisania w każdej funkcji, która pyta
-- o rodzaj lekcji); dobór ważony FSRS z dopełnieniem losowymi (dziecko wybiera powtórkę, żeby
-- przećwiczyć dział, a nie żeby baza wybrała za nie — a od kolejki zaległych jest osobny test
-- powtórkowy); powtórka otwierana po pierwszej zaliczonej lekcji działu (tak było i to znaczyło
-- „powtórz dział, którego jeszcze nie przerobiłeś"); brak punktów za powtórzone podejście
-- (zwykła lekcja robiona drugi raz też płaci, a tu i tak trzeba poprawnie odpowiedzieć
-- piętnaście razy).

-- 1. Ile zadań ma powtórka działu. Tyle co test i tyle, co mieści się w jednym etapie
-- (`stage_size`), żeby była jednym podejściem, a nie kilkoma pod rząd.
create or replace function public.unit_practice_limit() returns integer
  language sql immutable set search_path = '' as $fn$ select 15 $fn$;

comment on function public.unit_practice_limit() is
  'Ile zadań ma powtórka działu (lekcja kind=review z review_scope_unit_id).';

/**
 * Zadania z działu: po jednym na słówko, losowy typ, losowa kolejność. Wspólne dla testu działu
 * i dla powtórki działu — oba biorą dział w całości i różnią się tylko tym, po co to robią.
 */
create or replace function public.pick_unit_exercises(p_unit uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with slowka as (
    select distinct li.concept_id
      from public.lesson_items li
      join public.lessons l on l.id = li.lesson_id
     where l.unit_id = p_unit
  ),
  wybrane as (
    select distinct on (s.concept_id) s.concept_id, ex.id as exercise_id
      from slowka s
      join public.exercises ex on ex.concept_id = s.concept_id and ex.is_active
      join public.lessons el on el.id = ex.lesson_id
     where el.unit_id = p_unit
     order by s.concept_id, random()
  )
  select w.exercise_id, w.concept_id, (row_number() over (order by random()))::integer
    from wybrane w;
$fn$;

-- 2. Dobór zadań powtórki. Dwa zasięgi, dwie zupełnie różne reguły — stąd suma dwóch gałęzi
-- zamiast `case` w środku jednego zapytania.
create or replace function public.pick_review_exercises(p_lesson uuid, p_user uuid)
returns table (exercise_id uuid, concept_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  with scope as (
    select l.review_scope_unit_id as unit_id, l.review_scope_course_id as course_id
      from public.lessons l
     where l.id = p_lesson and l.kind = 'review'
  ),
  -- A. Powtórka działu: cały dział, losowo. `p_user` tu nie wpływa na dobór, ale sygnatura
  -- musi zostać — `get_lesson_exercises` woła obie funkcje doboru z jednego miejsca.
  dzial as (
    select p.exercise_id, p.concept_id, p.priority
      from scope sc
      cross join lateral public.pick_unit_exercises(sc.unit_id) p
     where sc.course_id is null and sc.unit_id is not null and p_user is not null
  ),
  -- B. Test powtórkowy kursu: kolejka zaległych z FSRS, najdłużej zaległe pierwsze.
  -- Przepisane bez zmian z `20261116120000_review_gate.sql`.
  w_zasiegu as (
    select distinct li.concept_id
      from public.lesson_items li
      join public.lessons l on l.id = li.lesson_id
      join public.units u on u.id = l.unit_id
     where u.course_id = (select course_id from scope)
  ),
  due as (
    select s.concept_id, s.due_on, s.lapses
      from public.srs_state s
     where s.user_id = p_user
       and s.concept_id in (select concept_id from w_zasiegu)
       and s.due_on <= current_date
  ),
  wybrane as (
    select distinct on (d.concept_id) ex.id as exercise_id, d.concept_id, d.due_on, d.lapses
      from due d
      join public.exercises ex on ex.concept_id = d.concept_id and ex.is_active
      join public.lessons el on el.id = ex.lesson_id
      join public.units eu on eu.id = el.unit_id
     where eu.course_id = (select course_id from scope)
     order by d.concept_id, random()
  ),
  kurs as (
    select w.exercise_id, w.concept_id,
           (row_number() over (order by w.due_on, w.lapses desc, w.concept_id))::integer as priority
      from wybrane w
     where (select course_id from scope) is not null
  )
  select d.exercise_id, d.concept_id, d.priority from dzial d
  union all
  select k.exercise_id, k.concept_id, k.priority from kurs k;
$fn$;

-- 3. Ile zadań ma lekcja. Dochodzi limit powtórki działu — reszta przepisana
-- z `20261115100000_unit_test.sql`.
create or replace function public.lesson_exercise_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  -- `coalesce` na zewnątrz: dla nieistniejącej lekcji ma wyjść zero, a nie `null` — na tej
  -- liczbie liczy się potem etapy (`lesson_stage_count`) i `null` rozlałby się dalej.
  select coalesce((
    select case
      when l.kind = 'review' then least(
        (select count(*) from public.pick_review_exercises(p_lesson, p_user)),
        case when l.review_scope_unit_id is not null
             then public.unit_practice_limit()
             else public.review_limit() end
      )
      when l.kind = 'test'
        then least((select count(*) from public.pick_test_exercises(p_lesson, p_user)), public.test_limit())
      else (select count(*) from public.lesson_exercises_at_level(p_lesson, 1::smallint))
    end
    from public.lessons l
    where l.id = p_lesson
  ), 0)::integer;
$fn$;

-- 4. Otwarcie lekcji. Zmienia się jedna gałąź: powtórka działu czeka na komplet lekcji działu,
-- tak jak test. Reszta ciała przepisana z `20261118090000_review_test_on_demand.sql`.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when not public.is_enrolled(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Test powtórkowy jest otwarty, dopóki jest co powtarzać — także po dzisiejszym zdanym
    -- teście, gdy bramka już nie stoi. Bez zaległego słówka z zadaniem nie ma z czego zrobić
    -- testu, więc kafelek jest zamknięty i ekran go nie pokazuje.
    when l.review_scope_course_id is not null then
      public.course_due_words(l.review_scope_course_id, p_user) > 0
    -- Bramka stoi przed zamkiem działu: zamyka cały kurs, razem z powtórkami i testami działów.
    when public.review_gate_on(
           (select u.course_id from public.units u where u.id = l.unit_id), p_user
         ) then false
    -- Zamek działu stoi przed wszystkim innym: zamknięty dział zamyka też swoją powtórkę
    -- i swój test, inaczej dałoby się przeskoczyć dział testem.
    when not public.is_unit_unlocked(l.unit_id, p_user) then false
    -- Lekcja kupiona za punkt odblokowania. Tylko zwykła: test i powtórka otwierają się same.
    when l.kind = 'standard' and exists (
      select 1 from public.lesson_unlocks lu
      where lu.user_id = p_user and lu.lesson_id = l.id
    ) then true
    -- Test działu i powtórka działu czekają na to samo: komplet zaliczonych lekcji działu.
    -- Lekcje nieopublikowane się nie liczą — dziecko ich nie widzi, nie ma jak ich zaliczyć.
    -- Powtórka jest dobrowolna, więc sama niczego nie zamyka: `is_unit_unlocked` pyta tylko
    -- o test, a warunkiem wstępnym zwykłej lekcji powtórka nigdy nie jest.
    when l.kind = 'test' or (l.kind = 'review' and l.review_scope_unit_id is not null) then
      not exists (
        select 1 from public.lessons sl
        where sl.unit_id = l.unit_id and sl.kind = 'standard' and sl.is_published
          and not exists (
            select 1 from public.lesson_progress lp
            where lp.user_id = p_user and lp.lesson_id = sl.id and lp.status = 'completed'
          )
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
  'Czy lekcja jest dla tego ucznia otwarta: zapis na kurs, bramka powtórek, otwarty dział, '
  'a w nim warunek wstępny lekcji. Test działu i powtórka działu czekają na komplet lekcji '
  'działu; test powtórkowy kursu jest otwarty, dopóki są zaległe słówka.';

-- 5. Wydawanie zadań. Zmienia się jedna linia — limit powtórki zależy od jej zasięgu.
-- Reszta ciała przepisana z `20261116100000_shuffle_exercise_order.sql`.
create or replace function public.get_lesson_exercises(
  p_lesson uuid,
  p_stage integer default 1,
  p_level smallint default 1,
  p_preview boolean default false
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
  v_user    uuid := (select auth.uid());
  v_kind    public.lesson_kind;
  v_stages  integer;
  v_level   smallint := coalesce(p_level, 1);
  v_preview boolean := coalesce(p_preview, false) and public.is_admin();
  v_limit   integer;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if v_level < 1 or v_level > 3 then
    raise exception 'Poziom to 1, 2 albo 3' using errcode = '22023';
  end if;

  -- Administrator widzi też lekcję przed publikacją — to jego podgląd roboczy.
  select l.kind,
         case
           when l.kind = 'review' and l.review_scope_unit_id is not null then public.unit_practice_limit()
           when l.kind = 'review' then public.review_limit()
           when l.kind = 'test' then public.test_limit()
           else 1000000
         end
    into v_kind, v_limit
    from public.lessons l
   where l.id = p_lesson and (l.is_published or v_preview);
  if not found then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not v_preview and not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  -- Powtórka i test mają własny dobór zadań i własną trudność — poziomów się do nich
  -- nie stosuje.
  if v_kind in ('review', 'test') then
    v_level := 1;
  end if;

  if v_level > 1 and not public.is_level_unlocked(p_lesson, v_user, v_level) and not v_preview then
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
             -- Zamiast kolejności z pliku treści: patrz nagłówek tego pliku.
             else public.exercise_order(ex.id)
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
    select c.* from chosen c where c.nr <= v_limit
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

-- 6. Powtórka powstaje sama, tym samym wyzwalaczem co test działu — przy pierwszym słówku
-- w dziale. Gdyby trzeba ją było zakładać ręcznie, dział bez powtórki byłby stanem domyślnym
-- i funkcja istniałaby tylko w tych działach, w których ktoś o niej pamiętał.
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

  -- Powtórka stoi ZA testem: test jest drogą dalej, powtórka dokładką dla chętnych. Oba
  -- kafelki otwierają się w tej samej chwili, więc o kolejności decyduje to, co ważniejsze.
  insert into public.lessons (
    unit_id, slug, title, icon, kind, sort_order, review_scope_unit_id, xp_reward, is_published
  )
  select v_unit, 'powtorka-dzialu', 'Powtórka działu', '🔁', 'review', 110, v_unit, 30, true
   where not exists (
     select 1 from public.lessons r
      where r.unit_id = v_unit and r.kind = 'review' and r.review_scope_unit_id is not null
   )
  on conflict do nothing;

  return new;
end;
$fn$;

comment on function public.add_unit_test() is
  'Zakłada w dziale dwa kafelki końcowe przy pierwszym słówku: test działu i powtórkę działu.';

-- 7. Działy, które już mają słówka, dostają powtórkę od razu. Dział, w którym powtórka
-- z zasięgiem działu już jest (założona ręcznie w panelu), zostaje ze swoją.
insert into public.lessons (
  unit_id, slug, title, icon, kind, sort_order, review_scope_unit_id, xp_reward, is_published
)
select u.id, 'powtorka-dzialu', 'Powtórka działu', '🔁', 'review', 110, u.id, 30, true
  from public.units u
 where exists (
         select 1 from public.lesson_items li
         join public.lessons l on l.id = li.lesson_id
         where l.unit_id = u.id
       )
   and not exists (
         select 1 from public.lessons r
          where r.unit_id = u.id and r.kind = 'review' and r.review_scope_unit_id is not null
       );

revoke execute on function public.pick_unit_exercises(uuid) from anon, public;
grant execute on function public.pick_unit_exercises(uuid) to authenticated;
grant execute on function public.unit_practice_limit() to authenticated;
