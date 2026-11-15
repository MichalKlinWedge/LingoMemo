/**
 * Polska odmiana liczby mnogiej: 1 słówko, 2 słówka, 5 słówek. `Intl.PluralRules` zwraca dla
 * polskiego właściwą kategorię, ale nie zna odmiany konkretnego rzeczownika — stąd trzy formy.
 */
export type PluralForms = readonly [one: string, few: string, many: string];

export function pluralForm(n: number, forms: PluralForms): string {
  const abs = Math.abs(n);
  if (abs === 1) return forms[0];
  const lastTwo = abs % 100;
  const last = abs % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return forms[1];
  return forms[2];
}

/** Liczba z odmienionym rzeczownikiem: `plural(5, WORDS)` → „5 słówek”. */
export const plural = (n: number, forms: PluralForms): string => `${n} ${pluralForm(n, forms)}`;

export const WORDS: PluralForms = ['słówko', 'słówka', 'słówek'];
export const LESSONS: PluralForms = ['lekcja', 'lekcje', 'lekcji'];
export const POINTS: PluralForms = ['punkt', 'punkty', 'punktów'];
export const STARS: PluralForms = ['gwiazdka', 'gwiazdki', 'gwiazdek'];
export const DAYS: PluralForms = ['dzień', 'dni', 'dni'];
export const EXERCISES: PluralForms = ['zadanie', 'zadania', 'zadań'];
export const ENTRIES: PluralForms = ['zapis', 'zapisy', 'zapisów'];

/**
 * Nazwa w adresie z tytułu: „Dzikie zwierzęta" → „dzikie-zwierzeta".
 *
 * Wynik musi przejść przez ten sam wzorzec, co `slug` w schemacie importu, bo to ta sama
 * wartość w bazie. Polskie znaki rozkładają się przez NFD na literę i znak diakrytyczny —
 * poza „ł", które jest osobną literą i trzeba je podmienić z nazwy.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}
