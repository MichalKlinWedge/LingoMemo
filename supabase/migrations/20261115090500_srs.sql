-- FSRS-6 — harmonogram powtórek interwałowych.
--
-- Przepisane z implementacji referencyjnej (pakiet `ts-fsrs`, model fsrs-6), nie z dokumentacji:
-- wiki algorytmu nie podaje dla FSRS-6 wzorów na trudność ani na stabilność po odpowiedzi.
-- Zgodność pilnuje test `supabase/tests/fsrs.test.sql`, który porównuje te funkcje z 260
-- przypadkami wygenerowanymi z pakietu referencyjnego (`node scripts/fsrs-fixtures.mjs`).
-- Błąd w którymkolwiek wzorze nie rzuci wyjątku — po cichu zepsuje terminy powtórek, dlatego
-- bez tego testu tego kodu nie wolno zmieniać.
--
-- Oznaczenia jak w algorytmie: S = stabilność (po ilu dniach szansa przypomnienia spada do 90%),
-- D = trudność (1-10), R = retrievability (szansa przypomnienia teraz), G = ocena 1-4.
-- UWAGA na indeksy: w algorytmie wagi numerowane są od zera (w0…w20), a tablice w Postgresie
-- od jedynki, więc w[k] w kodzie poniżej to w(k-1) z dokumentacji. Każde użycie jest opisane.

create table public.srs_params (
  id                smallint primary key default 1 check (id = 1),
  weights           double precision[] not null check (array_length(weights, 1) = 21),
  -- Jakie prawdopodobieństwo przypomnienia ma być w dniu powtórki. Sensowny zakres 0,7-0,97.
  desired_retention double precision not null default 0.9 check (desired_retention > 0.5 and desired_retention <= 1),
  -- Powtórki tego samego dnia (kilka podejść do słówka w jednej lekcji) liczone osobnym wzorem.
  enable_short_term boolean not null default true,
  updated_at        timestamptz not null default now()
);

comment on table public.srs_params is
  'Parametry FSRS-6. Jeden wiersz. Wagi można dostroić na własnych danych bez migracji — po '
  'zmianie trzeba przegenerować przypadki testowe: node scripts/fsrs-fixtures.mjs.';

insert into public.srs_params (id, weights) values (
  1,
  array[
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
  ]::double precision[]
);

-- Granice modelu, te same co w implementacji referencyjnej.
create or replace function public.fsrs_s_min() returns double precision
  language sql immutable set search_path = '' as $fn$ select 0.001::double precision $fn$;
create or replace function public.fsrs_s_max() returns double precision
  language sql immutable set search_path = '' as $fn$ select 36500::double precision $fn$;

-- Zaokrąglenie jak Math.round w JavaScripcie: połówki w górę, także dla liczb ujemnych.
-- round() w Postgresie zaokrągla połówki „od zera”, więc dla wartości ujemnych dałoby inny wynik.
create or replace function public.fsrs_round(v double precision, d integer default 8)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select floor(v * power(10::double precision, d) + 0.5) / power(10::double precision, d);
$fn$;

-- clamp jak w implementacji referencyjnej: min(max(v, lo), hi). Kolejność ma znaczenie —
-- gdy hi < lo (tak bywa przy stabilności po zapomnieniu), wynikiem jest hi.
create or replace function public.fsrs_clamp(v double precision, lo double precision, hi double precision)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select least(greatest(v, lo), hi);
$fn$;

-- Wykładnik zaniku krzywej zapominania. W FSRS-6 jest trenowalny — to ostatnia waga, w20.
create or replace function public.fsrs_decay(w double precision[])
returns double precision
language sql immutable set search_path = ''
as $fn$
  select -w[21];  -- w20
$fn$;

-- Współczynnik dobrany tak, że R(S, S) = 90%.
create or replace function public.fsrs_factor(w double precision[])
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(exp(ln(0.9) / public.fsrs_decay(w)) - 1, 8);
$fn$;

-- Krzywa zapominania: szansa przypomnienia po `elapsed_days` dniach przy stabilności S.
create or replace function public.fsrs_retrievability(
  w double precision[], elapsed_days double precision, stability double precision
)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(
    power(1 + public.fsrs_factor(w) * elapsed_days / stability, public.fsrs_decay(w)), 8
  );
$fn$;

-- Odwrotność krzywej: za ile dni szansa przypomnienia spadnie do `desired_retention`.
create or replace function public.fsrs_next_interval(
  w double precision[], stability double precision, desired_retention double precision
)
returns integer
language sql immutable set search_path = ''
as $fn$
  select greatest(
    floor(
      stability / public.fsrs_factor(w)
      * (power(desired_retention, 1 / public.fsrs_decay(w)) - 1)
      + 0.5
    )::integer,
    1
  );
$fn$;

-- Stabilność po pierwszej w życiu odpowiedzi na to słówko — osobna waga dla każdej oceny.
create or replace function public.fsrs_init_stability(w double precision[], g smallint)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_clamp(w[g], public.fsrs_s_min(), public.fsrs_s_max());  -- w(g-1)
$fn$;

-- Trudność początkowa: im lepsza pierwsza odpowiedź, tym niższa.
create or replace function public.fsrs_init_difficulty(w double precision[], g smallint)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(w[5] - exp((g - 1) * w[6]) + 1, 8);  -- w4, w5
$fn$;

-- Trudność po odpowiedzi. Zmiana jest tłumiona przy wysokim D (linear damping) i ściągana
-- w stronę trudności „łatwej” pierwszej odpowiedzi (mean reversion, waga w7).
create or replace function public.fsrs_next_difficulty(w double precision[], d double precision, g smallint)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_clamp(
    public.fsrs_round(
      w[8] * public.fsrs_init_difficulty(w, 4::smallint)  -- w7
      + (1 - w[8]) * (d + public.fsrs_round((-w[7] * (g - 3)) * (10 - d) / 9, 8)),  -- w6
      8
    ),
    1, 10
  );
$fn$;

-- Stabilność po poprawnej odpowiedzi. Rośnie tym mocniej, im niższe D, niższe S i niższe R
-- (trudniejsze przypomnienie wzmacnia pamięć bardziej). w15 karze „z trudem”, w16 premiuje „łatwe”.
create or replace function public.fsrs_next_recall_stability(
  w double precision[], d double precision, s double precision, r double precision, g smallint
)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(
    public.fsrs_clamp(
      s * (
        1 + exp(w[9]) * (11 - d) * power(s, -w[10]) * (exp((1 - r) * w[11]) - 1)  -- w8, w9, w10
          * (case when g = 2 then w[16] else 1 end)   -- w15
          * (case when g = 4 then w[17] else 1 end)   -- w16
      ),
      public.fsrs_s_min(), public.fsrs_s_max()
    ),
    8
  );
$fn$;

-- Stabilność po zapomnieniu.
create or replace function public.fsrs_next_forget_stability(
  w double precision[], d double precision, s double precision, r double precision
)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(
    public.fsrs_clamp(
      w[12] * power(d, -w[13]) * (power(s + 1, w[14]) - 1) * exp((1 - r) * w[15]),  -- w11..w14
      public.fsrs_s_min(), public.fsrs_s_max()
    ),
    8
  );
$fn$;

-- Powtórka tego samego dnia: upływ czasu jest zerowy, więc krzywa zapominania nic nie mówi.
-- Dla ocen od „hard” w górę stabilność nie może zmaleć.
create or replace function public.fsrs_next_short_term_stability(
  w double precision[], s double precision, g smallint
)
returns double precision
language sql immutable set search_path = ''
as $fn$
  select public.fsrs_round(
    public.fsrs_clamp(
      s * (
        case
          when g >= 2 then greatest(power(s, -w[20]) * exp(w[18] * (g - 3 + w[19])), 1)  -- w19, w17, w18
          else power(s, -w[20]) * exp(w[18] * (g - 3 + w[19]))
        end
      ),
      public.fsrs_s_min(), public.fsrs_s_max()
    ),
    8
  );
$fn$;

create type public.fsrs_state as (
  difficulty double precision,
  stability  double precision
);

-- Pełne przejście stanu. `d = 0 and s = 0` oznacza słówko, którego dziecko jeszcze nie widziało.
-- Nowa trudność liczona jest ZAWSZE ze starej, nie z nowej stabilności — kolejność jak w
-- implementacji referencyjnej.
create or replace function public.fsrs_next_state(
  w double precision[],
  d double precision,
  s double precision,
  elapsed_days double precision,
  g smallint,
  enable_short_term boolean default true
)
returns public.fsrs_state
language plpgsql immutable set search_path = ''
as $fn$
declare
  v_r      double precision;
  v_new_s  double precision;
  v_s_fail double precision;
begin
  if g < 1 or g > 4 then
    raise exception 'Ocena FSRS poza zakresem 1-4: %', g using errcode = '22023';
  end if;

  if d = 0 and s = 0 then
    return row(
      public.fsrs_clamp(public.fsrs_init_difficulty(w, g), 1, 10),
      public.fsrs_init_stability(w, g)
    )::public.fsrs_state;
  end if;

  v_r := public.fsrs_retrievability(w, elapsed_days, s);

  if elapsed_days = 0 and enable_short_term then
    v_new_s := public.fsrs_next_short_term_stability(w, s, g);
  elsif g = 1 then
    v_s_fail := public.fsrs_next_forget_stability(w, d, s, v_r);
    -- Stabilność po zapomnieniu nie może wzrosnąć; dolne ograniczenie bierze pod uwagę to,
    -- ile dałaby natychmiastowa poprawka tego samego dnia.
    v_new_s := public.fsrs_clamp(
      public.fsrs_round(s / exp(case when enable_short_term then w[18] * w[19] else 0 end), 8),
      public.fsrs_s_min(),
      v_s_fail
    );
  else
    v_new_s := public.fsrs_next_recall_stability(w, d, s, v_r, g);
  end if;

  return row(public.fsrs_next_difficulty(w, d, g), v_new_s)::public.fsrs_state;
end;
$fn$;

-- Zastosowanie wyniku odpowiedzi do stanu powtórek ucznia. Wołane z submit_attempt, w tej samej
-- transakcji co zapis próby — stan powtórek nie może rozjechać się z historią.
create or replace function public.srs_apply(
  p_user uuid,
  p_concept uuid,
  p_course uuid,
  p_grade smallint,
  p_time_zone text default 'Europe/Warsaw'
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_params   public.srs_params%rowtype;
  v_state    public.srs_state%rowtype;
  v_today    date;
  v_elapsed  double precision;
  v_next     public.fsrs_state;
  v_interval integer;
begin
  select * into v_params from public.srs_params where id = 1;
  -- Data w strefie dziecka: „powtórka na dziś” ma się pojawiać rano, a nie w środku nocy.
  v_today := (now() at time zone coalesce(p_time_zone, 'Europe/Warsaw'))::date;

  select * into v_state from public.srs_state s
    where s.user_id = p_user and s.concept_id = p_concept;

  if not found then
    v_elapsed := 0;
    v_next := public.fsrs_next_state(v_params.weights, 0, 0, 0, p_grade, v_params.enable_short_term);
  else
    v_elapsed := greatest(
      coalesce(v_today - (v_state.last_reviewed_at at time zone coalesce(p_time_zone, 'Europe/Warsaw'))::date, 0),
      0
    );
    v_next := public.fsrs_next_state(
      v_params.weights, v_state.difficulty, v_state.stability, v_elapsed, p_grade, v_params.enable_short_term
    );
  end if;

  v_interval := public.fsrs_next_interval(v_params.weights, v_next.stability, v_params.desired_retention);

  insert into public.srs_state (
    user_id, concept_id, course_id, stability, difficulty, due_on, last_reviewed_at,
    reps, lapses, last_result
  )
  values (
    p_user, p_concept, p_course, v_next.stability, v_next.difficulty,
    v_today + v_interval, now(), 1, case when p_grade = 1 then 1 else 0 end, p_grade > 1
  )
  on conflict (user_id, concept_id) do update set
    stability        = excluded.stability,
    difficulty       = excluded.difficulty,
    due_on           = excluded.due_on,
    last_reviewed_at = excluded.last_reviewed_at,
    reps             = public.srs_state.reps + 1,
    lapses           = public.srs_state.lapses + case when p_grade = 1 then 1 else 0 end,
    last_result      = excluded.last_result;
end;
$fn$;

revoke execute on function public.srs_apply(uuid, uuid, uuid, smallint, text) from anon, authenticated, public;
