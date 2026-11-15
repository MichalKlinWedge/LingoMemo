import type { ReactNode } from "react";

/**
 * Rama treści — jedna szerokość na wszystkich stronach. Strona nie dobiera sobie własnej,
 * inaczej każdy ekran wygląda trochę inaczej. Margines 1 rem po bokach: na telefonie przyciski
 * nie dotykają krawędzi.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">{children}</main>;
}

/** Zastępnik w `<Suspense>` na czas pobierania danych. */
export function Loading() {
  return (
    <p className="text-zinc-500" role="status">
      Wczytuję…
    </p>
  );
}
