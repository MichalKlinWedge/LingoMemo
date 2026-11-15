#!/usr/bin/env node
/**
 * Zakłada pierwszego administratora. To jedyne miejsce w całym projekcie, które używa klucza
 * `service_role` — aplikacja webowa go nie widzi i widzieć nie może, bo omija RLS.
 *
 *   npm run seed:dev -- --email rodzic@dom.local --password "..."
 *   npm run seed:dev -- --email ... --password ... --remote    # projekt w chmurze
 *
 * Bez `--remote` skrypt odmawia pracy poza localhostem. Samo nadanie roli robi funkcja
 * `bootstrap_admin`, która działa wyłącznie wtedy, gdy nie ma jeszcze żadnego administratora —
 * kolejnych zaprasza się linkiem z panelu.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);

function arg(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const remote = args.includes('--remote');
const email = arg('email');
const password = arg('password');

if (!email || !password) {
  console.error('Użycie: npm run seed:dev -- --email <adres> --password <hasło> [--remote]');
  process.exit(1);
}

function parseEnv(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && match[2] !== '') vars[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
}

let url;
let serviceKey;

if (remote) {
  const env = existsSync(`${root}.env.local`) ? parseEnv(readFileSync(`${root}.env.local`, 'utf8')) : {};
  url = env.NEXT_PUBLIC_SUPABASE_URL;
  serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('W .env.local brakuje NEXT_PUBLIC_SUPABASE_URL albo SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
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

const host = new URL(url).hostname;
if (!remote && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error(`Odmawiam: ${url} nie jest localhostem. Do projektu w chmurze użyj --remote.`);
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// `bootstrap: true` w app_metadata przepuszcza hook rejestracji — to pole ustawia wyłącznie
// service_role, więc nie jest furtką dla nikogo z zewnątrz.
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { bootstrap: true },
  user_metadata: { display_name: email.split('@')[0] },
});

if (created.error && !/already been registered|already exists/i.test(created.error.message)) {
  console.error(`Nie udało się założyć konta: ${created.error.message}`);
  process.exit(1);
}

const { error } = await admin.rpc('bootstrap_admin', { p_email: email });
if (error) {
  console.error(`Nie udało się nadać roli administratora: ${error.message}`);
  process.exit(1);
}

console.log(`Administrator gotowy: ${email} (${url})`);
console.log('Zaloguj się i wygeneruj zaproszenia w /admin/zaproszenia.');
