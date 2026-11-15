"use client";

import { useEffect, useRef, useState } from "react";

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
 * Przerwa między słowami przy czytaniu po kolei. Bez niej jedno słowo wchodzi na drugie i dziecko
 * słyszy ciąg dźwięków, a nie listę; z dłuższą przerwą czekanie zaczyna nużyć.
 */
const PRZERWA_MS = 700;

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
 *
 * „Przeczytaj wszystkie" idzie słowo po słowie: następne startuje z wywołania zwrotnego
 * poprzedniego, bo `speechSynthesis` nie mówi, ile wypowiedź potrwa, a stała przerwa dla
 * wszystkich słów albo ucinałaby dłuższe, albo kazała czekać po krótkich.
 */
export function WordBoard({ words, targetLang }: { words: BoardWord[]; targetLang: string }) {
  const { speak, stop, speaking, canSpeak, hasVoice, voicesLoaded } = useSpeak(targetLang);
  /** Które słówko mówi teraz — podświetlenie karty. */
  const [mowione, setMowione] = useState<string | null>(null);
  /** Numer czytanego słówka przy czytaniu po kolei; `null`, gdy nic nie leci. */
  const [czytane, setCzytane] = useState<number | null>(null);

  /**
   * Numer przebiegu. Przerwanie go podbija, więc spóźnione wywołania zwrotne nie dogonią go
   * i nie ruszą dalej listy: `speechSynthesis.cancel()` w części przeglądarek kończy wypowiedź
   * zdarzeniem `onend`, nie do odróżnienia od normalnego końca.
   */
  const przebieg = useRef(0);
  const zegar = useRef<number | null>(null);

  // Wyjście ze strony w połowie czytania. Bez tego syntezator mówi dalej na następnym ekranie,
  // bo mowa nie wisi na komponencie, tylko na całej przeglądarce.
  useEffect(() => {
    return () => {
      przebieg.current += 1;
      if (zegar.current !== null) window.clearTimeout(zegar.current);
      stop();
    };
  }, [stop]);

  /** Koniec czytania: i listy, i pojedynczego słowa. */
  const przerwij = () => {
    przebieg.current += 1;
    if (zegar.current !== null) {
      window.clearTimeout(zegar.current);
      zegar.current = null;
    }
    setCzytane(null);
    stop();
  };

  /** Jedno słówko, dotknięte palcem. Przerywa czytanie listy — dziecko chce usłyszeć to jedno. */
  const powiedz = (word: BoardWord) => {
    przerwij();
    setMowione(word.conceptId);
    speak(word.target, mediaUrl(word.audioPath));
  };

  /** Czytanie od danego miejsca do końca listy. `moj` to numer przebiegu, w którym to się zaczęło. */
  const czytajOd = (index: number, moj: number) => {
    if (moj !== przebieg.current) return;

    const word = words[index];
    if (!word) {
      setCzytane(null);
      return;
    }

    setCzytane(index);
    setMowione(word.conceptId);
    speak(word.target, mediaUrl(word.audioPath), () => {
      if (moj !== przebieg.current) return;
      zegar.current = window.setTimeout(() => czytajOd(index + 1, moj), PRZERWA_MS);
    });
  };

  const czytajWszystkie = () => {
    przerwij();
    czytajOd(0, przebieg.current);
  };

  // Głosy dochodzą z opóźnieniem, więc dopóki ich nie znamy, nie straszymy ostrzeżeniem.
  const bezGlosu = !canSpeak || (voicesLoaded && !hasVoice && words.every((word) => word.audioPath === null));
  const leci = czytane !== null;

  return (
    <div className="flex flex-col gap-4">
      {bezGlosu && (
        <p className="msg-warn">
          Ta przeglądarka nie potrafi przeczytać słówek na głos. Można je przeczytać samemu —
          albo otworzyć planszę na innym urządzeniu.
        </p>
      )}

      {!bezGlosu && words.length > 1 && (
        <button type="button" className="btn-secondary self-start" onClick={leci ? przerwij : czytajWszystkie}>
          {leci ? (
            <>
              <span aria-hidden>⏹</span> Przerwij ({(czytane ?? 0) + 1} z {words.length})
            </>
          ) : (
            <>
              <span aria-hidden>▶️</span> Przeczytaj wszystkie
            </>
          )}
        </button>
      )}

      <ul className="word-grid">
        {words.map((word) => {
          const obrazek = mediaUrl(word.imagePath);
          return (
            <li key={word.conceptId}>
              <button
                type="button"
                className="word-card"
                // Przy czytaniu listy podświetlenie zostaje też w przerwie między słowami —
                // inaczej mrugałoby po każdym słowie.
                data-speaking={mowione === word.conceptId && (speaking || leci)}
                title="Posłuchaj"
                onClick={() => powiedz(word)}
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
