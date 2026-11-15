import { describe, expect, it } from 'vitest';

import { slugify } from '../format.ts';

/** Ten sam wzorzec, co `slug` w schemacie importu — adres musi go przejść. */
const WZORZEC = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('slugify', () => {
  it('zamienia tytuł na adres', () => {
    expect(slugify('Dzikie zwierzeta')).toBe('dzikie-zwierzeta');
    expect(slugify('How do you spell that')).toBe('how-do-you-spell-that');
  });

  it('radzi sobie z polskimi znakami', () => {
    expect(slugify('Dzikie zwierzęta')).toBe('dzikie-zwierzeta');
    expect(slugify('Żółty')).toBe('zolty');
    expect(slugify('Łódka na rzece')).toBe('lodka-na-rzece');
    expect(slugify('Ćwiczenia')).toBe('cwiczenia');
    expect(slugify('Gęś i Ósemka')).toBe('ges-i-osemka');
  });

  it('zbija znaki interpunkcyjne i nadmiarowe spacje w jeden myślnik', () => {
    expect(slugify('  Kolory:   czerwony,  niebieski!  ')).toBe('kolory-czerwony-niebieski');
    expect(slugify('1, 2, 3 — liczby')).toBe('1-2-3-liczby');
  });

  it('nie zostawia myślnika na początku ani na końcu', () => {
    expect(slugify('— Zwierzęta —')).toBe('zwierzeta');
    expect(slugify('!!!')).toBe('');
  });

  it('wynik zawsze pasuje do wzorca albo jest pusty', () => {
    for (const tytul of ['Zwierzęta domowe', 'Od 1 do 5', 'Łąka', '???', 'ŻÓŁW']) {
      const wynik = slugify(tytul);
      expect(wynik === '' || WZORZEC.test(wynik)).toBe(true);
    }
  });

  it('ucina bardzo długie tytuły, nie zostawiając myślnika na końcu', () => {
    const wynik = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(wynik.length).toBeLessThanOrEqual(60);
    expect(wynik.endsWith('-')).toBe(false);
  });
});
