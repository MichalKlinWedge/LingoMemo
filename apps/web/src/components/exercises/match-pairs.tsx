"use client";

import { useSpeak } from "@/lib/use-speak";

import { SpeakButton } from "./speak-button";
import { type ExerciseProps, list, str } from "./types";
import { useMatching } from "./use-matching";

/**
 * Dopasowywanie par: dwie kolumny słów, po polsku i w języku kursu. Dziecko dotyka kafelka
 * po jednej stronie i odpowiednika po drugiej — para znika z kolumn i ląduje na liście
 * połączonych. Zaczyna dowolna kolumna, bo nie ma powodu narzucać kierunku.
 *
 * Nie kodujemy par kolorami: przy ośmiu parach i tak byłyby nie do odróżnienia, a dziecko
 * z zaburzeniami widzenia barw zostałoby z niczym.
 */
export function MatchPairsExercise({
  exercise,
  locked,
  onAnswer,
  targetLang,
}: ExerciseProps & { targetLang: string }) {
  const left = list(exercise.payload.pairsLeft);
  const right = list(exercise.payload.pairsRight);
  const { speak } = useSpeak(targetLang);

  const { pairs, used, pick, undo, isPicked } = useMatching(left.length, (done) => onAnswer({ pairs: done }));

  /**
   * Dotknięcie kafelka w prawej kolumnie wymawia słówko — ten sam dźwięk, co z głośnika obok.
   * Tylko prawa: lewa jest w języku dziecka, a wymówienie polskiego słowa angielskim głosem
   * brzmi jak pomyłka. Na wąskim ekranie głośnika nie ma wcale (zabierałby kolumnie szerokość),
   * więc tam dotknięcie jest jedynym sposobem, żeby usłyszeć słówko.
   */
  const pickRight = (item: string) => {
    speak(item);
    pick("b", item);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        {str(exercise.payload.instruction) || "Połącz słówka w pary"}
      </p>

      {pairs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pairs.map((pair) => (
            <li key={pair.a}>
              <button
                type="button"
                className="btn-answer"
                style={{ minHeight: "3.5rem", background: "var(--color-grass-light)", borderColor: "var(--color-grass)" }}
                onClick={() => !locked && undo(pair)}
                disabled={locked}
                aria-label={`Rozłącz parę ${pair.a} — ${pair.b}`}
              >
                <span aria-hidden>✓</span>
                <span className="flex-1">
                  {pair.a} — {pair.b}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <ul className="flex flex-col gap-3">
          {left
            .filter((item) => !used.a.has(item))
            .map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="btn-answer"
                  style={{ minHeight: "3.5rem", fontSize: "1.25rem" }}
                  aria-pressed={isPicked("a", item)}
                  disabled={locked}
                  onClick={() => pick("a", item)}
                >
                  {item}
                </button>
              </li>
            ))}
        </ul>

        <ul className="flex flex-col gap-3">
          {right
            .filter((item) => !used.b.has(item))
            .map((item) => (
              <li key={item} className="flex items-center gap-1">
                <button
                  type="button"
                  className="btn-answer flex-1"
                  style={{ minHeight: "3.5rem", fontSize: "1.25rem" }}
                  aria-pressed={isPicked("b", item)}
                  disabled={locked}
                  onClick={() => pickRight(item)}
                >
                  {item}
                </button>
                {/* Na telefonie głośnik zabierałby prawej kolumnie tyle miejsca, że byłaby
                    wyraźnie węższa od lewej. Słowa słychać w pozostałych zadaniach. */}
                <span className="hidden sm:inline-flex">
                  <SpeakButton text={item} lang={targetLang} />
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
