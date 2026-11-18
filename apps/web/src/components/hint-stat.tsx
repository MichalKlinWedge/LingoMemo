"use client";

import { usePathname } from "next/navigation";

import { HINTS, plural } from "@lingomemo/core";

/**
 * Znacznik podpowiedzi w pasku — wszędzie poza lekcją.
 *
 * W lekcji liczbę pokazuje jej własny pasek i robi to na bieżąco: po wzięciu podpowiedzi
 * zmienia się od razu, bo liczbę oddaje ta sama akcja, która podpowiedź wydaje. Pasek strony
 * jest składany na serwerze i tej zmiany by nie zauważył, więc w lekcji stałyby obok siebie
 * dwie liczby, z czego jedna nieprawdziwa. Dlatego tutaj go po prostu nie ma.
 *
 * Zero pokazujemy, w odróżnieniu od punktów odblokowania: „💡 0" mówi dziecku, czemu przycisk
 * podpowiedzi w lekcji jest szary, a pula wraca dopiero jutro.
 */
export function HintStat({ value }: { value: number }) {
  const pathname = usePathname();
  if (pathname.startsWith("/lekcja/")) return null;

  const label = `podpowiedzi na dziś: ${plural(value, HINTS)}`;
  return (
    <span className="chip" title={label} aria-label={label} role="img">
      <span aria-hidden>💡 {value}</span>
    </span>
  );
}
