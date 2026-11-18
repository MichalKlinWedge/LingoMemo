import type { ReactNode } from "react";

/**
 * Rama treści — jedna szerokość na wszystkich stronach. Strona nie dobiera sobie własnej,
 * inaczej każdy ekran wygląda trochę inaczej. Margines 1 rem po bokach: na telefonie przyciski
 * nie dotykają krawędzi.
 *
 * Szerokość (`max-w-4xl`, 56 rem) wzięła się z ekranu kursu: kolumna lekcji ma 12 rem, przerwa
 * między nimi 1 rem, więc cztery w rzędzie potrzebują 51 rem treści. Przy 48 rem (`max-w-3xl`)
 * mieściły się trzy i czwarta spadała do następnego rzędu, zostawiając dziurę. Szerzej nie
 * idziemy: 64 rem wpuściłoby piątą kolumnę tylko czasem, a wiersze tekstu na innych stronach
 * zrobiłyby się za długie do czytania.
 */
export function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">{children}</main>;
}

/** Zastępnik w `<Suspense>` na czas pobierania danych. */
export function Loading() {
  return (
    <p className="text-zinc-500" role="status">
      Wczytuję…
    </p>
  );
}
