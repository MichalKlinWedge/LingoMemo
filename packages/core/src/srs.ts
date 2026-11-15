/**
 * Powtórki interwałowe — FSRS-6 (Free Spaced Repetition Scheduler).
 *
 * Sam algorytm liczy baza (`fsrs_next_state` w migracji `…_srs.sql`), bo ocena odpowiedzi, punkty
 * i stan powtórek muszą zmienić się w jednej transakcji. Tutaj są wyłącznie te wartości, które
 * muszą być identyczne po obu stronach, oraz tłumaczenie wyniku zadania na ocenę FSRS.
 *
 * Zgodność implementacji w SQL z implementacją referencyjną pilnuje `scripts/fsrs-fixtures.mjs`:
 * generuje przypadki z pakietu `ts-fsrs` do `supabase/tests/_fsrs_cases.sql`, a test pgTAP
 * porównuje je z tym, co liczy baza. Po zmianie wag trzeba przegenerować przypadki.
 */

/** Oceny FSRS. Nazwy jak w algorytmie, żeby dało się je zestawić z dokumentacją. */
export const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const;
export type Rating = (typeof RATING)[keyof typeof RATING];

/**
 * Domyślne wagi FSRS-6 (w0…w20). Skopiowane z implementacji referencyjnej — test `srs.test.ts`
 * sprawdza, że nadal się zgadzają. Wagi można później dostroić na własnych danych; wtedy zmienia
 * się wiersz w tabeli `srs_params`, a nie ta stała.
 */
export const FSRS6_DEFAULT_WEIGHTS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;

/** Granice stabilności i trudności, poza które algorytm nie wychodzi. */
export const FSRS6_BOUNDS = { sMin: 0.001, sMax: 36500, dMin: 1, dMax: 10 } as const;

/**
 * Docelowa retencja: jakie prawdopodobieństwo przypomnienia ma być w dniu powtórki. 0,9 to
 * wartość domyślna algorytmu. Niżej = rzadsze powtórki i więcej zapominania, wyżej = więcej
 * pracy. Sensowny zakres to 0,7–0,97.
 */
export const DESIRED_RETENTION = 0.9;

/**
 * Czas, poniżej którego poprawna odpowiedź jest „łatwa”. Dotyczy tylko zadań na jedno dotknięcie
 * — przy pisaniu z klawiatury czas mówi więcej o sprawności palców dziecka niż o pamięci.
 */
export const QUICK_ANSWER_MS = 4000;

export type AttemptResult = {
  correct: boolean;
  /** Poprawna odpowiedź z tolerowaną literówką — dziecko wie, ale pamięta słabiej. */
  nearMiss?: boolean;
  hintUsed?: boolean;
  responseMs?: number | null;
  /** Zadanie na jedno dotknięcie (wybór z listy, dopasowanie), a nie pisanie. */
  singleTap?: boolean;
};

/**
 * Wynik zadania na ocenę FSRS. Aplikacja nie zna czterostopniowej skali Anki — dziecko nie ocenia
 * własnej pamięci, więc ocenę wyprowadzamy z tego, co widać: czy odpowiedź jest poprawna, czy
 * była literówka, czy sięgnęło po podpowiedź i jak szybko odpowiedziało.
 */
export function gradeFor(result: AttemptResult): Rating {
  if (!result.correct) return RATING.again;
  if (result.nearMiss === true || result.hintUsed === true) return RATING.hard;
  if (
    result.singleTap === true &&
    typeof result.responseMs === 'number' &&
    result.responseMs <= QUICK_ANSWER_MS
  ) {
    return RATING.easy;
  }
  return RATING.good;
}
