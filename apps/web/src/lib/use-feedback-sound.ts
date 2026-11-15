"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

const STORAGE_KEY = "lingomemo:dzwiek";

/** Komponenty nasłuchujące zmiany ustawienia — także w drugiej karcie. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSetting() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Prywatne okno albo zablokowane dane stron.
    return true;
  }
}

/** Na serwerze zakładamy dźwięk włączony — to wartość domyślna, więc nic nie mignie. */
const readServerSetting = () => true;

/**
 * Krótki dźwięk po odpowiedzi — dwie nuty w górę przy trafionej, jedna niska przy chybionej.
 * Generowany przez Web Audio, więc nie ma żadnych plików do pobrania ani do utrzymania.
 *
 * Ustawienie czytamy przez `useSyncExternalStore`, a nie ustawieniem stanu w efekcie: tamto
 * wymusza drugi render zaraz po pierwszym, a przy okazji rozjeżdża się z renderem serwera.
 */
export function useFeedbackSound() {
  const contextRef = useRef<AudioContext | null>(null);
  const enabled = useSyncExternalStore(subscribe, readSetting, readServerSetting);

  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, readSetting() ? "off" : "on");
    } catch {
      // Brak zapisu nie może przerwać lekcji.
    }
    for (const listener of listeners) listener();
  }, []);

  const play = useCallback(
    (kind: "correct" | "wrong") => {
      if (!enabled) return;
      try {
        contextRef.current ??= new AudioContext();
        const context = contextRef.current;
        if (context.state === "suspended") void context.resume();

        const notes = kind === "correct" ? [660, 990] : [233];
        notes.forEach((frequency, index) => {
          const start = context.currentTime + index * 0.11;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency;
          // Łagodne narastanie i wygaszenie — inaczej słychać trzask na końcu.
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + 0.25);
        });
      } catch {
        // Dźwięk jest dodatkiem. Jeśli przeglądarka go nie da, lekcja idzie dalej.
      }
    },
    [enabled],
  );

  return { play, enabled, toggle };
}
