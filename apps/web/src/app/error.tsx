"use client";

/**
 * Granica błędu dla całej aplikacji. Dziecko nie ma oglądać stosu wywołań — dostaje jedno zdanie
 * i przycisk. Szczegóły idą do konsoli przeglądarki i do logów serwera.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(error);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="text-6xl" aria-hidden>
        🙈
      </span>
      <h1>Coś poszło nie tak</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Nie udało się wczytać tej strony. Spróbuj jeszcze raz — jeśli to się powtórzy, powiedz o tym rodzicowi.
      </p>
      <button type="button" className="btn-primary" onClick={reset}>
        Spróbuj ponownie
      </button>
    </main>
  );
}
