#!/usr/bin/env node
/**
 * Zakłada pierwszego administratora. To jedyne miejsce w całym projekcie, które używa klucza
 * `service_role` — aplikacja webowa go nie widzi i widzieć nie może, bo omija RLS.
 *
 *   npm run seed:dev -- --email rodzic@dom.local --password "prawdziwe-haslo"
 *   npm run seed:dev -- --email rodzic@dom.local --remote      # hasło z LINGOMEMO_ADMIN_PASSWORD
 *
 * Hasło podane w wierszu poleceń zostaje w historii powłoki — do konta produkcyjnego lepiej
 * użyć zmiennej `LINGOMEMO_ADMIN_PASSWORD`.
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
const password = arg('password') ?? process.env.LINGOMEMO_ADMIN_PASSWORD;

/** Zakończenie bez `process.exit()`: na Windowsie potrafi ono wywrócić Node, gdy klient HTTP
 *  ma jeszcze otwarte gniazda, i prawdziwy komunikat ginie wśród śmieci z libuv. */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
  return undefined;
}

if (!email || !password) {
  throw new Error('Użycie: npm run seed:dev -- --email <adres> --password <hasło> [--remote]');
}

// Supabase odrzuci krótsze; sprawdzamy od razu, żeby nie jechać po to do serwera.
if (password.length < 8) {
  throw new Error('Hasło musi mieć co najmniej 8 znaków (podane: ' + password.length + ').');
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

const host = new URL(url).hostname;
if (!remote && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  throw new Error(`Odmawiam: ${url} nie jest localhostem. Do projektu w chmurze użyj --remote.`);
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
  fail(`Nie udało się założyć konta: ${created.error.message}`);
} else {
  const { error } = await admin.rpc('bootstrap_admin', { p_email: email });
  if (error) {
    // Konto założone przed chwilą, a roli nie udało się nadać (najczęściej: administrator już
    // jest) — kasujemy je, żeby nie zostawiać konta, które powstało bez zaproszenia.
    const newId = created.data?.user?.id;
    if (newId) await admin.auth.admin.deleteUser(newId);
    fail(`Nie udało się nadać roli administratora: ${error.message}`);
  } else {
    console.log(`Administrator gotowy: ${email} (${url})`);
    console.log('Zaloguj się i wygeneruj zaproszenia w /admin/zaproszenia.');
  }
}
