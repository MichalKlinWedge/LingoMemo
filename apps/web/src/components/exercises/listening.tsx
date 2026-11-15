"use client";

import { useEffect, useRef, useState } from "react";

import { mediaUrl } from "./media";
import { SpeakButton } from "./speak-button";
import { type ExerciseProps, str } from "./types";
import { useSpeak } from "@/lib/use-speak";

/**
 * Zadanie ze słuchu. Słowa nie widać — dziecko ma je usłyszeć i zapisać.
 *
 * Próbujemy odezwać się sami zaraz po wejściu na zadanie, ale iOS odtwarza mowę wyłącznie
 * po dotknięciu ekranu, więc duży przycisk „Posłuchaj” jest podstawą, a nie dodatkiem.
 */
export function ListeningExercise({ exercise, locked, onAnswer, onSkip }: ExerciseProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const text = str(exercise.payload.speak);
  const lang = str(exercise.payload.lang) || "en-GB";
  // W treści lekcji stoi ścieżka w buckecie, nie adres — adres składamy dopiero tutaj.
  const audioUrl = mediaUrl(str(exercise.payload.audioPath));
  const { speak, hasVoice, voicesLoaded } = useSpeak(lang);

  useEffect(() => {
    inputRef.current?.focus();
    if (!voicesLoaded) return;
    const timer = setTimeout(() => speak(text, audioUrl), 250);
    return () => clearTimeout(timer);
  }, [exercise.id, voicesLoaded, speak, text, audioUrl]);

  const send = () => {
    if (locked || value.trim() === "") return;
    onAnswer({ text: value });
  };

  // Bez głosu i bez nagrania zadania ze słuchu nie da się zrobić uczciwie — mówimy to wprost
  // i przechodzimy dalej BEZ odpowiedzi. Pusta odpowiedź poszłaby do bazy jako błąd, czyli
  // dziecko straciłoby gwiazdkę za to, że jego telefon nie ma głosu dla tego języka.
  if (voicesLoaded && !hasVoice && !audioUrl) {
    return (
      <div className="flex flex-col gap-4">
        <p className="msg-error">
          Ta przeglądarka nie potrafi wymówić tego języka, więc pomijamy zadanie ze słuchu.
          Nie liczy się ani na plus, ani na minus.
        </p>
        <button type="button" className="btn-secondary" onClick={onSkip}>
          Dalej
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <p className="text-center text-zinc-600 dark:text-zinc-400">Posłuchaj i napisz, co słyszysz.</p>
      <SpeakButton text={text} lang={lang} audioUrl={audioUrl} big label="Posłuchaj jeszcze raz" />

      <input
        ref={inputRef}
        className="field text-center"
        style={{ fontSize: "1.75rem", minHeight: "4.5rem" }}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={locked}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder="Co usłyszałeś?"
        aria-label="Twoja odpowiedź"
      />

      <button type="submit" className="btn-primary" disabled={locked || value.trim() === ""}>
        Sprawdź
      </button>
    </form>
  );
}
