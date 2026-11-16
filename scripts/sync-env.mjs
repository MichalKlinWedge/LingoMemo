#!/usr/bin/env node
/**
 * Jeden `.env.local` w katalogu głównym → `apps/web/.env.local` i `apps/mobile/.env.local`.
 * Next i Expo czytają pliki env tylko z katalogu swojej aplikacji, a trzymanie trzech kopii kończy
 * się rozjazdem. Do aplikacji trafiają zmienne publiczne (`NEXT_PUBLIC_` dla weba, `EXPO_PUBLIC_`
 * dla telefonu — przepisywane z tych samych wartości) i wymienione niżej klucze serwerowe.
 * `SUPABASE_SERVICE_ROLE_KEY` zostaje w katalogu głównym — żadna aplikacja go nie widzi,
 * używają go tylko skrypty z `tools/`.
 *
 *   node scripts/sync-env.mjs           — wartości z .env.local (projekt w chmurze)
 *   node scripts/sync-env.mjs --mobile  — tylko plik telefonu (nie rusza weba)
 *   node scripts/sync-env.mjs --local   — web na lokalnym Supabase (`npm run db:start`);
 *                                         telefon i tak dostaje adres z chmury
 *
 * Wartości nie są wypisywane. Pliki wynikowe są w .gitignore (`.env*.local`).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = process.argv.includes('--local');

function parse(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && match[2] !== '') vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

const source = existsSync(`${root}.env.local`) ? parse(readFileSync(`${root}.env.local`, 'utf8')) : {};
/** Wartości z chmury — zapamiętane przed podmianą na lokalne, bo telefon zawsze idzie do chmury. */
const cloud = { ...source };

if (local) {
  const raw = execSync('npx --yes supabase@2.122.0 status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  source.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  source.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  source.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
}

/** Sekrety serwerowe, które aplikacja ma prawo zobaczyć. Service role NIE jest na tej liście. */
const SERVER_KEYS = [];

/**
 * Telefon czyta zmienne z przedrostkiem `EXPO_PUBLIC_`, a wartości mają być te same co na webie —
 * dlatego przepisujemy je z `NEXT_PUBLIC_`, zamiast trzymać drugą kopię w głównym pliku. Wpis
 * `EXPO_PUBLIC_*` wprost w głównym `.env.local` ma pierwszeństwo.
 */
const MOBILE_DERIVED = {
  EXPO_PUBLIC_SUPABASE_URL: 'NEXT_PUBLIC_SUPABASE_URL',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
};

const targets = [
  { file: 'apps/web/.env.local', prefix: 'NEXT_PUBLIC_', server: SERVER_KEYS, derived: {}, local: true },
  // Telefon nie zobaczy adresu 127.0.0.1 komputera, więc aplikacja na telefonie zawsze idzie
  // do chmury — `--local` jej nie dotyczy.
  { file: 'apps/mobile/.env.local', prefix: 'EXPO_PUBLIC_', server: [], derived: MOBILE_DERIVED, local: false },
];

/**
 * `--mobile` pisze TYLKO plik telefonu. Bez tego `npm run mobile` przepisywałby po drodze
 * `apps/web/.env.local` na wartości z chmury i działający obok `npm run web:local` po cichu
 * przestawiałby się na bazę w chmurze.
 */
const onlyMobile = process.argv.includes('--mobile');

for (const { file, prefix, server, derived, local: useLocal } of targets) {
  if (onlyMobile && !file.includes('apps/mobile')) continue;
  if (!existsSync(`${root}${file.slice(0, file.lastIndexOf('/'))}`)) continue;
  const from = useLocal ? source : cloud;
  const vars = Object.fromEntries(Object.entries(from).filter(([key]) => key.startsWith(prefix) || server.includes(key)));
  for (const [key, origin] of Object.entries(derived)) {
    if (vars[key] === undefined && from[origin] !== undefined) vars[key] = from[origin];
  }
  const body = [
    `# Wygenerowane przez scripts/sync-env.mjs${local && useLocal ? ' --local' : ''} — edytuj główny .env.local.`,
    ...Object.entries(vars).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
  writeFileSync(`${root}${file}`, body);
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].map((name) => prefix + name).filter((name) => vars[name] === undefined);
  console.log(`${file}: ${Object.keys(vars).length} zmiennych${missing.length ? ` (brak: ${missing.join(', ')})` : ''}`);
}
