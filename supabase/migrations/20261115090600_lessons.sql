-- Przebieg lekcji: otwarcie sesji, sprawdzanie odpowiedzi, podsumowanie.
--
-- Cała ocena jest tutaj, nie w przeglądarce. Dziecko wysyła surową odpowiedź i dostaje werdykt;
-- liczby punktów ani wyniku nigdy nie wysyła. Klucze poprawnych odpowiedzi nie opuszczają bazy —
-- `exercises` nie ma polityki SELECT dla ucznia, treść zadań wydaje get_lesson_exercises().

-- Porównanie odpowiedzi: bez wielkości liter, bez ogonków, bez interpunkcji, bez nadmiarowych
-- spacji. Dwuargumentowy unaccent() jest IMMUTABLE (jednoargumentowy nie jest).
create or replace function public.normalize_answer(p text)
returns text
language sql immutable set search_path = ''
as $fn$
  select btrim(
    regexp_replace(
      lower(extensions.unaccent('extensions.unaccent'::regdictionary, btrim(coalesce(p, '')))),
      '[[:space:][:punct:]]+', ' ', 'g'
    )
  );
$fn$;

-- Czy lekcja jest dla tego ucznia otwarta. `security definer`, bo polityka RLS na `lessons`
-- nie może sama odpytywać `lessons` — to rekurencja.
create or replace function public.is_lesson_unlocked(p_lesson uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
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

-- Zadania lekcji BEZ kluczy odpowiedzi. Dla dopasowywania par i rozsypanki dodatkowo mieszamy
-- kolejność — inaczej sama kolejność w payloadzie byłaby rozwiązaniem.
create or replace function public.get_lesson_exercises(p_lesson uuid)
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
  v_user uuid := (select auth.uid());
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

  return query
  select
    ex.id, ex.type, ex.sort_order, ex.concept_id, ex.points,
    case ex.type
      when 'match_pairs' then jsonb_build_object(
        'instruction', ex.payload -> 'instruction',
        'pairsLeft',  (select jsonb_agg(p ->> 'a' order by random()) from jsonb_array_elements(ex.payload -> 'pairs') p),
        'pairsRight', (select jsonb_agg(p ->> 'b' order by random()) from jsonb_array_elements(ex.payload -> 'pairs') p)
      )
      when 'sentence_order' then jsonb_build_object(
        'prompt', ex.payload -> 'prompt',
        'tokens', (select jsonb_agg(t order by random()) from jsonb_array_elements(ex.payload -> 'tokens') t)
      )
      else ex.payload - 'accepted' - 'answer' - 'solution'
    end
  from public.exercises ex
  where ex.lesson_id = p_lesson and ex.is_active
  order by ex.sort_order;
end;
$fn$;

-- Otwarcie sesji. Ten sam klucz idempotencji zwraca tę samą sesję, więc zerwane połączenie
-- nie zakłada dziecku drugiego podejścia.
create or replace function public.start_lesson_session(p_lesson uuid, p_idempotency_key text)
returns uuid
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user    uuid := (select auth.uid());
  v_session uuid;
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

  select s.id into v_session from public.lesson_sessions s
   where s.user_id = v_user and s.lesson_id = p_lesson and s.idempotency_key = p_idempotency_key;
  if found then
    return v_session;
  end if;

  select count(*) into v_total from public.exercises ex where ex.lesson_id = p_lesson and ex.is_active;

  insert into public.lesson_sessions (user_id, lesson_id, idempotency_key, total_exercises)
  values (v_user, p_lesson, p_idempotency_key, v_total)
  returning id into v_session;

  return v_session;
end;
$fn$;

-- Sprawdzenie jednej odpowiedzi. Zwraca werdykt do animacji „dobrze / źle” i od razu zapisuje
-- próbę, stan powtórek i punkty — wszystko w jednej transakcji.
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

  select s.lesson_id into v_lesson from public.lesson_sessions s
   where s.id = p_session and s.user_id = v_user and s.finished_at is null;
  if not found then
    raise exception 'Ta lekcja jest już zakończona' using errcode = '42501';
  end if;

  select * into v_ex from public.exercises ex where ex.id = p_exercise and ex.is_active;
  if not found then
    raise exception 'Nie ma takiego zadania' using errcode = '22023';
  end if;
  if v_ex.lesson_id <> v_lesson then
    raise exception 'Zadanie nie należy do tej lekcji' using errcode = '42501';
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

    when 'match_pairs' then
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
  v_single_tap := (v_ex.payload ? 'options') or v_ex.type = 'match_pairs';
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

-- Odznaki. Reguły są deklaratywne, więc dołożenie nowej to wiersz w `badges`, nie zmiana kodu.
create or replace function public.award_badges(p_user uuid)
returns text[]
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_badge   record;
  v_value   integer;
  v_awarded text[] := '{}';
begin
  for v_badge in
    select b.* from public.badges b
    where b.is_active
      and not exists (select 1 from public.user_badges ub where ub.user_id = p_user and ub.badge_code = b.code)
  loop
    v_value := case v_badge.rule ->> 'kind'
      when 'lessons_completed' then (select count(*) from public.lesson_progress lp where lp.user_id = p_user and lp.status = 'completed')
      when 'points_total'      then coalesce((select sum(delta) from public.points_ledger pl where pl.user_id = p_user), 0)
      when 'streak_days'       then coalesce((select streak_days from public.user_stats us where us.user_id = p_user), 0)
      -- Słówko „umiane”: stabilność co najmniej 21 dni, czyli przypomni się za trzy tygodnie.
      when 'words_learned'     then (select count(*) from public.srs_state s where s.user_id = p_user and s.stability >= 21)
      when 'perfect_lessons'   then (select count(*) from public.lesson_progress lp where lp.user_id = p_user and lp.best_score >= 1)
      else null
    end;

    if v_value is not null and v_value >= (v_badge.rule ->> 'n')::integer then
      insert into public.user_badges (user_id, badge_code) values (p_user, v_badge.code)
      on conflict do nothing;
      insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
      values (p_user, coalesce((v_badge.rule ->> 'points')::integer, 25), 'badge', v_badge.code, null)
      on conflict do nothing;
      v_awarded := v_awarded || v_badge.code;
    end if;
  end loop;

  return v_awarded;
end;
$fn$;

-- Zamknięcie lekcji: wynik, gwiazdki, punkty, seria dni, odznaki. Wszystko liczone z zapisanych
-- prób, nie z tego, co przyśle przeglądarka.
create or replace function public.finish_lesson_session(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_user     uuid := (select auth.uid());
  v_session  public.lesson_sessions%rowtype;
  v_lesson   public.lessons%rowtype;
  v_total    integer;
  v_correct  integer;
  v_score    numeric(4,3);
  v_stars    smallint;
  v_passed   boolean;
  v_xp       integer := 0;
  v_today    date;
  v_tz       text;
  v_prev_day date;
  v_streak   integer;
  v_badges   text[];
begin
  if v_user is null then
    raise exception 'Trzeba być zalogowanym' using errcode = '42501';
  end if;

  select * into v_session from public.lesson_sessions s where s.id = p_session and s.user_id = v_user;
  if not found then
    raise exception 'Nie ma takiej sesji' using errcode = '42501';
  end if;
  select * into v_lesson from public.lessons l where l.id = v_session.lesson_id;

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
    if v_passed then
      v_xp := v_lesson.xp_reward;
      insert into public.points_ledger (user_id, delta, reason, ref_type, ref_id)
      values (v_user, v_xp, 'lesson_completed', 'session', p_session)
      on conflict do nothing;
    end if;

    update public.lesson_sessions set
      finished_at   = now(),
      total_exercises = v_total,
      correct_count = coalesce(v_correct, 0),
      score         = v_score,
      xp_awarded    = v_xp
    where id = p_session;

    insert into public.lesson_progress (
      user_id, lesson_id, status, best_score, last_score, stars, attempts_count, completed_at, updated_at
    )
    values (
      v_user, v_session.lesson_id,
      case when v_passed then 'completed' else 'in_progress' end::public.progress_status,
      v_score, v_score, v_stars, 1,
      case when v_passed then now() end, now()
    )
    on conflict (user_id, lesson_id) do update set
      status         = case when v_passed or public.lesson_progress.status = 'completed'
                            then 'completed' else 'in_progress' end::public.progress_status,
      best_score     = greatest(public.lesson_progress.best_score, v_score),
      last_score     = v_score,
      stars          = greatest(public.lesson_progress.stars, v_stars),
      attempts_count = public.lesson_progress.attempts_count + 1,
      completed_at   = coalesce(public.lesson_progress.completed_at, case when v_passed then now() end),
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
    values (v_user, v_streak, v_streak, v_today, case when v_passed then 1 else 0 end, now())
    on conflict (user_id) do update set
      streak_days    = v_streak,
      best_streak    = greatest(public.user_stats.best_streak, v_streak),
      last_active_on = v_today,
      lessons_done   = public.user_stats.lessons_done + case when v_passed then 1 else 0 end,
      updated_at     = now();
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
    'badges', to_jsonb(v_badges)
  );
end;
$fn$;

-- Słówka do powtórki z działu: najpierw zaległe, potem najczęściej mylone.
create or replace function public.get_review_set(p_unit uuid, p_limit integer default 12)
returns table (concept_id uuid, due_on date, lapses integer, stability double precision)
language sql stable security definer set search_path = ''
as $fn$
  select s.concept_id, s.due_on, s.lapses, s.stability
  from public.srs_state s
  where s.user_id = (select auth.uid())
    and s.concept_id in (
      select li.concept_id
      from public.lesson_items li
      join public.lessons l on l.id = li.lesson_id
      where l.unit_id = p_unit
    )
  order by (s.due_on <= current_date) desc, s.due_on, s.lapses desc, s.stability
  limit greatest(coalesce(p_limit, 12), 1);
$fn$;
