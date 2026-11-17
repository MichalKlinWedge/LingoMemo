-- Źle zrobione zadanie wraca w tym samym podejściu i liczy się jako kolejne zadanie.
--
-- Zadanie, które dziecku nie wyszło, wracało dopiero w powtórkach — za dzień albo za tydzień.
-- W obrębie etapu nie miało drugiego podejścia, więc jedyną nauką po błędzie był czerwony panel
-- z poprawną odpowiedzią. Od teraz przebieg lekcji dokłada takie zadanie na koniec kolejki etapu
-- (`lesson-runner.tsx`), raz na zadanie: dziecko, które czegoś nie umie, nie utknie na jednym
-- zadaniu do końca etapu.
--
-- Tu zmienia się liczenie wyniku, bo powtórka wywróciła poprzednią zasadę. Dotąd z każdego
-- zadania liczyła się OSTATNIA odpowiedź, więc po powtórce każdy etap kończyłby się kompletem
-- gwiazdek — poprawna odpowiedź stoi przecież na ekranie tuż przed powtórzonym zadaniem.
-- Od teraz liczy się każda odpowiedź z osobna: poprawka jest warta tyle co odpowiedź od razu
-- (dziecko dostaje za nią punkt do licznika), ale błąd zostaje w wyniku, bo dołożył do etapu
-- jedno zadanie więcej. Etap z dziesięcioma zadaniami i dwoma błędami naprawionymi w powtórce
-- to 10/12, czyli 0,833 — jedna gwiazdka, a nie trzy.
--
-- Odrzucone: liczenie pierwszej odpowiedzi zamiast ostatniej (powtórka nie zmieniałaby wyniku,
-- więc dla dziecka byłaby karą bez nagrody); pomijanie powtórek w mianowniku (to jest dokładnie
-- dzisiejsze „ostatnia odpowiedź wygrywa" i te same darmowe trzy gwiazdki); powtarzanie zadania
-- aż do skutku (dziecko, które nie umie, zostaje w pętli, a „Nie wiem, pomiń" tylko ją przedłuża).
--
-- Ciało funkcji przepisane w całości z `20261117090000_level_chain.sql` — `create or replace`
-- nie zna zmian cząstkowych, a tamta migracja jest wcześniejsza, więc to ta obowiązuje.
-- Zmienia się jeden fragment: zapytanie liczące wynik sesji.

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

  -- Liczy się KAŻDA odpowiedź, także ta na zadanie powtórzone w tym samym podejściu.
  -- Prośba o poprawienie literówki nie zapisuje próby, więc do mianownika nie wchodzi.
  select count(*), count(*) filter (where at.is_correct)
    into v_total, v_correct
    from public.attempts at
   where at.session_id = p_session and at.exercise_id is not null;

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

revoke execute on function public.finish_lesson_session(uuid) from anon, public;
grant execute on function public.finish_lesson_session(uuid) to authenticated;
