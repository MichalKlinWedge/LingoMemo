/**
 * Motyw przeniesiony z `apps/web/src/app/globals.css` — te same wartości, inna składnia.
 * Jedno miejsce na kolory i wymiary dotyku: komponent nie dobiera sobie własnych.
 *
 * Na razie tylko jasny motyw. Aplikacja ma `userInterfaceStyle: "light"`, bo ekran dla dziecka
 * ma wyglądać tak samo u każdego, a ciemna wersja to osobna robota (`globals.css` ją ma).
 */
export const color = {
  background: '#fffaf2',
  surface: '#ffffff',
  text: '#231f1c',
  muted: '#7b7366',
  line: '#e9e1d4',
  brand: '#7c5cff',
  brandDark: '#6243e6',
  brandLight: '#ece7ff',
  grass: '#1fa463',
  grassLight: '#dcf5e8',
  coral: '#e04a45',
  coralLight: '#fde6e5',
  sun: '#ffc83d',
} as const;

/** Dzieci klikają palcem: najmniejszy przycisk 56, kafel odpowiedzi 72, tekst zadania 20. */
export const size = {
  tap: 56,
  tapAnswer: 72,
  text: 20,
  prompt: 34,
  radius: 16,
  gap: 12,
  pad: 16,
} as const;
