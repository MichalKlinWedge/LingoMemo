"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wymawianie słówek przez syntezator mowy przeglądarki.
 *
 * Web Speech API jest zawodne i każda z tych pułapek jest prawdziwa:
 * - `getVoices()` przy pierwszym wywołaniu zwraca pustą tablicę; głosy dochodzą później
 *   zdarzeniem `voiceschanged`;
 * - część Androidów nie ma w ogóle głosu dla `en-GB` — wtedy zostaje nagranie z bazy;
 * - iOS odtwarza mowę wyłącznie w odpowiedzi na dotknięcie ekranu, więc nie ma sensu próbować
 *   automatycznie po wejściu na zadanie;
 * - wypowiedź potrafi się urwać przy przejściu karty w tło, stąd `cancel()` przed każdą nową.
 */
export function useSpeak(lang: string) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  // Najpierw dokładne dopasowanie („en-GB”), potem sam język („en”).
  const voice =
    voices.find((v) => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) ??
    voices.find((v) => v.lang.slice(0, 2).toLowerCase() === lang.slice(0, 2).toLowerCase()) ??
    null;

  const speak = useCallback(
    (text: string, audioUrl?: string | null) => {
      // Nagranie bije syntezator tylko wtedy, gdy nie ma głosu dla tego języka.
      if (!voice && audioUrl) {
        audioRef.current?.pause();
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        setSpeaking(true);
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => setSpeaking(false);
        void audio.play().catch(() => setSpeaking(false));
        return;
      }
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      if (voice) utterance.voice = voice;
      // Dla dziecka wolniej niż domyślnie — zdąży usłyszeć każdą głoskę.
      utterance.rate = 0.85;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [lang, voice],
  );

  /**
   * Czy w ogóle da się odtworzyć dźwięk. Dopóki głosy się nie wczytają, zakładamy że tak —
   * inaczej przycisk mrugałby przy każdym wejściu na zadanie.
   */
  const canSpeak = typeof window === "undefined" || "speechSynthesis" in window;

  return { speak, speaking, canSpeak, hasVoice: voice !== null, voicesLoaded: voices.length > 0 };
}
