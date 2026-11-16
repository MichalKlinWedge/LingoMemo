import { type DbError, dbErrorMessage } from "@lingomemo/core";

/**
 * Komunikat błędu bazy mieszka w `packages/core` — tę samą funkcję woła aplikacja na telefonie.
 * Tutaj zostaje tylko re-eksport (żeby nie przepisywać importów w kilkudziesięciu plikach)
 * i wariant dla strony, który mówi o odświeżeniu — na telefonie nie ma czego odświeżać.
 */
export { dbErrorMessage };

/** Błąd odczytu na stronie. */
export const dbLoadError = (error: DbError): string =>
  dbErrorMessage(error, "Nie udało się wczytać danych. Odśwież stronę.");
