"use client";

import { useState } from "react";

import { mediaUrl } from "@/components/exercises/media";
import { useSpeak } from "@/lib/use-speak";

/** Jedno słówko na planszy — dokładnie to, co strona przekazuje do przeglądarki. */
export type BoardWord = {
  conceptId: string;
  /** Emoji z `concepts.tags` albo pusty napis. */
  emoji: string;
  /** Ścieżka obrazka w buckecie, jeśli słówko go ma. */
  imagePath: string | null;
  /** Słowo w języku dziecka. */
  source: string;
  /** Słowo w języku uczonym — to, które dziecko słyszy. */
  target: string;
  /** Zapis fonetyczny, jeśli ktoś go wpisał przy imporcie. */
  ipa: string | null;
  /** Nagranie z bazy; wchodzi w grę, gdy przeglądarka nie ma głosu dla tego języka. */
  audioPath: string | null;
};

/**
 * Plansza ze słówkami lekcji — tryb nauki przed lekcją.
 *
 * Nic tu nie jest sprawdzane i nic nie wchodzi do powtórek: dziecko dotyka słowa, słyszy je
 * i czyta tłumaczenie. Lekcja dalej jest jedynym miejscem, w którym liczą się odpowiedzi.
 *
 * Cała karta jest przyciskiem, nie głośnik w jej narożniku: dziecko dotyka tego, co widzi,
 * a przy sześciu kartach na ekranie tabletu celowanie w ikonę 3 rem kończy się dotknięciem
 * karty obok. Hak `useSpeak` jest jeden na całą planszę, nie jeden na kartę — każdy zakłada
 * nasłuch `voiceschanged`, a dwadzieścia takich nasłuchów na jednej stronie to dwadzieścia
 * przerenderowań przy każdym doczytaniu głosów.
 */
export function WordBoard({ words, targetLang }: { words: BoardWord[]; targetLang: string }) {
  const { speak, speaking, canSpeak, hasVoice, voicesLoaded } = useSpeak(targetLang);
  /** Które słówko mówi teraz — podświetlenie karty. */
  const [mowione, setMowione] = useState<string | null>(null);

  // Głosy dochodzą z opóźnieniem, więc dopóki ich nie znamy, nie straszymy ostrzeżeniem.
  const bezGlosu = !canSpeak || (voicesLoaded && !hasVoice && words.every((word) => word.audioPath === null));

  return (
    <div className="flex flex-col gap-4">
      {bezGlosu && (
        <p className="msg-warn">
          Ta przeglądarka nie potrafi przeczytać słówek na głos. Można je przeczytać samemu —
          albo otworzyć planszę na innym urządzeniu.
        </p>
      )}

      <ul className="word-grid">
        {words.map((word) => {
          const obrazek = mediaUrl(word.imagePath);
          return (
            <li key={word.conceptId}>
              <button
                type="button"
                className="word-card"
                data-speaking={mowione === word.conceptId && speaking}
                title="Posłuchaj"
                onClick={() => {
                  setMowione(word.conceptId);
                  speak(word.target, mediaUrl(word.audioPath));
                }}
              >
                {/* Nazwa przycisku składa się z jego treści: „Posłuchaj: apple, jabłko".
                    Gotowe `aria-label` zasłoniłoby tłumaczenie, a to połowa tej planszy. */}
                <span className="sr-only">Posłuchaj:</span>
                {obrazek !== null ? (
                  // Zwykły <img>, nie next/image: obrazki wgrywa administrator w trakcie
                  // działania aplikacji, więc nie ma ich czym zoptymalizować przy budowaniu.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={obrazek} alt="" className="word-picture" />
                ) : (
                  <span className="word-emoji" aria-hidden>
                    {word.emoji === "" ? "🔈" : word.emoji}
                  </span>
                )}
                <span className="word-target">{word.target}</span>
                {word.ipa !== null && word.ipa !== "" && <span className="word-ipa">[{word.ipa}]</span>}
                <span className="word-source">{word.source}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
