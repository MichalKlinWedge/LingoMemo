/**
 * Błąd z Postgresa na komunikat dla człowieka. Kod `42501` to odmowa RLS — i to jedyny przypadek,
 * w którym użytkownik ma zobaczyć, że czegoś mu nie wolno. Reszta nieznanych błędów ląduje
 * w logu, a na ekran idzie zdanie, z którym da się coś zrobić.
 */
type DbError = { message: string; code?: string | undefined };

/** Kody, których komunikat piszemy sami w funkcjach bazy — wtedy pokazujemy go wprost. */
const OWN_ERROR_CODES = new Set(["22023", "P0001"]);

export function dbErrorMessage(error: DbError, fallback = "Nie udało się wykonać tej operacji. Spróbuj jeszcze raz."): string {
  if (error.code === "42501") {
    return /row-level security|permission denied/i.test(error.message) ? "Nie masz do tego dostępu." : error.message;
  }
  if (error.code !== undefined && OWN_ERROR_CODES.has(error.code)) return error.message;
  if (/fetch failed|failed to fetch|network request failed/i.test(error.message)) {
    return "Brak połączenia z serwerem. Sprawdź internet.";
  }
  console.warn(error);
  return fallback;
}

/** Błąd odczytu na stronie. */
export const dbLoadError = (error: DbError): string =>
  dbErrorMessage(error, "Nie udało się wczytać danych. Odśwież stronę.");
