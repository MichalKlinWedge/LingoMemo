#!/usr/bin/env node
/**
 * Flagi dla telefonu: `apps/web/public/flagi/*.svg` → `apps/mobile/assets/flagi/*.png`.
 *
 * Uruchomienie: `npm run gen:flags` (po dołożeniu albo poprawieniu flagi na webie).
 *
 * Skąd w ogóle obrazki, skoro w bazie stoi emoji flagi (`courses.icon`): nie każdy system je
 * rysuje. Windows nie umie flag z par liter regionalnych w ogóle, a na części Androidów brakuje
 * pojedynczych — zamiast flagi widać wtedy napis „GB". Web rozwiązał to plikami SVG już wcześniej
 * (`apps/web/src/components/flag.tsx`); telefon dostaje te same rysunki, tyle że w PNG.
 *
 * Dlaczego PNG, a nie te same SVG: wbudowany `Image` Reacta Native nie zna SVG, a `expo-image`
 * to moduł natywny — flagi zniknęłyby w każdej wersji aplikacji starszej niż on. Rysunek flagi
 * jest kilkoma prostokątami, więc PNG w rozmiarze potrzebnym na ekranie waży tyle co nic.
 *
 * Szerokość 192 px starcza z zapasem: największa flaga na ekranie ma 56 px, a najgęstsze ekrany
 * telefonów pokazują trzy piksele na punkt.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zrodlo = join(root, 'apps', 'web', 'public', 'flagi');
const cel = join(root, 'apps', 'mobile', 'assets', 'flagi');

const SZEROKOSC = 192;

await mkdir(cel, { recursive: true });

const pliki = (await readdir(zrodlo)).filter((nazwa) => nazwa.endsWith('.svg'));

for (const nazwa of pliki) {
  const kod = nazwa.replace(/\.svg$/, '');
  const png = await sharp(join(zrodlo, nazwa), { density: 300 })
    .resize({ width: SZEROKOSC })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(cel, `${kod}.png`), png);
  console.log(`flagi/${kod}.png — ${png.length} B`);
}

console.log(`Gotowe: ${pliki.length} flag w apps/mobile/assets/flagi.`);
