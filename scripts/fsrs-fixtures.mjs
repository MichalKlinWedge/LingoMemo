#!/usr/bin/env node
/**
 * Przypadki testowe FSRS-6 z implementacji referencyjnej (`ts-fsrs`) do pliku SQL, który czyta
 * test pgTAP. Dzięki temu implementacja w Postgresie jest porównywana z czymś, co naprawdę liczy
 * ten algorytm, a nie z liczbami przepisanymi z dokumentacji.
 *
 *   node scripts/fsrs-fixtures.mjs
 *
 * Uruchamiane ręcznie po zmianie wag albo wersji `ts-fsrs`; wynik jest commitowany.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { fsrs } from 'ts-fsrs';

const root = fileURLToPath(new URL('../', import.meta.url));
const model = fsrs().model;

const STABILITIES = [0.5, 2.3065, 10, 100];
const DIFFICULTIES = [1, 4.2, 7.7, 10];
const ELAPSED = [0, 1, 7, 90];
const GRADES = [1, 2, 3, 4];
const RETENTIONS = [0.8, 0.9, 0.95];

const rows = [];
const add = (stability, difficulty, elapsed, grade) => {
  const memoryState = stability === 0 ? null : { stability, difficulty };
  const next = model.step({ memoryState, rating: grade, elapsedDays: elapsed });
  const retrievability = memoryState === null ? null : model.forgettingCurve(memoryState, elapsed);
  rows.push({
    stability,
    difficulty,
    elapsed,
    grade,
    nextStability: next.stability,
    nextDifficulty: next.difficulty,
    retrievability,
    interval: model.nextInterval(next, 0.9),
  });
};

// Nowa karta: stan wejściowy 0/0, bez upływu czasu.
for (const grade of GRADES) add(0, 0, 0, grade);
for (const stability of STABILITIES) {
  for (const difficulty of DIFFICULTIES) {
    for (const elapsed of ELAPSED) {
      for (const grade of GRADES) add(stability, difficulty, elapsed, grade);
    }
  }
}

const intervals = [];
for (const stability of [0.5, 1, 10, 100, 1000]) {
  for (const retention of RETENTIONS) {
    intervals.push({ stability, retention, days: model.nextInterval({ stability, difficulty: 5 }, retention) });
  }
}

const n = (value) => (value === null ? 'null' : String(value));
const sql = [
  '-- WYGENEROWANE przez scripts/fsrs-fixtures.mjs — nie edytuj ręcznie.',
  '-- Oczekiwane wyniki pochodzą z pakietu ts-fsrs (implementacja referencyjna FSRS-6).',
  `-- Wag: 21, przypadków przejścia stanu: ${rows.length}, przypadków interwału: ${intervals.length}.`,
  '',
  'create table pg_temp.fsrs_cases (',
  '  stability double precision not null,',
  '  difficulty double precision not null,',
  '  elapsed_days integer not null,',
  '  grade smallint not null,',
  '  next_stability double precision not null,',
  '  next_difficulty double precision not null,',
  '  retrievability double precision,',
  '  interval_days integer not null',
  ');',
  '',
  'insert into pg_temp.fsrs_cases values',
  rows
    .map(
      (r) =>
        `  (${n(r.stability)}, ${n(r.difficulty)}, ${r.elapsed}, ${r.grade}, ${n(r.nextStability)}, ${n(r.nextDifficulty)}, ${n(r.retrievability)}, ${r.interval})`,
    )
    .join(',\n'),
  ';',
  '',
  'create table pg_temp.fsrs_interval_cases (',
  '  stability double precision not null,',
  '  desired_retention double precision not null,',
  '  interval_days integer not null',
  ');',
  '',
  'insert into pg_temp.fsrs_interval_cases values',
  intervals.map((r) => `  (${n(r.stability)}, ${n(r.retention)}, ${r.days})`).join(',\n'),
  ';',
  '',
].join('\n');

writeFileSync(`${root}supabase/tests/_fsrs_cases.sql`, sql);
console.log(`supabase/tests/_fsrs_cases.sql: ${rows.length} przejść stanu, ${intervals.length} interwałów`);
