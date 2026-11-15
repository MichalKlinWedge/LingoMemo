"use client";

import { useState } from "react";

import { mediaUrl } from "./media";
import { SpeakButton } from "./speak-button";
import { type ExerciseProps, list, str } from "./types";

/**
 * Wybór obrazka: słowo u góry, pod nim obrazki do dotknięcia. Jedyne zadanie, które dziecko
 * zrobi, zanim nauczy się czytać w obcym języku — odpowiedzią jest obrazek, nie napis.
 *
 * Obrazki opisujemy numerem („Obrazek 2”), nie nazwą pliku: nazwa zwykle zdradza odpowiedź,
 * a czytnik ekranu przeczytałby ją dziecku na głos razem z resztą kafelków.
 */
export function ImageChoiceExercise({
  exercise,
  locked,
  onAnswer,
  targetLang,
  result,
  correctAnswer,
}: ExerciseProps & {
  targetLang: string;
  result: "correct" | "wrong" | null;
  /** Ścieżka właściwego obrazka — przychodzi z bazy dopiero po błędnej odpowiedzi. */
  correctAnswer: string | null;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  // Ścieżki obrazków, których przeglądarka nie wczytała. Pusty kafelek wygląda jak dziura
  // w układzie — dziecko klika w nicość, a administrator nie wie, że czegoś brakuje.
  const [broken, setBroken] = useState<string[]>([]);
  const options = list(exercise.payload.options);
  const prompt = str(exercise.payload.prompt);
  const speak = str(exercise.payload.speak);
  const lang = str(exercise.payload.lang) || targetLang;

  const pick = (option: string) => {
    if (locked) return;
    setPicked(option);
    onAnswer({ choice: option });
  };

  const stateOf = (option: string): "correct" | "wrong" | undefined => {
    if (result === null) return undefined;
    if (option === correctAnswer) return "correct";
    if (option === picked) return result;
    return undefined;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-center gap-3">
        <p className="text-center" style={{ fontSize: "2.5rem", fontWeight: 700 }}>
          {prompt}
        </p>
        {speak !== "" && <SpeakButton text={speak} lang={lang} />}
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {options.map((option, index) => (
          <li key={option}>
            <button
              type="button"
              className="btn-answer"
              style={{ flexDirection: "column", padding: "0.75rem", height: "100%" }}
              aria-pressed={picked === option}
              aria-label={`Obrazek ${index + 1}`}
              data-state={stateOf(option)}
              disabled={locked && picked !== option}
              onClick={() => pick(option)}
            >
              {broken.includes(option) ? (
                <span
                  className="flex w-full flex-col items-center justify-center gap-1 rounded-xl"
                  style={{ aspectRatio: "1 / 1", background: "var(--color-zinc-100)" }}
                >
                  <span className="text-4xl" aria-hidden>
                    🖼
                  </span>
                  <span className="px-1 text-center font-mono text-sm text-zinc-600 dark:text-zinc-400">
                    brak pliku
                    <br />
                    {option}
                  </span>
                </span>
              ) : (
                /* Zwykły <img>, nie next/image: obrazki wgrywa administrator w trakcie
                   działania aplikacji, więc nie ma ich czym zoptymalizować przy budowaniu. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={mediaUrl(option) ?? ""}
                  alt=""
                  style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain" }}
                  draggable={false}
                  onError={() => setBroken((było) => (było.includes(option) ? było : [...było, option]))}
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
