-- Trzy poziomy przy każdej lekcji, wybierane przez dziecko na ekranie kursu.
--
-- Zmiana polityki względem `20261115094000_learner_level.sql`. Tamto rozwiązanie dobierało
-- trudność za dziecko: sufit z profilu plus rampa z FSRS decydowały, które zadania w ogóle
-- zobaczy. W praktyce dziecko nie miało jak sięgnąć po trudniejsze zadanie, nawet gdy chciało,
-- a dorosły musiał to przestawiać w panelu.
--
-- Od teraz przy każdej lekcji stoją trzy kwadraciki: łatwy, średni i trudny.
--
--   * ŁATWY to lekcja, jaka była: wszystkie zadania na klikanie, podzielone na etapy po 15.
--     Tylko on liczy się do postępu — zaliczenie łatwego otwiera następną lekcję.
--   * ŚREDNI i TRUDNY to krótkie wejścia obok lekcji: osiem losowych słówek z tej lekcji,
--     po jednym zadaniu na słówko, w trudności odpowiadającej poziomowi. Otwierają się po
--     zaliczeniu łatwego i nie wpływają na otwieranie kolejnych lekcji.
--
-- `profiles.level` zostaje w bazie i w panelu, ale nie filtruje już niczego — o trudności
-- decyduje kwadracik, który dziecko kliknęło. Usunięcie pola to osobna decyzja na później.
--
-- Odrzucone: poziom jako trzy osobne lekcje na ekranie kursu (dziecko widzi trzy razy więcej kafelków
-- i gubi się, która jest która); wymaganie przejścia średniego przed trudnym (trudny bywa wtedy
-- nieosiągalny przez jedną nieudaną próbę); liczenie postępu z każdego poziomu osobno do
-- otwierania lekcji (dziecko musiałoby przejść wszystko, żeby ruszyć dalej).

-- 1. Sesja wie, na jakim poziomie gra. Domyślna jedynka opisuje sesje sprzed tej migracji.
alter table public.lesson_sessions
  add column if not exists level smallint not null default 1 check (level between 1 and 3);

-- 2. Postęp trudniejszych wejść. Jak każda tabela postępu: dla ucznia tylko do odczytu, zapis
-- wyłącznie przez `finish_lesson_session`. Poziom łatwy ma dalej swój `lesson_progress` —
-- to on jest postępem lekcji i on otwiera następną.
create table if not exists public.lesson_level_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  lesson_id      uuid not null references public.lessons(id) on delete cascade,
  level          smallint not null check (level between 2 and 3),
  status         public.progress_status not null default 'in_progress',
  best_score     numeric(4,3) not null default 0,
  last_score     numeric(4,3),
  stars          smallint not null default 0 check (stars between 0 and 3),
  attempts_count integer not null default 0,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, lesson_id, level)
);

alter table public.lesson_level_progress enable row level security;

create policy lesson_level_progress_read on public.lesson_level_progress
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Celowo BRAK polityki INSERT/UPDATE/DELETE — tak samo jak przy `lesson_progress`.

grant select on public.lesson_level_progress to authenticated;

-- 3. Ile słówek bierze trudniejsze wejście. Funkcja, nie stała w kodzie.
create or replace function public.level_run_size() returns integer
  language sql immutable set search_path = '' as $fn$ select 8 $fn$;

/**
 * Zadania lekcji na danym poziomie.
 *
 * Poziom łatwy ma zasadę ratunkową: słówko, które nie ma żadnego zadania na klikanie, wchodzi
 * ze swoim najłatwiejszym. Bez tego wypadłoby z lekcji, a że łatwy jest jedyną drogą dalej —
 * dziecko nigdy by go nie poznało. Na poziomie średnim i trudnym ratunku nie ma: to wejście
 * dodatkowe, więc słówko bez zadania o tej trudności po prostu w nim nie uczestniczy.
 */
create or replace function public.lesson_exercises_at_level(p_lesson uuid, p_level smallint)
returns table (exercise_id uuid)
language sql stable security definer set search_path = ''
as $fn$
  with all_ex as (
    select ex.id,
           -- Zadanie bez słówka jest grupą samo dla siebie.
           coalesce(ex.concept_id::text, ex.id::text) as grp,
           ex.level
      from public.exercises ex
     where ex.lesson_id = p_lesson and ex.is_active
  ),
  fits as (select * from all_ex where level = p_level),
  rescue as (
    select distinct on (a.grp) a.id
      from all_ex a
     where p_level = 1
       and not exists (select 1 from fits f where f.grp = a.grp)
     order by a.grp, a.level, a.id
  )
  select id from fits
  union
  select id from rescue;
$fn$;

/**
 * Trudniejsze wejście: osiem losowych słówek lekcji, po jednym zadaniu na słówko. Losowanie
 * jest przy każdym wywołaniu inne — dlatego sesja takiego wejścia nie zapisuje migawki zadań,
 * dokładnie jak powtórka (`20261115094200_session_exercise_snapshot.sql`).
 */
create or replace function public.pick_level_exercises(p_lesson uuid, p_level smallint)
returns table (exercise_id uuid, priority integer)
language sql stable security definer set search_path = ''
as $fn$
  select p.id, (row_number() over ())::integer
    from (
      select distinct on (coalesce(ex.concept_id::text, ex.id::text)) ex.id
        from public.exercises ex
       where ex.lesson_id = p_lesson
         and ex.is_active
         and ex.level = p_level
       order by coalesce(ex.concept_id::text, ex.id::text), random()
    ) p
   order by random()
   limit public.level_run_size();
$fn$;

-- 4. Liczba zadań lekcji to liczba zadań poziomu łatwego: na nim opiera się podział na etapy
-- i to on jest lekcją. Przepisana z `20261115094000_learner_level.sql`.
create or replace function public.lesson_exercise_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select case
    when (select l.kind from public.lessons l where l.id = p_lesson) = 'review'
      then least((select count(*) from public.pick_review_exercises(p_lesson, p_user)), public.review_limit())
    else (select count(*) from public.lesson_exercises_at_level(p_lesson, 1::smallint))
  end::integer;
$fn$;

-- 5. Etap zadania liczony po zadaniach poziomu łatwego — tylko ten poziom ma etapy. Zbiór nie
-- zależy już od dziecka, więc nie ma tu po co zaglądać w `auth.uid()`.
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
       and ex.id in (select v.exercise_id from public.lesson_exercises_at_level(p_lesson, 1::smallint) v)
  )
  select (((n.nr - 1) * greatest(ceil(n.total::numeric / public.stage_size())::integer, 1)) / n.total + 1)::integer
    from numbered n
   where n.id = p_exercise;
$fn$;

/** Czy dziecko ma już otwarty trudniejszy poziom tej lekcji — czyli czy przeszło łatwy. */
create or replace function public.is_level_unlocked(p_lesson uuid, p_user uuid, p_level smallint)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when coalesce(p_level, 1) <= 1 then public.is_lesson_unlocked(p_lesson, p_user)
    else exists (
      select 1 from public.lesson_progress lp
       where lp.lesson_id = p_lesson and lp.user_id = p_user and lp.status = 'completed'
    )
  end;
$fn$;

-- 6. Wydawanie zadań. Funkcja przepisana w całości z `20261115094100_shuffle_options.sql`
-- (`create or replace` nie zna zmian cząstkowych). Dochodzi parametr poziomu, a wraz z nim
-- inny dobór zadań i brak etapów powyżej poziomu łatwego. Podpis się zmienia, więc najpierw
-- `drop` — inaczej obok starej wersji powstałaby druga i wywołania stałyby się niejednoznaczne.
drop function if exists public.get_lesson_exercises(uuid, integer);

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

  -- Powtórka ma własny dobór zadań i własną trudność — poziomów się do niej nie stosuje.
  if v_kind = 'review' then
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
             when v_level > 1 then h.priority
             else ex.sort_order
           end as ord
    from public.exercises ex
    left join public.pick_review_exercises(p_lesson, v_user) r on r.exercise_id = ex.id
    left join public.pick_level_exercises(p_lesson, v_level) h on h.exercise_id = ex.id
    where ex.is_active
      and case
            when v_kind = 'review' then r.exercise_id is not null
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

-- 7. Start sesji. Przepisany w całości z `20261115094200_session_exercise_snapshot.sql`;
-- dochodzi poziom. Migawkę zadań zapisuje tylko poziom łatwy: na trudniejszych zestaw jest
-- losowany przy każdym wywołaniu, więc lista zapisana tutaj i tak nie byłaby tą, którą
-- zobaczyła przeglądarka — tak samo jak przy powtórce.
drop function if exists public.start_lesson_session(uuid, text, integer);

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

  if v_kind = 'review' then
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
    case when v_kind = 'review' or v_level > 1 then '{}'::uuid[] else v_ids end
  )
  returning id into v_session;

  return v_session;
end;
$fn$;

/**
 * Seria dni nauki. Wyciągnięta z `finish_lesson_session`, bo liczy się tak samo po lekcji
 * i po trudniejszym wejściu, a dwie kopie tego samego liczenia rozjechałyby się przy pierwszej
 * poprawce.
 */
create or replace function public.bump_streak(p_user uuid, p_today date, p_lesson_done boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_prev_day date;
  v_streak   integer;
begin
  select us.last_active_on, us.streak_days into v_prev_day, v_streak
    from public.user_stats us where us.user_id = p_user;

  if v_prev_day is null then
    v_streak := 1;
  elsif v_prev_day = p_today then
    v_streak := greatest(coalesce(v_streak, 1), 1);
  elsif v_prev_day = p_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  insert into public.user_stats (user_id, streak_days, best_streak, last_active_on, lessons_done, updated_at)
  values (p_user, v_streak, v_streak, p_today, case when p_lesson_done then 1 else 0 end, now())
  on conflict (user_id) do update set
    streak_days    = v_streak,
    best_streak    = greatest(public.user_stats.best_streak, v_streak),
    last_active_on = p_today,
    lessons_done   = public.user_stats.lessons_done + case when p_lesson_done then 1 else 0 end,
    updated_at     = now();

  return v_streak;
end;
$fn$;

-- 8. Podsumowanie sesji. Przepisane w całości z `20261115093000_lesson_stages.sql`; dochodzi
-- osobna droga dla poziomu średniego i trudnego, a liczenie serii dni idzie do `bump_streak`.
create or replace function public.finish_lesson_session(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user         uuid := (select auth.uid());
  v_session      public.lesson_sessions%rowtype;
  v_lesson       public.lessons%rowtype;
  v_stage        integer;
  v_stages       integer;
  v_total        integer;
  v_correct      integer;
  v_score        numeric(4,3);
  v_stars        smallint;
  v_passed       boolean;
  v_xp           integer := 0;
  v_today        date;
  v_tz           text;
  v_streak       integer;
  v_badges       text[];
  v_done_stages  integer;
  v_lesson_score numeric(4,3);
  v_lesson_stars smallint;
  v_lesson_done  boolean;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select * into v_session from public.lesson_sessions s where s.id = p_session and s.user_id = v_user;
  if not found then
    raise exception 'Nie ma takiej sesji' using errcode = '42501';
  end if;
  select * into v_lesson from public.lessons l where l.id = v_session.lesson_id;

  v_stage  := v_session.stage_nr;
  v_stages := case
                when v_session.level > 1 then 1
                else public.lesson_stage_count(v_session.lesson_id, v_user)
              end;

  -- Liczy się ostatnia odpowiedź na każde zadanie, nie każda próba z osobna.
  select count(*), count(*) filter (where a.is_correct)
    into v_total, v_correct
    from (
      select distinct on (at.exercise_id) at.exercise_id, at.is_correct
      from public.attempts at
      where at.session_id = p_session and at.exercise_id is not null
      -- Po identyfikatorze, nie po created_at: now() jest stałe w obrębie transakcji, więc
      -- dwie odpowiedzi na to samo zadanie miałyby identyczny znacznik czasu.
      order by at.exercise_id, at.id desc
    ) a;

  v_total := greatest(coalesce(v_total, 0), 1);
  v_score := round(coalesce(v_correct, 0)::numeric / v_total, 3);
  -- Progi takie same jak STAR_THRESHOLDS w packages/core/src/scoring.ts.
  v_stars := case when v_score >= 1 then 3 when v_score >= 0.9 then 2 when v_score >= 0.8 then 1 else 0 end;
  v_passed := v_score >= v_lesson.pass_threshold;

  select p.time_zone into v_tz from public.profiles p where p.id = v_user;
  v_today := (now() at time zone coalesce(v_tz, 'Europe/Warsaw'))::date;

  -- --- poziom średni i trudny: krótkie wejście obok lekcji ---
  --
  -- Nie dotyka `lesson_progress` ani `lesson_stage_progress`, więc nie otwiera następnej lekcji
  -- i nie zmienia gwiazdek lekcji. O tym decyduje wyłącznie poziom łatwy.
  if v_session.level > 1 then
    if v_session.finished_at is null then
      if v_passed then
        v_xp := v_lesson.xp_reward;
        insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
        values (v_user, v_xp, 'lesson_completed', 'session', p_session)
        on conflict do nothing;
      end if;

      update public.lesson_sessions set
        finished_at     = now(),
        total_exercises = v_total,
        correct_count   = coalesce(v_correct, 0),
        score           = v_score,
        xp_awarded      = v_xp
      where id = p_session;

      insert into public.lesson_level_progress (
        user_id, lesson_id, level, status, best_score, last_score, stars,
        attempts_count, completed_at, updated_at
      )
      values (
        v_user, v_session.lesson_id, v_session.level,
        case when v_passed then 'completed' else 'in_progress' end::public.progress_status,
        v_score, v_score, v_stars, 1,
        case when v_passed then now() end, now()
      )
      on conflict (user_id, lesson_id, level) do update set
        status         = case when v_passed or public.lesson_level_progress.status = 'completed'
                              then 'completed' else 'in_progress' end::public.progress_status,
        best_score     = greatest(public.lesson_level_progress.best_score, v_score),
        last_score     = v_score,
        stars          = greatest(public.lesson_level_progress.stars, v_stars),
        attempts_count = public.lesson_level_progress.attempts_count + 1,
        completed_at   = coalesce(public.lesson_level_progress.completed_at, case when v_passed then now() end),
        updated_at     = now();

      -- Nauka to nauka: trudniejsze wejście podtrzymuje serię dni, ale nie dolicza lekcji.
      v_streak := public.bump_streak(v_user, v_today, false);
    end if;

    v_badges := public.award_badges(v_user);

    return jsonb_build_object(
      'total', v_total,
      'correct', coalesce(v_correct, 0),
      'score', v_score,
      'stars', v_stars,
      'passed', v_passed,
      'xp', v_xp,
      'streak', v_streak,
      'badges', to_jsonb(v_badges),
      'stage', 1,
      'stages', 1,
      'stagesDone', case when v_passed then 1 else 0 end,
      'level', v_session.level,
      'lessonPassed', v_passed
    );
  end if;

  -- --- poziom łatwy: lekcja właściwa, z etapami ---
  if v_session.finished_at is null then
    -- Udział etapu w nagrodzie za lekcję. Reszta z dzielenia dopisana do ostatniego etapu,
    -- żeby suma zgadzała się co do punktu z `xp_reward`.
    if v_passed then
      v_xp := v_lesson.xp_reward / v_stages
            + case when v_stage = v_stages then v_lesson.xp_reward % v_stages else 0 end;
      insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
      values (v_user, v_xp, 'lesson_completed', 'session', p_session)
      on conflict do nothing;
    end if;

    update public.lesson_sessions set
      finished_at     = now(),
      total_exercises = v_total,
      correct_count   = coalesce(v_correct, 0),
      score           = v_score,
      xp_awarded      = v_xp
    where id = p_session;

    insert into public.lesson_stage_progress (
      user_id, lesson_id, stage_nr, status, best_score, last_score, stars,
      attempts_count, completed_at, updated_at
    )
    values (
      v_user, v_session.lesson_id, v_stage,
      case when v_passed then 'completed' else 'in_progress' end::public.progress_status,
      v_score, v_score, v_stars, 1,
      case when v_passed then now() end, now()
    )
    on conflict (user_id, lesson_id, stage_nr) do update set
      status         = case when v_passed or public.lesson_stage_progress.status = 'completed'
                            then 'completed' else 'in_progress' end::public.progress_status,
      best_score     = greatest(public.lesson_stage_progress.best_score, v_score),
      last_score     = v_score,
      stars          = greatest(public.lesson_stage_progress.stars, v_stars),
      attempts_count = public.lesson_stage_progress.attempts_count + 1,
      completed_at   = coalesce(public.lesson_stage_progress.completed_at, case when v_passed then now() end),
      updated_at     = now();

    -- Stan całej lekcji przeliczany z etapów, nie dopisywany po kawałku.
    select count(*) filter (where sp.status = 'completed'),
           round(coalesce(sum(sp.best_score), 0) / v_stages, 3)
      into v_done_stages, v_lesson_score
      from public.lesson_stage_progress sp
     where sp.user_id = v_user and sp.lesson_id = v_session.lesson_id;

    v_lesson_done  := coalesce(v_done_stages, 0) >= v_stages;
    v_lesson_stars := case when v_lesson_score >= 1 then 3
                           when v_lesson_score >= 0.9 then 2
                           when v_lesson_score >= 0.8 then 1 else 0 end;

    insert into public.lesson_progress (
      user_id, lesson_id, status, best_score, last_score, stars, attempts_count, completed_at, updated_at
    )
    values (
      v_user, v_session.lesson_id,
      case when v_lesson_done then 'completed' else 'in_progress' end::public.progress_status,
      v_lesson_score, v_score, case when v_lesson_done then v_lesson_stars else 0 end, 1,
      case when v_lesson_done then now() end, now()
    )
    on conflict (user_id, lesson_id) do update set
      status         = case when v_lesson_done or public.lesson_progress.status = 'completed'
                            then 'completed' else 'in_progress' end::public.progress_status,
      best_score     = greatest(public.lesson_progress.best_score, v_lesson_score),
      last_score     = v_score,
      -- Gwiazdki dopiero za całą lekcję: po pierwszym z trzech etapów nie ma czego oceniać.
      stars          = case when v_lesson_done
                            then greatest(public.lesson_progress.stars, v_lesson_stars)
                            else public.lesson_progress.stars end,
      attempts_count = public.lesson_progress.attempts_count + 1,
      completed_at   = coalesce(public.lesson_progress.completed_at, case when v_lesson_done then now() end),
      updated_at     = now();

    v_streak := public.bump_streak(v_user, v_today, coalesce(v_lesson_done, false));
  else
    select count(*) filter (where sp.status = 'completed')
      into v_done_stages
      from public.lesson_stage_progress sp
     where sp.user_id = v_user and sp.lesson_id = v_session.lesson_id;
    v_lesson_done := coalesce(v_done_stages, 0) >= v_stages;
  end if;

  v_badges := public.award_badges(v_user);

  return jsonb_build_object(
    'total', v_total,
    'correct', coalesce(v_correct, 0),
    'score', v_score,
    'stars', v_stars,
    'passed', v_passed,
    'xp', v_xp,
    'streak', v_streak,
    'badges', to_jsonb(v_badges),
    -- Etap, na którym dziecko właśnie jest, i stan całej lekcji — ekran podsumowania musi
    -- wiedzieć, czy pokazać „Następny etap", czy puchar.
    'stage', v_stage,
    'stages', v_stages,
    'stagesDone', coalesce(v_done_stages, 0),
    'level', 1,
    'lessonPassed', coalesce(v_lesson_done, false)
  );
end;
$fn$;

-- 9. Trzy kwadraciki na ekranie kursu: stan każdego poziomu każdej lekcji.
create or replace view public.v_my_lesson_levels with (security_invoker = on) as
select
  l.id                                                   as lesson_id,
  lv.level                                               as level,
  public.is_level_unlocked(l.id, (select auth.uid()), lv.level) as is_unlocked,
  case when lv.level = 1 then coalesce(mp.status::text, 'new')
       else coalesce(lp.status::text, 'new') end         as status,
  case when lv.level = 1 then coalesce(mp.stars, 0)
       else coalesce(lp.stars, 0) end                    as stars,
  -- Ile zadań ma ten poziom w tej lekcji. Zero znaczy, że kwadracika nie ma po co pokazywać.
  (select count(*)::integer from public.exercises ex
    where ex.lesson_id = l.id and ex.is_active and ex.level = lv.level) as exercise_count
from public.lessons l
cross join (values (1::smallint), (2::smallint), (3::smallint)) as lv(level)
left join public.lesson_progress mp
       on mp.lesson_id = l.id and mp.user_id = (select auth.uid())
left join public.lesson_level_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid()) and lp.level = lv.level
where l.is_published and l.kind <> 'review';

grant select on public.v_my_lesson_levels to authenticated;

revoke execute on function public.lesson_exercises_at_level(uuid, smallint) from anon, public;
revoke execute on function public.pick_level_exercises(uuid, smallint) from anon, public;
revoke execute on function public.is_level_unlocked(uuid, uuid, smallint) from anon, public;
revoke execute on function public.level_run_size() from anon, public;
revoke execute on function public.bump_streak(uuid, date, boolean) from anon, public;
revoke execute on function public.get_lesson_exercises(uuid, integer, smallint) from anon, public;
revoke execute on function public.start_lesson_session(uuid, text, integer, smallint) from anon, public;
grant execute on function public.lesson_exercises_at_level(uuid, smallint) to authenticated;
grant execute on function public.is_level_unlocked(uuid, uuid, smallint) to authenticated;
grant execute on function public.get_lesson_exercises(uuid, integer, smallint) to authenticated;
grant execute on function public.start_lesson_session(uuid, text, integer, smallint) to authenticated;

-- 11. Powtórka wraca do doboru sprzed poziomów: losowe zadanie na słówko, bez sufitu z profilu.
-- Funkcja przepisana w całości z `20261115091100_review.sql` — w `20261115094000_learner_level.sql`
-- miała warunek na dopuszczalny poziom, a ten zniknął razem z sufitem.
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
           -- Zaległe idą pierwsze, potem te, na których dziecko się najczęściej myli.
           case when s.due_on <= current_date then 0 else 1 end as priority,
           s.due_on,
           s.lapses
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
  order by d.concept_id, random();
$fn$;

-- 10. Sprzątanie po poprzedniej polityce. Sufit z profilu i rampa z FSRS nie dobierają już
-- zadań — robi to kwadracik, który dziecko kliknęło — a żadna funkcja ich nie woła. Zostaje
-- `profiles.level` i `set_learner_level`, bo pole zostaje w panelu do osobnej decyzji.
drop function if exists public.visible_exercises(uuid, uuid);
drop function if exists public.allowed_exercise_level(uuid, uuid);
drop function if exists public.concept_ramp_level(double precision);
drop function if exists public.ramp_recognized();
drop function if exists public.ramp_known();
