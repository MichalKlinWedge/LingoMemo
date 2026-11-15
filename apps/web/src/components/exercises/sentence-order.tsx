"use client";

import { useState } from "react";

import { type ExerciseProps, list, str } from "./types";

/** Klocek ze słowem. Osobno, żeby słowo w zdaniu i w rozsypance wyglądało tak samo. */
function Token({
  word,
  onClick,
  disabled,
  dimmed = false,
}: {
  word: string;
  onClick: () => void;
  disabled: boolean;
  dimmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border-2 px-4 font-semibold transition-colors"
      style={{
        minHeight: "3.25rem",
        fontSize: "1.25rem",
        borderBottomWidth: "4px",
        borderColor: dimmed ? "var(--line)" : "var(--color-brand)",
        background: dimmed ? "var(--color-zinc-100)" : "var(--color-brand-light)",
        color: "var(--foreground)",
      }}
    >
      {word}
    </button>
  );
}

/**
 * Rozsypanka słowna. Dotknięcie klocka przenosi go do zdania, dotknięcie w zdaniu — z powrotem
 * do puli. Bez przeciągania: na tablecie przeciąganie jest dla dziecka trudniejsze niż dotknięcie,
 * a myszą i klawiaturą działa tak samo.
 *
 * Te same słowa mogą wystąpić dwa razy („the cat and the dog”), więc klocki rozróżniamy po
 * pozycji w puli, a nie po treści.
 */
export function SentenceOrderExercise({ exercise, locked, onAnswer }: ExerciseProps) {
  const tokens = list(exercise.payload.tokens);
  const [order, setOrder] = useState<number[]>([]);

  const used = new Set(order);
  const add = (index: number) => {
    if (locked) return;
    setOrder([...order, index]);
  };
  const remove = (position: number) => {
    if (locked) return;
    setOrder(order.filter((_, at) => at !== position));
  };

  const complete = order.length === tokens.length;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-center" style={{ fontSize: "1.375rem", fontWeight: 600 }}>
        {str(exercise.payload.prompt) || "Ułóż zdanie"}
      </p>

      {/* Linia zdania — widoczna także pusta, żeby było wiadomo, gdzie lądują słowa. */}
      <div
        className="flex min-h-20 flex-wrap items-center gap-2 rounded-2xl border-2 border-dashed p-3"
        style={{ borderColor: "var(--line)" }}
        aria-label="Twoje zdanie"
      >
        {order.length === 0 && <span className="px-2 text-zinc-400">Dotknij słów po kolei…</span>}
        {order.map((tokenIndex, position) => (
          <Token
            key={`${tokenIndex}-${position}`}
            word={tokens[tokenIndex] ?? ""}
            onClick={() => remove(position)}
            disabled={locked}
          />
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-2" aria-label="Słowa do wyboru">
        {tokens.map((word, index) =>
          used.has(index) ? null : (
            <Token key={index} word={word} onClick={() => add(index)} disabled={locked} dimmed />
          ),
        )}
      </div>

      <button
        type="button"
        className="btn-primary"
        disabled={locked || !complete}
        onClick={() => onAnswer({ tokens: order.map((index) => tokens[index] ?? "") })}
      >
        Sprawdź
      </button>
    </div>
  );
}
