-- Trudniejszy poziom otwiera się dopiero po poprzednim, a zaliczenie wymaga gwiazdki.
--
-- Zgłoszone z ekranu: poziom średni nie został zdany (za dużo błędów), a mimo to poziom trudny
-- był otwarty. Tak to działało od `20261115095000_lesson_levels.sql`: `is_level_unlocked` dla
-- KAŻDEGO poziomu powyżej łatwego pytała tylko o to, czy skończona jest lekcja, więc zaliczenie
-- łatwego otwierało średni i trudny naraz. Dla dziecka to zaprzeczenie nazwy: „trudny" ma być
-- tym, do czego się dochodzi, a nie tym, co stoi otworem od początku.
--
-- Nowa reguła jest łańcuchem: łatwy -> średni -> trudny, a każde ogniwo wymaga zaliczenia
-- poprzedniego, czyli co najmniej JEDNEJ GWIAZDKI. Gwiazdka, nie sam status: wiersze zapisane
-- przed tą migracją mogły dostać „completed" przy obniżonym progu lekcji i zerze gwiazdek,
-- a reguła ma obowiązywać także dla nich.
--
-- Drugie ogniwo tej samej zasady jest w `finish_lesson_session`: próg zaliczenia nie schodzi
-- poniżej 0,8, czyli poniżej pierwszej gwiazdki. Bez tego dałoby się ustawić lekcji próg 0,5
-- i znów zamalować kwadracik bez ani jednej gwiazdki — tyle że teraz rozjechałby się jeszcze
-- z zamkniętym następnym poziomem.
--
-- Odrzucone: wymóg kompletu gwiazdek (trzy na trudny byłyby murem, nie progiem); otwieranie
-- trudnego za punkty odblokowania (te kupują lekcje, nie poziomy); pozostawienie wyboru
-- administratorowi (to nie jest ustawienie kursu, tylko sens słowa „zaliczone").

-- 1. Łańcuch poziomów. Poziom łatwy pyta o lekcję, średni o zaliczony łatwy, trudny o zaliczony
-- średni. Tabele są dwie, bo poziom łatwy ma własny postęp lekcji (`lesson_progress`),
-- a trudniejsze wejścia swój (`lesson_level_progress`).
create or replace function public.is_level_unlocked(p_lesson uuid, p_user uuid, p_level smallint)
returns boolean
language sql stable security definer set search_path = ''
as $fn$
  select case
    when coalesce(p_level, 1) <= 1 then public.is_lesson_unlocked(p_lesson, p_user)
    when coalesce(p_level, 1) = 2 then exists (
      select 1 from public.lesson_progress lp
       where lp.lesson_id = p_lesson and lp.user_id = p_user
         and lp.status = 'completed' and lp.stars >= 1
    )
    else exists (
      select 1 from public.lesson_level_progress lp
       where lp.lesson_id = p_lesson and lp.user_id = p_user and lp.level = 2
         and lp.status = 'completed' and lp.stars >= 1
    )
  end;
$fn$;

comment on function public.is_level_unlocked(uuid, uuid, smallint) is
  'Czy dziecko ma otwarty ten poziom lekcji: każdy wymaga gwiazdki z poprzedniego.';

-- 2. Podsumowanie sesji przepisane w całości z `20261115095000_lesson_levels.sql`
-- (`create or replace` nie zna zmian cząstkowych). Zmienia się jeden wiersz: próg zaliczenia.

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
  -- Próg zaliczenia nie schodzi poniżej jednej gwiazdki. Gwiazdki są oceną pokazywaną dziecku,
  -- więc „zaliczone" bez ani jednej było sprzeczne samo ze sobą: kwadracik zamalowany, a nad nim
  -- pusto. Administrator może obniżyć `pass_threshold` w formularzu lekcji — i obniżał go poniżej
  -- 0,8, czyli poniżej pierwszej gwiazdki.
  v_passed := v_score >= greatest(v_lesson.pass_threshold, 0.800);

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

-- `create or replace` zachowuje uprawnienia, ale wypisujemy je wprost: każda funkcja
-- `security definer` w tym projekcie ma je obok swojej definicji, a nie tylko w migracji,
-- w której powstała.
revoke execute on function public.is_level_unlocked(uuid, uuid, smallint) from anon, public;
grant execute on function public.is_level_unlocked(uuid, uuid, smallint) to authenticated;
revoke execute on function public.finish_lesson_session(uuid) from anon, public;
grant execute on function public.finish_lesson_session(uuid) to authenticated;
