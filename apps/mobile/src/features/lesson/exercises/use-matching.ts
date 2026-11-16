import { useState } from 'react';

export type MatchPair = { a: string; b: string };

/** Która kolumna: `a` to słowa po polsku, `b` to ich odpowiedniki (napis albo głos). */
export type MatchSide = 'a' | 'b';

/**
 * Łączenie w pary — stan wspólny dla dopasowywania par i dopasowywania ze słuchu. Przepisane
 * z weba (`components/exercises/use-matching.ts`); to czysty React, więc działa bez zmian.
 *
 * Zaczyna dowolna kolumna: dziecko dotyka kafelka po jednej stronie i szuka odpowiednika po
 * drugiej, w którą stronę mu wygodniej. Drugie dotknięcie tej samej kolumny nie łączy niczego,
 * tylko przenosi zaznaczenie; dotknięcie zaznaczonego kafelka je zdejmuje.
 */
export function useMatching(total: number, onComplete: (pairs: MatchPair[]) => void) {
  const [picked, setPicked] = useState<{ side: MatchSide; value: string } | null>(null);
  const [pairs, setPairs] = useState<MatchPair[]>([]);

  const used = {
    a: new Set(pairs.map((pair) => pair.a)),
    b: new Set(pairs.map((pair) => pair.b)),
  };

  const pick = (side: MatchSide, value: string) => {
    if (picked === null) {
      setPicked({ side, value });
      return;
    }
    if (picked.side === side) {
      setPicked(picked.value === value ? null : { side, value });
      return;
    }

    const next = [...pairs, side === 'a' ? { a: value, b: picked.value } : { a: picked.value, b: value }];
    setPicked(null);
    setPairs(next);
    // Komplet par = koniec zadania. Werdykt wydaje baza, nie my.
    if (next.length === total) onComplete(next);
  };

  const undo = (pair: MatchPair) => {
    setPicked(null);
    setPairs(pairs.filter((item) => item.a !== pair.a));
  };

  const isPicked = (side: MatchSide, value: string) => picked?.side === side && picked.value === value;

  return { pairs, used, pick, undo, isPicked };
}
