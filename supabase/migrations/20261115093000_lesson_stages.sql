-- Etapy lekcji: długa lekcja dzieli się na kawałki po najwyżej 15 zadań.
--
-- Lekcja z 18 słówkami to 36 zadań, czyli pół godziny dla ośmiolatka — za długo, żeby skończyć
-- za jednym posiedzeniem, a przerwanie w połowie nie zapisywało dotąd niczego. Od teraz lekcja
-- dzieli się na etapy; zaliczenie lekcji to zaliczenie wszystkich jej etapów.
--
-- Etapy NIE są wierszem w bazie ani polem w pliku importu — wynikają z liczby zadań:
--
--   liczba etapów = ceil(zadań / 15),   zadanie nr `rn` trafia do etapu ((rn-1) * etapów) / zadań + 1
--
-- (dzielenie całkowite). Dzięki temu kawałki są równe co do jednego zadania (36 → 12/12/12,
-- 31 → 11/10/10), nigdy nie przekraczają 15, a treść i import zostają bez zmian: lekcje
-- mieszczące się w 15 zadaniach mają jeden etap i zachowują się dokładnie jak dotąd.
--
-- Odrzucone: etap jako osobny wiersz w `lessons` (dziecko widzi na mapie trzy lekcje zamiast
-- jednej) i etap deklarowany w JSON-ie (każdy plik treści trzeba poprawić, a limit pilnować
-- ręcznie). Powtórka ma najwyżej `review_limit()` zadań, więc zawsze jest jednoetapowa.

-- 1. Ile zadań mieści etap. Funkcja, nie stała w kodzie: wartość musi być ta sama w pięciu
-- miejscach i zmieniać się w jednym.
create or replace function public.stage_size() returns integer
  language sql immutable set search_path = '' as $fn$ select 15 $fn$;

create or replace function public.lesson_stage_count(p_lesson uuid, p_user uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  select greatest(
    ceil(public.lesson_exercise_count(p_lesson, p_user)::numeric / public.stage_size())::integer,
    1
  );
$fn$;

-- Etap zadania w jego lekcji. Kolejność MUSI być ta sama co w `get_lesson_exercises`
-- (`sort_order`, potem `id`) — inaczej `submit_attempt` odbijałby zadania z właściwego etapu.
create or replace function public.exercise_stage(p_exercise uuid, p_lesson uuid)
returns integer
language sql stable security definer set search_path = ''
as $fn$
  with numbered as (
    select ex.id,
           row_number() over (order by ex.sort_order, ex.id) as nr,
           count(*) over ()                                  as total
    from public.exercises ex
    where ex.lesson_id = p_lesson and ex.is_active
  )
  select (((n.nr - 1) * greatest(ceil(n.total::numeric / public.stage_size())::integer, 1)) / n.total + 1)::integer
  from numbered n
  where n.id = p_exercise;
$fn$;

-- 2. Postęp etapów. Jak każda tabela postępu: dla ucznia tylko do odczytu, zapis wyłącznie
-- przez `finish_lesson_session`.
create table if not exists public.lesson_stage_progress (
  user_id        uuid not null references auth.users(id) on delete cascade,
  lesson_id      uuid not null references public.lessons(id) on delete cascade,
  stage_nr       integer not null check (stage_nr >= 1),
  status         public.progress_status not null default 'in_progress',
  best_score     numeric(4,3) not null default 0,
  last_score     numeric(4,3),
  stars          smallint not null default 0 check (stars between 0 and 3),
  attempts_count integer not null default 0,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (user_id, lesson_id, stage_nr)
);
create index if not exists lesson_stage_progress_user_lesson_idx
  on public.lesson_stage_progress (user_id, lesson_id);

grant select on public.lesson_stage_progress to authenticated;
alter table public.lesson_stage_progress enable row level security;

drop policy if exists lesson_stage_progress_read on public.lesson_stage_progress;
create policy lesson_stage_progress_read on public.lesson_stage_progress
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
-- Celowo BRAK polityki INSERT/UPDATE/DELETE — tak samo jak przy `lesson_progress`.

-- Sesja wie, którego etapu dotyczy. Domyślna jedynka załatwia sesje sprzed tej migracji.
alter table public.lesson_sessions
  add column if not exists stage_nr integer not null default 1 check (stage_nr >= 1);

-- 3. Wydanie zadań jednego etapu. Stary wariant jednoargumentowy znika: z argumentem
-- domyślnym stałby się wołaniem niejednoznacznym.
drop function if exists public.get_lesson_exercises(uuid);

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

  select l.kind into v_kind from public.lessons l where l.id = p_lesson and l.is_published;
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

-- 4. Sesja dotyczy jednego etapu. Stary wariant dwuargumentowy znika z tego samego powodu.
drop function if exists public.start_lesson_session(uuid, text);

create or replace function public.start_lesson_session(
  p_lesson uuid,
  p_idempotency_key text,
  p_stage integer default 1
)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
  v_stages  integer;
  v_total   integer;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lessons l where l.id = p_lesson and l.is_published) then
    raise exception 'Nie ma takiej lekcji' using errcode = '22023';
  end if;
  if not public.is_lesson_unlocked(p_lesson, v_user) then
    raise exception 'Ta lekcja jest jeszcze zamknięta' using errcode = '42501';
  end if;

  v_stages := public.lesson_stage_count(p_lesson, v_user);
  if coalesce(p_stage, 1) < 1 or coalesce(p_stage, 1) > v_stages then
    raise exception 'Ta lekcja nie ma etapu numer %', p_stage using errcode = '22023';
  end if;

  -- Klucz idempotencji jest nadawany na etap: przeglądarka losuje nowy przy wejściu w kolejny.
  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  -- Liczba zadań prosto z funkcji wydającej etap — jedno źródło podziału, zero rozjazdu.
  select count(*) into v_total from public.get_lesson_exercises(p_lesson, coalesce(p_stage, 1));

  insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises, stage_nr)
  values (v_user, p_lesson, p_idempotency_key, v_total, coalesce(p_stage, 1))
  returning id into v_session;

  return v_session;
end;
$fn$;

-- 5. Odpowiedź musi pochodzić z etapu, który dziecko ma otwarty. Bez tego da się przysłać
-- identyfikator zadania z etapu trzeciego, siedząc w pierwszym, i zaliczyć je poza kolejnością.
create or replace function public.submit_attempt(
  p_session uuid,
  p_exercise uuid,
  p_answer jsonb,
  p_response_ms integer default null,
  p_hint_used boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user       uuid := (select auth.uid());
  v_ex         public.exercises%rowtype;
  v_lesson     uuid;
  v_stage      integer;
  v_kind       public.lesson_kind;
  v_course     uuid;
  v_tz         text;
  v_given      text;
  v_expected   text[];
  v_correct    boolean := false;
  v_near_miss  boolean := false;
  v_single_tap boolean;
  v_grade      smallint;
  v_shown      jsonb;
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select s.lesson_id, s.stage_nr into v_lesson, v_stage
    from public.lesson_sessions s
   where s.id = p_session and s.user_id = v_user and s.finished_at is null;
  if not found then
    raise exception 'Ta lekcja jest już zakończona' using errcode = '42501';
  end if;

  select * into v_ex from public.exercises ex where ex.id = p_exercise and ex.is_active;
  if not found then
    raise exception 'Nie ma takiego zadania' using errcode = '22023';
  end if;
  -- Dla powtórki zadanie pochodzi z innej lekcji tego samego działu — stąd osobna funkcja
  -- zamiast prostego porównania identyfikatorów.
  if not public.exercise_allowed_in_lesson(v_ex.id, v_lesson) then
    raise exception 'Zadanie nie należy do tej lekcji' using errcode = '42501';
  end if;

  select l.kind into v_kind from public.lessons l where l.id = v_lesson;
  -- Powtórka jest zawsze jednoetapowa, a jej zadania pochodzą z cudzych lekcji — numer etapu
  -- liczony w tamtej lekcji nie miałby tu żadnego znaczenia.
  if v_kind <> 'review' and public.exercise_stage(v_ex.id, v_lesson) is distinct from v_stage then
    raise exception 'Zadanie należy do innego etapu lekcji' using errcode = '42501';
  end if;

  case v_ex.type
    when 'translate_ab', 'translate_ba', 'inflection', 'listening' then
      -- Zadania z wyborem mają w payloadzie `options`; wtedy odpowiedź przychodzi jako `choice`.
      v_given := public.normalize_answer(coalesce(p_answer ->> 'text', p_answer ->> 'choice'));
      select array_agg(public.normalize_answer(x))
        into v_expected
        from jsonb_array_elements_text(v_ex.payload -> 'accepted') x;
      v_correct := v_given = any (v_expected);
      -- Tolerancja jednej literówki: dziecko uczy się słówka, nie pisania na maszynie.
      if not v_correct and char_length(v_given) > 4 then
        v_near_miss := exists (
          select 1 from unnest(v_expected) e where extensions.levenshtein(v_given, e) <= 1
        );
        v_correct := v_near_miss;
      end if;

    when 'fill_blank_choice' then
      v_correct := public.normalize_answer(p_answer ->> 'choice')
                 = public.normalize_answer(v_ex.payload ->> 'answer');

    when 'image_choice' then
      v_correct := (p_answer ->> 'choice') is not null
               and (p_answer ->> 'choice') = (v_ex.payload ->> 'answer');

    when 'match_pairs', 'listen_match' then
      v_correct := (
        select count(*) = jsonb_array_length(v_ex.payload -> 'pairs')
        from jsonb_array_elements(v_ex.payload -> 'pairs') p
        join jsonb_array_elements(coalesce(p_answer -> 'pairs', '[]'::jsonb)) a
          on public.normalize_answer(a ->> 'a') = public.normalize_answer(p ->> 'a')
         and public.normalize_answer(a ->> 'b') = public.normalize_answer(p ->> 'b')
      );

    when 'sentence_order' then
      v_correct := public.normalize_answer(
                     (select string_agg(t, ' ') from jsonb_array_elements_text(coalesce(p_answer -> 'tokens', '[]'::jsonb)) t)
                   )
                 = public.normalize_answer(
                     (select string_agg(t, ' ') from jsonb_array_elements_text(v_ex.payload -> 'solution') t)
                   );
  end case;

  -- Ocena dla harmonogramu powtórek. Musi zgadzać się z gradeFor() w packages/core/src/srs.ts.
  v_single_tap := (v_ex.payload ? 'options') or v_ex.type in ('match_pairs', 'listen_match');
  v_grade := case
    when not v_correct then 1
    when v_near_miss or p_hint_used then 2
    when v_single_tap and p_response_ms is not null and p_response_ms <= 4000 then 4
    else 3
  end;

  insert into public.attempts (
    session_id, user_id, exercise_id, concept_id, exercise_type,
    is_correct, near_miss, hint_used, raw_answer, response_ms
  )
  values (
    p_session, v_user, v_ex.id, v_ex.concept_id, v_ex.type,
    v_correct, v_near_miss, p_hint_used, p_answer, p_response_ms
  );

  if v_ex.concept_id is not null then
    select c.course_id into v_course from public.concepts c where c.id = v_ex.concept_id;
    select p.time_zone into v_tz from public.profiles p where p.id = v_user;
    if v_course is not null then
      perform public.srs_apply(v_user, v_ex.concept_id, v_course, v_grade, v_tz);
    end if;
  end if;

  if v_correct then
    insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
    values (v_user, v_ex.points, 'exercise_correct', 'session:' || p_session::text, v_ex.id)
    on conflict do nothing;  -- powtórzone zadanie w tej samej sesji nie płaci drugi raz
  end if;

  -- Przy błędzie pokazujemy poprawną odpowiedź — dziecko ma się z niej czegoś nauczyć.
  v_shown := case
    when v_correct then null
    when v_ex.type in ('match_pairs', 'listen_match') then
      to_jsonb((
        select string_agg((p ->> 'a') || ' — ' || (p ->> 'b'), ', ')
          from jsonb_array_elements(v_ex.payload -> 'pairs') p
      ))
    else coalesce(
      v_ex.payload -> 'answer',
      v_ex.payload -> 'accepted' -> 0,
      to_jsonb((select string_agg(t, ' ') from jsonb_array_elements_text(v_ex.payload -> 'solution') t))
    )
  end;

  return jsonb_build_object(
    'correct', v_correct,
    'nearMiss', v_near_miss,
    'grade', v_grade,
    'points', case when v_correct then v_ex.points else 0 end,
    'correctAnswer', v_shown
  );
end;
$fn$;

-- 6. Zamknięcie etapu, a przez to i lekcji.
--
-- Wynik lekcji to średnia z najlepszych wyników etapów, przy czym etapy jeszcze nierozegrane
-- liczą się jako zero — dzięki temu po pierwszym z trzech etapów na mapie widać jedną trzecią
-- postępu, a nie komplet gwiazdek. Lekcja dostaje `completed` dopiero, gdy KAŻDY etap jest
-- zaliczony. Punkty za lekcję dzielą się między etapy (reszta z dzielenia idzie do ostatniego),
-- więc przejście lekcji po kawałku daje dokładnie tyle samo, co za jednym razem.
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
  v_prev_day     date;
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
  v_stages := public.lesson_stage_count(v_session.lesson_id, v_user);

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

    -- Seria dni: liczona przy pierwszej lekcji w danym dniu, w strefie dziecka.
    select us.last_active_on, us.streak_days into v_prev_day, v_streak
      from public.user_stats us where us.user_id = v_user;
    if v_prev_day is null then
      v_streak := 1;
    elsif v_prev_day = v_today then
      v_streak := greatest(coalesce(v_streak, 1), 1);
    elsif v_prev_day = v_today - 1 then
      v_streak := coalesce(v_streak, 0) + 1;
    else
      v_streak := 1;
    end if;

    insert into public.user_stats (user_id, streak_days, best_streak, last_active_on, lessons_done, updated_at)
    values (v_user, v_streak, v_streak, v_today, case when v_lesson_done then 1 else 0 end, now())
    on conflict (user_id) do update set
      streak_days    = v_streak,
      best_streak    = greatest(public.user_stats.best_streak, v_streak),
      last_active_on = v_today,
      lessons_done   = public.user_stats.lessons_done + case when v_lesson_done then 1 else 0 end,
      updated_at     = now();
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
    'lessonPassed', coalesce(v_lesson_done, false)
  );
end;
$fn$;

-- 7. Mapa kursu pokazuje, ile etapów ma lekcja i ile z nich już za dzieckiem.
create or replace view public.v_my_lessons with (security_invoker = on) as
select
  l.id,
  l.unit_id,
  l.slug,
  l.title,
  l.icon,
  l.kind,
  l.sort_order,
  l.prerequisite_lesson_id,
  l.xp_reward,
  public.is_lesson_unlocked(l.id, (select auth.uid())) as is_unlocked,
  coalesce(lp.status::text, 'new') as status,
  coalesce(lp.stars, 0)            as stars,
  coalesce(lp.best_score, 0)       as best_score,
  -- Wyrażenie przepisane z `…_review_count.sql`: `create or replace view` nie zmieni typu
  -- istniejącej kolumny, więc `::integer` musi tu zostać co do znaku.
  case
    when l.kind = 'review' then public.lesson_exercise_count(l.id, (select auth.uid()))
    else (select count(*)::integer from public.lesson_items li where li.lesson_id = l.id)
  end as word_count,
  public.lesson_stage_count(l.id, (select auth.uid())) as stage_count,
  (select count(*)::integer from public.lesson_stage_progress sp
    where sp.lesson_id = l.id and sp.user_id = (select auth.uid()) and sp.status = 'completed')
    as stages_done
from public.lessons l
left join public.lesson_progress lp
       on lp.lesson_id = l.id and lp.user_id = (select auth.uid())
where l.is_published;

grant select on public.v_my_lessons to authenticated;

revoke execute on function public.lesson_stage_count(uuid, uuid) from anon, public;
revoke execute on function public.exercise_stage(uuid, uuid) from anon, public;
grant execute on function public.stage_size() to authenticated;
grant execute on function public.lesson_stage_count(uuid, uuid) to authenticated;
grant execute on function public.exercise_stage(uuid, uuid) to authenticated;
grant execute on function public.get_lesson_exercises(uuid, integer) to authenticated;
grant execute on function public.start_lesson_session(uuid, text, integer) to authenticated;
grant execute on function public.submit_attempt(uuid, uuid, jsonb, integer, boolean) to authenticated;
grant execute on function public.finish_lesson_session(uuid) to authenticated;

-- Asercja jak w `…_rls.sql`: nowa tabela nie może zostać bez RLS.
do $check$
declare
  r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in (
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relrowsecurity
      )
  loop
    raise exception 'RLS wyłączone na public.%', r.tablename;
  end loop;
end;
$check$;
