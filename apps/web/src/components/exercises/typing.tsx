"use client";

import { useEffect, useRef, useState } from "react";

import { SpeakButton } from "./speak-button";
import { type ExerciseProps, str } from "./types";

/**
 * Zadanie z pisaniem: tłumaczenie na polski i odmiana. Porównania dokonuje baza — bez wielkości
 * liter, bez ogonków i z tolerancją jednej literówki — więc tu nie ma żadnej walidacji poza
 * sprawdzeniem, czy dziecko w ogóle coś napisało.
 */
export function TypingExercise({
  exercise,
  locked,
  onAnswer,
  onDraft,
  promptLang,
}: ExerciseProps & { promptLang: string }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isInflection = exercise.type === "inflection";
  const prompt = isInflection ? str(exercise.payload.base) : str(exercise.payload.prompt);

  useEffect(() => {
    inputRef.current?.focus();
  }, [exercise.id]);

  // Gdy w polu coś jest, przebieg lekcji chowa „Nie wiem, pomiń" — ten przycisk wysyła samo
  // pominięcie i nie zagląda do pola, więc kasował wpisaną odpowiedź. Zgłaszamy to przy zmianie
  // pola, a nie efektem: `setState` w efekcie rodzica to kaskada renderów i linter to odbija.
  const change = (text: string) => {
    setValue(text);
    onDraft?.(text.trim() !== "");
  };

  const send = () => {
    if (locked || value.trim() === "") return;
    onAnswer({ text: value });
  };

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="flex flex-col items-center gap-3">
        {isInflection && (
          <p className="chip">{str(exercise.payload.instruction) || str(exercise.payload.formLabel)}</p>
        )}
        <div className="flex items-center gap-3">
          <p style={{ fontSize: "2.5rem", fontWeight: 700 }}>{prompt}</p>
          <SpeakButton text={prompt} lang={promptLang} />
        </div>
      </div>

      <input
        ref={inputRef}
        className="field text-center"
        style={{ fontSize: "1.75rem", minHeight: "4.5rem" }}
        value={value}
        onChange={(event) => change(event.target.value)}
        disabled={locked}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Wpisz odpowiedź"
        aria-label="Twoja odpowiedź"
      />

      {/* Dziecko, które szuka „ż" na klawiaturze, przestaje myśleć o słówku. Baza i tak
          porównuje bez ogonków i bez wielkich liter — warto, żeby o tym wiedziało. */}
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Możesz pisać bez ogonków — „zazolc” liczy się tak samo jak „zażółć”.
      </p>

      <button type="submit" className="btn-primary" disabled={locked || value.trim() === ""}>
        Sprawdź
      </button>
    </form>
  );
}
