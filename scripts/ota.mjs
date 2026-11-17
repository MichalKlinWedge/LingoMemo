#!/usr/bin/env node
/**
 * Poprawka OTA na wskazany kanał EAS, z komunikatem z ostatniego commita.
 *
 *   node scripts/ota.mjs preview   — jedyny kanał Androida, ten sam dla właściciela i dla dzieci
 *
 * Kanał zostaje parametrem, mimo że jest jeden: nazwa i tak musi trafić do `eas update`, a gdyby
 * kiedyś doszedł drugi (choćby `development` do pracy z dev buildem), skrypt jest już na to gotów.
 *
 * Komunikat jest wymagany: `eas update` bez niego zatrzymuje się na pytaniu, a w skrypcie nie
 * ma kto odpowiedzieć. Podanie go z wiersza poleceń przez `npm run ota -- --message "…"` nie
 * działa — npm bierze takie flagi dla siebie i nie przekazuje ich dalej. Dlatego bierzemy temat
 * ostatniego commita: i tak to on mówi, co jedzie na telefon, a numer commita obok pozwala
 * dojść do kodu z pulpitu EAS.
 *
 * Własny komunikat nadal można podać — argumenty po nazwie kanału idą wprost do `eas update`,
 * a gdy jest wśród nich `--message`, swojego nie dokładamy.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [channel, ...rest] = process.argv.slice(2);

if (channel === undefined) {
  console.error('Użycie: node scripts/ota.mjs <kanał EAS> [argumenty eas update]');
  process.exit(1);
}

// `eas update` musi iść z katalogu aplikacji — tam leży `app.json` i `eas.json`.
const mobile = fileURLToPath(new URL('../apps/mobile/', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: mobile, encoding: 'utf8' }).trim();

const message = rest.some((arg) => arg === '--message' || arg === '-m')
  ? []
  : ['--message', `${git('log', '-1', '--pretty=%s')} (${git('rev-parse', '--short', 'HEAD')})`];

/**
 * Wywołanie `npx`. Na Windowsie nie przez `npx.cmd`: Node od wersji 20 odmawia uruchomienia
 * pliku `.cmd` bez powłoki (EINVAL), a powłoka kazałaby samemu cytować komunikat ze spacjami.
 * Zamiast tego uruchamiamy ten sam skrypt Node'em, którym jedzie ten plik.
 */
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const [command, prefix] =
  process.platform === 'win32' && existsSync(npxCli) ? [process.execPath, [npxCli]] : ['npx', []];

try {
  execFileSync(
    command,
    [
      ...prefix,
      'eas-cli@latest',
      'update',
      '--branch',
      channel,
      // Adres bazy i klucz publiczny są po stronie EAS, nie w `.env.local`.
      '--environment',
      'preview',
      '--platform',
      'android',
      '--non-interactive',
      ...message,
      ...rest,
    ],
    { cwd: mobile, stdio: 'inherit' },
  );
} catch (error) {
  // Kod wyjścia znaczy, że `eas update` wypisało już swój błąd — drugi raz, w postaci śladu
  // stosu, nikomu nie pomoże. Brak kodu to potknięcie przy samym uruchomieniu (nie ma czym
  // odpalić `npx`), i o tym trzeba powiedzieć wprost, bo inaczej skrypt milczy.
  if (typeof error.status === 'number') process.exit(error.status);
  console.error(`Nie udało się uruchomić eas-cli: ${error.message}`);
  process.exit(1);
}
