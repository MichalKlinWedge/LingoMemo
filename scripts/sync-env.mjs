#!/usr/bin/env node
/**
 * Jeden `.env.local` w katalogu głównym → `apps/web/.env.local`. Next czyta pliki env tylko ze
 * swojego katalogu, a trzymanie dwóch kopii kończy się rozjazdem. Do aplikacji trafiają zmienne
 * publiczne (`NEXT_PUBLIC_`) i wymienione niżej klucze serwerowe. `SUPABASE_SERVICE_ROLE_KEY`
 * zostaje w katalogu głównym — aplikacja go nie widzi, używają go tylko skrypty z `tools/`.
 *
 *   node scripts/sync-env.mjs           — wartości z .env.local (projekt w chmurze)
 *   node scripts/sync-env.mjs --local   — web na lokalnym Supabase (`npm run db:start`)
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

if (local) {
  const raw = execSync('npx --yes supabase@2.122.0 status -o json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  source.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  source.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  source.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
}

/** Sekrety serwerowe, które aplikacja ma prawo zobaczyć. Service role NIE jest na tej liście. */
const SERVER_KEYS = [];

const entries = Object.entries(source).filter(([key]) => key.startsWith('NEXT_PUBLIC_') || SERVER_KEYS.includes(key));
const body = [
  `# Wygenerowane przez scripts/sync-env.mjs${local ? ' --local' : ''} — edytuj główny .env.local.`,
  ...entries.map(([key, value]) => `${key}=${value}`),
  '',
].join('\n');
writeFileSync(`${root}apps/web/.env.local`, body);

const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter((name) => !source[name]);
console.log(`apps/web/.env.local: ${entries.length} zmiennych${missing.length ? ` (brak: ${missing.join(', ')})` : ''}`);
