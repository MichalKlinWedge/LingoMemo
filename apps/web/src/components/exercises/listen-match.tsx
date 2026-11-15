"use client";

import type { Json } from "@lingomemo/db";

import { type ExerciseProps, list, str } from "./types";
import { useMatching } from "./use-matching";
import { useSpeak } from "@/lib/use-speak";

type AudioItem = { text: string; audioPath: string | null };

/** Kafelki do odsłuchania. Tekst jedzie do przeglądarki, bo nie ma czym mówić bez słowa. */
const audioItems = (value: Json | undefined): AudioItem[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
        const text = typeof item.text === "string" ? item.text : "";
        if (text === "") return [];
        return [{ text, audioPath: typeof item.audioPath === "string" ? item.audioPath : null }];
      })
    : [];

/**
 * Dopasowywanie ze słuchu: po lewej głośniki, po prawej słowa po polsku. Dziecko słucha słowa
 * w języku kursu i szuka jego znaczenia — albo odwrotnie, bo zaczyna dowolna kolumna.
 *
 * Kafelki ze słuchem pokazują NUMER, nie tekst. Gdyby pokazywały napis, zadanie przestałoby być
 * ze słuchu — dałoby się je zrobić, nie włączając dźwięku ani razu. Z tego samego powodu numer
 * zostaje na liście połączonych par.
 */
export function ListenMatchExercise({ exercise, locked, onAnswer }: ExerciseProps) {
  const audio = audioItems(exercise.payload.audio);
  const words = list(exercise.payload.words);
  const lang = str(exercise.payload.lang) || "en-GB";
  const { speak, hasVoice, voicesLoaded } = useSpeak(lang);

  const { pairs, used, pick, undo, isPicked } = useMatching(audio.length, (done) => onAnswer({ pairs: done }));

  const numberOf = (text: string) => audio.findIndex((item) => item.text === text) + 1;

  const tap = (item: AudioItem) => {
    if (locked) return;
    // Dotknięcie zawsze odtwarza — także ponowne, bo dziecko zwykle chce usłyszeć jeszcze raz.
    speak(item.text, item.audioPath);
    if (!isPicked("b", item.text)) pick("b", item.text);
  };

  // Bez głosu i bez nagrań zadania ze słuchu nie da się zrobić uczciwie — mówimy to wprost.
  if (voicesLoaded && !hasVoice && !audio.some((item) => item.audioPath)) {
    return (
      <div className="flex flex-col gap-4">
        <p className="msg-error">
          Ta przeglądarka nie potrafi wymówić tego języka, więc pomijamy zadanie ze słuchu.
        </p>
        <button type="button" className="btn-secondary" onClick={() => onAnswer({ pairs: [] })}>
          Dalej
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        {str(exercise.payload.instruction) || "Posłuchaj i dopasuj polskie słowo"}
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
                aria-label={`Rozłącz parę: nagranie ${numberOf(pair.b)} — ${pair.a}`}
              >
                <span aria-hidden>✓</span>
                <span className="flex-1">
                  <span aria-hidden>🔈 </span>
                  {numberOf(pair.b)} — {pair.a}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <ul className="flex flex-col gap-3">
          {audio
            .filter((item) => !used.b.has(item.text))
            .map((item) => (
              <li key={item.text}>
                <button
                  type="button"
                  className="btn-answer"
                  style={{ minHeight: "3.5rem", fontSize: "1.25rem" }}
                  aria-pressed={isPicked("b", item.text)}
                  aria-label={`Posłuchaj nagrania ${numberOf(item.text)}`}
                  disabled={locked}
                  onClick={() => tap(item)}
                >
                  <span aria-hidden>🔈</span>
                  <span aria-hidden>{numberOf(item.text)}</span>
                </button>
              </li>
            ))}
        </ul>

        <ul className="flex flex-col gap-3">
          {words
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
      </div>
    </div>
  );
}
