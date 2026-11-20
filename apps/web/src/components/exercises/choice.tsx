"use client";

import { useEffect, useState } from "react";

import { useSpeak } from "@/lib/use-speak";

import { SpeakButton } from "./speak-button";
import { type ExerciseProps, list, str } from "./types";

/**
 * Zadanie z wyborem: tłumaczenie z listy albo uzupełnianie luki w zdaniu. Odpowiedź leci
 * natychmiast po dotknięciu kafelka — dziecko nie ma potwierdzać wyboru drugim kliknięciem.
 */
export function ChoiceExercise({
  exercise,
  locked,
  onAnswer,
  targetLang,
  result,
}: ExerciseProps & { targetLang: string; result: "correct" | "wrong" | null }) {
  const [picked, setPicked] = useState<string | null>(null);
  const { speak, voicesLoaded } = useSpeak(targetLang);
  const options = list(exercise.payload.options);
  const isBlank = exercise.type === "fill_blank_choice";
  const sentence = str(exercise.payload.sentence);
  const [before, after] = isBlank ? sentence.split("{{blank}}") : ["", ""];

  /**
   * Zdanie z luką odzywa się samo po wejściu — tak samo jak w wersji z wpisywaniem
   * (`typing.tsx`) i jak zadanie ze słuchu. Dwa warianty tego samego zadania mają brzmieć
   * jednakowo; różnica ma być w tym, czy odpowiedź się wskazuje, czy pisze.
   *
   * Czytamy zdanie BEZ brakującego słowa: z nim byłoby to podanie odpowiedzi, a samo „…"
   * część silników czyta na głos jako „kropka kropka kropka". Opcje z listy nie czytają się
   * same — dziecko usłyszy wybraną po dotknięciu kafelka, a cztery pod rząd po wejściu
   * byłyby ścianą dźwięku. Tylko tłumaczenie z listy (`translate_ab`) nie czyta nic: tam
   * polecenie jest po polsku.
   */
  const samoBrzmi = isBlank ? `${before} ${after}`.replace(/\s+/g, " ").trim() : "";

  useEffect(() => {
    if (!voicesLoaded || samoBrzmi === "") return;
    // Zależnością jest `exercise.id`, nie każdy render: po wyborze zadanie zostaje na ekranie
    // z werdyktem, a drugie czytanie w środku sprawdzania brzmiałoby jak usterka.
    const timer = setTimeout(() => speak(samoBrzmi), 250);
    return () => clearTimeout(timer);
  }, [exercise.id, samoBrzmi, voicesLoaded, speak]);

  const pick = (option: string) => {
    if (locked) return;
    setPicked(option);
    // Wybór sam się wymawia — ten sam dźwięk, co z głośnika obok. Dziecko i tak dotyka
    // kafelka, więc usłyszy słówko także wtedy, gdy po głośnik nigdy nie sięga; a dotknięcie
    // to zdarzenie od użytkownika, czyli jedyny moment, w którym iOS w ogóle pozwala mówić.
    // Opcje są tu zawsze w języku uczonym (`fill_blank_choice` i `translate_ab`).
    speak(option);
    onAnswer({ choice: option });
  };

  return (
    <div className="flex flex-col gap-5">
      {isBlank ? (
        <div className="card flex flex-col gap-2 p-5 text-center">
          <p style={{ fontSize: "1.5rem", lineHeight: 1.5 }}>
            {before}
            <span
              className="mx-1 inline-block rounded-xl px-6"
              style={{ background: "var(--color-brand-light)", borderBottom: "3px solid var(--color-brand)" }}
            >
              {picked ?? "…"}
            </span>
            {after}
          </p>
          {str(exercise.payload.translation) && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">{str(exercise.payload.translation)}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center gap-3">
          <p className="text-center" style={{ fontSize: "2.5rem", fontWeight: 700 }}>
            {str(exercise.payload.prompt)}
          </p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {options.map((option) => (
          // Głośnik stoi OBOK kafelka, nie w środku: przycisk w przycisku to nieprawidłowy HTML
          // i czytnik ekranu zgłupiałby, co właściwie czyta.
          <li key={option} className="flex items-center gap-2">
            <button
              type="button"
              className="btn-answer flex-1"
              aria-pressed={picked === option}
              data-state={picked === option && result ? result : undefined}
              disabled={locked && picked !== option}
              onClick={() => pick(option)}
            >
              {option}
            </button>
            <SpeakButton text={option} lang={targetLang} />
          </li>
        ))}
      </ul>
    </div>
  );
}
