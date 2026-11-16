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
export const HINTS: PluralForms = ['podpowiedź', 'podpowiedzi', 'podpowiedzi'];
export const UNLOCKS: PluralForms = ['punkt odblokowania', 'punkty odblokowania', 'punktów odblokowania'];
export const ENTRIES: PluralForms = ['zapis', 'zapisy', 'zapisów'];

export const MINUTES: PluralForms = ['minuta', 'minuty', 'minut'];
export const HOURS: PluralForms = ['godzina', 'godziny', 'godzin'];

/**
 * Czas nauki po ludzku: „2 godz. 05 min", „18 min", „< 1 min".
 *
 * Sekund nie pokazujemy nigdzie poza pierwszą minutą — przy czasie liczonym od wejścia do
 * lekcji do jej zakończenia dokładność co do sekundy i tak jest pozorna, a krótsza liczba
 * czyta się szybciej. Minuty po godzinie mają wiodące zero, żeby „2 godz. 5 min" nie wyglądało
 * jak „2,5 godziny".
 *
 * Pierwsza minuta to „< 1 min", a nie „niecała minuta": ta wartość stoi w kolumnie tabeli kont
 * obok „55 min" i pełnym zdaniem rozpychała kolumnę szerzej niż wszystkie pozostałe razem.
 * Wersja do czytania w zdaniu i dla czytnika ekranu jest w `spellDuration`.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return '< 1 min';

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} godz.` : `${hours} godz. ${String(rest).padStart(2, '0')} min`;
}

/** To samo w pełnym brzmieniu, do zdania i do czytnika ekranu: „2 godziny 5 minut". */
export function spellDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return 'niecała minuta';

  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return plural(minutes, MINUTES);
  if (rest === 0) return plural(hours, HOURS);
  return `${plural(hours, HOURS)} ${plural(rest, MINUTES)}`;
}

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
