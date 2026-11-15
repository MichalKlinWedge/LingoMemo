#!/usr/bin/env node
/**
 * Obrazek Open Graph — miniatura, którą pokazuje komunikator po wklejeniu linku
 * z zaproszeniem. Bez niego rodzic dostaje w czacie samo „lingo-memo.vercel.app".
 *
 * Uruchomienie: `node scripts/og-image.mjs` (po zmianie ikony albo nazwy).
 * Wymaga internetu: font Baloo 2 pobierany jest z Google Fonts.
 *
 * Dlaczego gotowy PNG w repozytorium, a nie `app/opengraph-image.tsx` generowany przy
 * każdym wdrożeniu: obrazek zmienia się raz na rok, a trasa generująca dokładałaby do
 * builda pobieranie fontu — jeden timeout u Google i wdrożenie pada. Tutaj najwyżej
 * nie przeliczy się plik na moim dysku.
 *
 * Dlaczego nie `sharp` jak przy ikonach: jego renderer SVG (librsvg) ignoruje `@font-face`
 * i rysuje tekst wyłącznie fontami zainstalowanymi w systemie — „LingoMemo" wychodziło
 * szeryfowym Times zamiast firmowym Baloo. `ImageResponse` (satori) przyjmuje plik fontu
 * wprost, więc napis jest tą samą czcionką, co nagłówki w aplikacji.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `next/og.js` z rozszerzeniem: bez niego Node szuka katalogu `next/og` i nie znajduje go.
import { ImageResponse } from 'next/og.js';

const katalog = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
const wyjscie = join(katalog, 'src', 'app', 'opengraph-image.png');

/** Rozmiar zalecany przez Facebooka i Slacka; mniejszy bywa przycinany. */
const SZEROKOSC = 1200;
const WYSOKOSC = 630;

const TLO = '#fffaf2';
const MARKA = '#7c5cff';
const TEKST = '#231f1c';
const TEKST_SLABY = '#5d564b';

/** Ta sama rodzina, co nagłówki w aplikacji (`--font-display` w `globals.css`). */
const CSS_FONTU = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;800';

/** Google oddaje TTF dopiero przeglądarce, która nie zna woff2 — satori woff2 i tak nie czyta. */
async function pobierzFont(waga) {
  const css = await fetch(CSS_FONTU, { headers: { 'user-agent': 'Mozilla/5.0' } }).then((r) => r.text());
  const blok = css.split('@font-face').find((part) => part.includes(`font-weight: ${waga}`));
  const adres = blok?.match(/url\((https:\/\/[^)]+\.ttf)\)/)?.[1];
  if (!adres) throw new Error(`Nie znalazłem pliku TTF dla grubości ${waga} w odpowiedzi Google Fonts.`);
  return Buffer.from(await fetch(adres).then((r) => r.arrayBuffer()));
}

const [gruby, zwykly, ikona] = await Promise.all([
  pobierzFont(800),
  pobierzFont(500),
  readFile(join(katalog, 'public', 'ikony', 'ikona-512.png')),
]);

/**
 * Układ bez JSX, bo to zwykły skrypt Node: satori przyjmuje ten sam kształt obiektu,
 * który React tworzy z JSX.
 */
const element = {
  type: 'div',
  props: {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 56,
      background: TLO,
      // Pasek u dołu: w liście czatów karta jest mała i to po nim widać, czyj to link.
      borderBottom: `20px solid ${MARKA}`,
      fontFamily: 'Baloo 2',
    },
    children: [
      {
        type: 'img',
        props: { src: `data:image/png;base64,${ikona.toString('base64')}`, width: 260, height: 260 },
      },
      {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column' },
          children: [
            {
              type: 'div',
              props: { style: { fontSize: 104, fontWeight: 800, color: TEKST, lineHeight: 1.1 }, children: 'LingoMemo' },
            },
            {
              type: 'div',
              props: {
                style: { fontSize: 42, fontWeight: 500, color: TEKST_SLABY, marginTop: 8 },
                children: 'Nauka słówek i zwrotów dla dzieci',
              },
            },
          ],
        },
      },
    ],
  },
};

const odpowiedz = new ImageResponse(element, {
  width: SZEROKOSC,
  height: WYSOKOSC,
  fonts: [
    { name: 'Baloo 2', data: gruby, weight: 800, style: 'normal' },
    { name: 'Baloo 2', data: zwykly, weight: 500, style: 'normal' },
  ],
});

const png = Buffer.from(await odpowiedz.arrayBuffer());
await writeFile(wyjscie, png);
console.log(`opengraph-image.png  ${SZEROKOSC}x${WYSOKOSC}  ${(png.length / 1024).toFixed(1)} kB`);
