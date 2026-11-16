/**
 * Nazwa kubełka z obrazkami do słówek.
 *
 * Osobny plik, bo `"use server"` pozwala eksportować wyłącznie funkcje asynchroniczne —
 * stała obok akcji wywracała build Turbopacka („Only async functions are allowed to be
 * exported in a 'use server' file"), i to tak, że cały moduł przestawał się kompilować,
 * a razem z nim akcje, które w nim zostały. `npm run check` tego nie łapie: typecheck ani
 * lint nie znają tej reguły, widzi ją dopiero `next build`.
 */
export const BUCKET = "lesson-media";
