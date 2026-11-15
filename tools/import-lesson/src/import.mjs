#!/usr/bin/env node
/**
 * Import lekcji z pliku JSON — ta sama funkcja w bazie, co w panelu, i ta sama walidacja zod.
 * Panel wystarcza do jednej lekcji; przy napełnianiu świeżego projektu albo wgrywaniu kilkunastu
 * plików naraz szybciej jest z wiersza poleceń.
 *
 *   npm run import:lesson -- content/pl-en/zwierzeta-domowe.json
 *   npm run import:lesson -- content/pl-en/*.json --remote     # projekt w chmurze
 *   npm run import:lesson -- plik.json --dry-run               # tylko sprawdzenie pliku
 *
 * Używa klucza `service_role`, więc działa bez logowania się na konto administratora. Bez
 * `--remote` celuje w lokalną bazę.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { formatIssues, lessonImportSchema } from '@lingomemo/core';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const remote = args.includes('--remote');
const dryRun = args.includes('--dry-run');
const pliki = args.filter((value) => !value.startsWith('--'));

if (pliki.length === 0) {
  throw new Error('Użycie: npm run import:lesson -- <plik.json> [...] [--remote] [--dry-run]');
}

function parseEnv(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && match[2] !== '') vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

/** Sprawdzenie plików jest niezależne od bazy — przy `--dry-run` w ogóle się z nią nie łączymy. */
const sprawdzone = [];
let bledne = 0;

for (const plik of pliki) {
  const sciezka = plik.startsWith('/') || /^[A-Za-z]:/.test(plik) ? plik : `${root}${plik}`;
  if (!existsSync(sciezka)) {
    console.error(`${plik}: nie ma takiego pliku`);
    bledne += 1;
    continue;
  }

  let dane;
  try {
    dane = JSON.parse(readFileSync(sciezka, 'utf8'));
  } catch (error) {
    console.error(`${plik}: to nie jest poprawny JSON — ${error.message}`);
    bledne += 1;
    continue;
  }

  const wynik = lessonImportSchema.safeParse(dane);
  if (!wynik.success) {
    console.error(`${plik}: plik nie zgadza się z formatem`);
    for (const issue of formatIssues(wynik.error)) console.error(`    ${issue}`);
    bledne += 1;
    continue;
  }

  sprawdzone.push({ plik, dane: wynik.data });
  console.log(
    `${plik}: ${wynik.data.lesson.title} — ${wynik.data.concepts.length} słówek, ${wynik.data.exercises.length} zadań`,
  );
}

if (bledne > 0) {
  process.exitCode = 1;
  console.error(`\nNiepoprawnych plików: ${bledne}. Nic nie zostało zapisane.`);
} else if (dryRun) {
  console.log('\nSprawdzenie na sucho — nic nie zapisano.');
} else {
  let url;
  let serviceKey;

  if (remote) {
    const env = existsSync(`${root}.env.local`) ? parseEnv(readFileSync(`${root}.env.local`, 'utf8')) : {};
    url = env.NEXT_PUBLIC_SUPABASE_URL;
    serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('W .env.local brakuje NEXT_PUBLIC_SUPABASE_URL albo SUPABASE_SERVICE_ROLE_KEY.');
    }
  } else {
    const raw = execSync('npx --yes supabase@2.122.0 status -o json', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const status = JSON.parse(raw.slice(raw.indexOf('{')));
    url = status.API_URL;
    serviceKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\nZapisuję do ${url}`);
  for (const { plik, dane } of sprawdzone) {
    const { data, error } = await supabase.rpc('admin_import_lesson', { p_payload: dane });
    if (error) {
      console.error(`${plik}: ${error.message}`);
      process.exitCode = 1;
      break;
    }
    const raport = data;
    console.log(
      `${plik}: zapisane — ${raport.concepts} słówek, ${raport.terms} zapisów, ${raport.exercises} zadań`,
    );
    for (const ostrzezenie of raport.warnings ?? []) console.warn(`    uwaga: ${ostrzezenie}`);
  }
}
