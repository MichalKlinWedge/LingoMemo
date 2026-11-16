import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';

/**
 * Wymawianie słówek głosem telefonu (`expo-speech`).
 *
 * Na webie to samo robi Web Speech API i jest zawodne; tutaj głosy są systemowe, ale wciąż
 * trzeba wiedzieć, CZY jest czym mówić: na części telefonów nie ma głosu dla języka kursu.
 * Bez tej wiedzy dziecko traciłoby gwiazdkę za zadanie ze słuchu, którego jego telefon nie
 * umie przeczytać (pomiar PoC-M2).
 *
 * Lista głosów jest czytana raz na uruchomienie aplikacji — jest długa, a nie zmienia się
 * w trakcie.
 */

let voicesOnce: Promise<Speech.Voice[]> | null = null;

function allVoices(): Promise<Speech.Voice[]> {
  voicesOnce ??= Speech.getAvailableVoicesAsync().catch(() => [] as Speech.Voice[]);
  return voicesOnce;
}

const matches = (voices: Speech.Voice[], lang: string): boolean => {
  const wanted = lang.replace('_', '-').toLowerCase();
  return voices.some((voice) => {
    const have = voice.language.replace('_', '-').toLowerCase();
    return have === wanted || have.slice(0, 2) === wanted.slice(0, 2);
  });
};

export function useSpeak(lang: string) {
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let alive = true;
    void allVoices().then((list) => {
      if (alive) setVoices(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Pusta lista znaczy „nie wiem”, nie „nie ma”: część telefonów nie wydaje spisu głosów,
   * choć mówi. Wtedy lepiej spróbować niż z góry pominąć zadanie.
   */
  const hasVoice = voices === null || voices.length === 0 || matches(voices, lang);

  const speak = useCallback(
    (text: string) => {
      if (text.trim() === '') return;
      Speech.stop();
      setSpeaking(true);
      Speech.speak(text, {
        language: lang,
        onDone: () => setSpeaking(false),
        onStopped: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
    },
    [lang],
  );

  return { speak, speaking, hasVoice, voicesLoaded: voices !== null };
}
