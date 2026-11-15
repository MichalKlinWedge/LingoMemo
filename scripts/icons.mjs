#!/usr/bin/env node
/**
 * Warianty ikony aplikacji z jednego wzorca `apps/web/public/ikony/ikona.svg`.
 *
 * Uruchomienie: `node scripts/icons.mjs` (po każdej zmianie wzorca).
 *
 * Dlaczego w ogóle PNG, skoro SVG jest ostrzejsze: Apple nie przyjmuje SVG jako
 * `apple-touch-icon`, instalatory PWA na Androidzie chcą 192 i 512 px, a część narzędzi
 * i czytników pyta wprost o `/favicon.ico`. Każdy z tych plików powstaje tutaj, żeby nie
 * rozjechał się z resztą po pierwszej poprawce rysunku.
 *
 * Dwa warianty tego samego rysunku:
 *  - z zaokrąglonymi rogami — tam, gdzie system pokazuje obrazek bez obróbki (zakładka, .ico),
 *  - z rogami prostymi — tam, gdzie system sam przycina (iOS, ikona maskowalna Androida).
 *    Podanie zaokrąglonego obrazka do przycięcia daje brzydką podwójną ramkę.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const katalog = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');
const wzorzec = join(katalog, 'ikony', 'ikona.svg');

/** Kolor tła z `globals.css` — musi być ten sam, co `rect` we wzorcu. */
const TLO = '#7c5cff';

/** Ikona maskowalna: Android przycina do 80% szerokości, więc rysunek musi zmieścić się w środku. */
const BEZPIECZNY_OBSZAR = 0.8;

const svg = await readFile(wzorzec, 'utf8');
/** Ten sam rysunek bez zaokrąglenia — podstawa dla wariantów, które system przycina sam. */
const svgProsty = svg.replace(/rx="112"/, 'rx="0"');

/** SVG -> PNG w zadanym rozmiarze. */
function render(zrodlo, rozmiar) {
  return sharp(Buffer.from(zrodlo), { density: 384 }).resize(rozmiar, rozmiar).png({ compressionLevel: 9 }).toBuffer();
}

async function zapisz(nazwa, dane) {
  await writeFile(join(katalog, nazwa), dane);
  console.log(`${nazwa}  ${(dane.length / 1024).toFixed(1)} kB`);
}

/**
 * Plik .ico to nagłówek i katalog wpisów, a w środku — w nowoczesnym wariancie — zwykłe PNG.
 * Pakujemy sami: `sharp` nie zapisuje .ico, a dokładanie zależności dla jednego pliku
 * trzydziestoliniowego nie ma sensu.
 */
function ico(obrazki) {
  const naglowek = Buffer.alloc(6);
  naglowek.writeUInt16LE(0, 0); // zarezerwowane
  naglowek.writeUInt16LE(1, 2); // typ: ikona
  naglowek.writeUInt16LE(obrazki.length, 4);

  let offset = 6 + obrazki.length * 16;
  const katalogWpisow = obrazki.map(({ rozmiar, dane }) => {
    const wpis = Buffer.alloc(16);
    // 256 px zapisuje się jako 0 — bajt nie pomieści większej liczby.
    wpis.writeUInt8(rozmiar >= 256 ? 0 : rozmiar, 0);
    wpis.writeUInt8(rozmiar >= 256 ? 0 : rozmiar, 1);
    wpis.writeUInt8(0, 2); // paleta: brak
    wpis.writeUInt8(0, 3); // zarezerwowane
    wpis.writeUInt16LE(1, 4); // płaszczyzny
    wpis.writeUInt16LE(32, 6); // bitów na piksel
    wpis.writeUInt32LE(dane.length, 8);
    wpis.writeUInt32LE(offset, 12);
    offset += dane.length;
    return wpis;
  });

  return Buffer.concat([naglowek, ...katalogWpisow, ...obrazki.map((item) => item.dane)]);
}

// --- warianty bez obróbki przez system ---
await zapisz('ikony/ikona-192.png', await render(svg, 192));
await zapisz('ikony/ikona-512.png', await render(svg, 512));

// --- warianty, które system przycina sam ---
await zapisz('ikony/ikona-apple-180.png', await render(svgProsty, 180));

const srodek = Math.round(512 * BEZPIECZNY_OBSZAR);
await zapisz(
  'ikony/ikona-maskowalna-512.png',
  await sharp({ create: { width: 512, height: 512, channels: 4, background: TLO } })
    .composite([{ input: await render(svgProsty, srodek), gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// --- favicon.ico w katalogu głównym: tam go szukają przeglądarki i czytniki ---
const rozmiaryIco = [16, 32, 48];
await zapisz(
  'favicon.ico',
  ico(await Promise.all(rozmiaryIco.map(async (rozmiar) => ({ rozmiar, dane: await render(svg, rozmiar) })))),
);
