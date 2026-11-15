-- FSRS-6: zgodność implementacji w Postgresie z implementacją referencyjną.
--
-- Przypadki w fsrs_cases.psql są generowane z pakietu `ts-fsrs`
-- (`node scripts/fsrs-fixtures.mjs`). Porównujemy 260 przejść stanu i 15 interwałów.
-- Błąd we wzorze nie rzuciłby wyjątku, tylko po cichu psuł terminy powtórek — ten test jest
-- jedynym miejscem, w którym to widać.

begin;
select plan(8);

\ir fsrs_cases.psql

-- Tolerancja: obie implementacje liczą na liczbach zmiennoprzecinkowych podwójnej precyzji
-- i zaokrąglają do ośmiu miejsc, więc różnica większa niż 1e-6 oznacza inny wzór, nie inne
-- zaokrąglenie.
create or replace function pg_temp.w() returns double precision[]
  language sql stable as $$ select weights from public.srs_params where id = 1 $$;

select is(
  (select array_length(pg_temp.w(), 1)),
  21,
  'FSRS-6 ma 21 wag'
);

select is(
  (select round(public.fsrs_decay(pg_temp.w())::numeric, 4)),
  (-0.1542)::numeric,
  'wykładnik zaniku to -w20'
);

-- Krzywa zapominania z definicji: po S dniach szansa przypomnienia wynosi dokładnie 90%.
select ok(
  abs(public.fsrs_retrievability(pg_temp.w(), 10, 10) - 0.9) < 1e-6,
  'po S dniach retrievability wynosi 0,9'
);

select is(
  (select count(*)::integer from fsrs_cases c
    where abs((public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).stability
              - c.next_stability) > 1e-6),
  0,
  coalesce(
    (select 'stabilność niezgodna, np.: ' || string_agg(x.opis, '; ')
     from (
       select format('S=%s D=%s t=%s G=%s -> %s zamiast %s',
                     c.stability, c.difficulty, c.elapsed_days, c.grade,
                     (public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).stability,
                     c.next_stability) as opis
       from fsrs_cases c
       where abs((public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).stability
                 - c.next_stability) > 1e-6
       limit 3
     ) x),
    'stabilność zgodna z implementacją referencyjną w 260 przypadkach'
  )
);

select is(
  (select count(*)::integer from fsrs_cases c
    where abs((public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).difficulty
              - c.next_difficulty) > 1e-6),
  0,
  coalesce(
    (select 'trudność niezgodna, np.: ' || string_agg(x.opis, '; ')
     from (
       select format('S=%s D=%s t=%s G=%s -> %s zamiast %s',
                     c.stability, c.difficulty, c.elapsed_days, c.grade,
                     (public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).difficulty,
                     c.next_difficulty) as opis
       from fsrs_cases c
       where abs((public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).difficulty
                 - c.next_difficulty) > 1e-6
       limit 3
     ) x),
    'trudność zgodna z implementacją referencyjną w 260 przypadkach'
  )
);

select is(
  (select count(*)::integer from fsrs_cases c
    where c.retrievability is not null
      and abs(public.fsrs_retrievability(pg_temp.w(), c.elapsed_days, c.stability) - c.retrievability) > 1e-6),
  0,
  'krzywa zapominania zgodna z implementacją referencyjną'
);

select is(
  (select count(*)::integer from fsrs_cases c
    where public.fsrs_next_interval(
            pg_temp.w(),
            (public.fsrs_next_state(pg_temp.w(), c.difficulty, c.stability, c.elapsed_days, c.grade)).stability,
            0.9
          ) <> c.interval_days),
  0,
  'interwał po odpowiedzi zgodny z implementacją referencyjną'
);

select is(
  (select count(*)::integer from fsrs_interval_cases c
    where public.fsrs_next_interval(pg_temp.w(), c.stability, c.desired_retention) <> c.interval_days),
  0,
  'interwał dla różnych poziomów docelowej retencji zgodny z implementacją referencyjną'
);

select * from finish();
rollback;
