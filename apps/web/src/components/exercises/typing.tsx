"use client";

import { useEffect, useRef, useState } from "react";

import { useSpeak } from "@/lib/use-speak";

import { SpeakButton } from "./speak-button";
import { type ExerciseProps, str } from "./types";

/**
 * Zadanie z pisaniem: tłumaczenie, odmiana i zdanie z luką do uzupełnienia. Porównania dokonuje
 * baza — bez wielkości liter, bez ogonków i z tolerancją jednej literówki — więc tu nie ma żadnej
 * walidacji poza sprawdzeniem, czy dziecko w ogóle coś napisało.
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
  const isBlank = exercise.type === "fill_blank_typing";
  const prompt = isInflection ? str(exercise.payload.base) : str(exercise.payload.prompt);
  // Zdanie z luką. Ta sama treść, co w wersji z kafelkami (`choice.tsx`), tylko bez listy.
  const [before, after] = isBlank ? str(exercise.payload.sentence).split("{{blank}}") : ["", ""];
  /**
   * Co ma się odezwać samo po wejściu na zadanie — zawsze tekst w JĘZYKU KURSU, bo tylko taki
   * dziecko ma usłyszeć. Głośnik przy słowie zostaje; stąd bierze się powtórzenie.
   *
   *   * tłumaczenie NA polski i odmiana — słowo stojące nad polem,
   *   * zdanie z luką — zdanie BEZ brakującego słowa, czyli dokładnie to, co dziecko widzi.
   *     Przeczytanie go z wpisanym słowem byłoby podaniem odpowiedzi, a samo „…" część
   *     silników czyta na głos jako „kropka kropka kropka" — więc lukę zostawiamy ciszą.
   *     Zdanie brzmi wtedy niegramatycznie, ale tak samo niegramatycznie wygląda na ekranie.
   *
   * `translate_ab` nie czyta nic: tam słowo jest po polsku, a głośnik czytający dziecku
   * „czarny" po polsku niczego nie uczy.
   */
  const samoBrzmi =
    exercise.type === "translate_ba" || isInflection
      ? prompt
      : isBlank
        ? `${before} ${after}`.replace(/\s+/g, " ").trim()
        : "";
  const { speak, voicesLoaded } = useSpeak(promptLang);

  // Kursor wraca do pola także po odblokowaniu: przy prośbie o poprawienie literówki
  // zadanie zostaje to samo, a pole było w międzyczasie wyłączone i straciło kursor.
  useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [exercise.id, locked]);

  /**
   * Odezwanie się samo po wejściu na zadanie. Zależnością jest `exercise.id`, nie każdy render:
   * po odpowiedzi zadanie zostaje na ekranie z werdyktem i drugie czytanie w środku sprawdzania
   * brzmiałoby jak usterka.
   *
   * Czekamy na listę głosów (`voicesLoaded`) i dokładamy tę samą ćwierć sekundy co zadanie
   * ze słuchu: przeglądarka wystawia głosy chwilę po pierwszym renderze, a wypowiedź wydana
   * zbyt wcześnie bywa ucinana w połowie pierwszej głoski. Na iOS mowa idzie wyłącznie po
   * dotknięciu ekranu, więc tam po prostu nic się nie odezwie — i dlatego głośnik przy słowie
   * jest podstawą, a to tylko ułatwieniem.
   */
  useEffect(() => {
    if (!voicesLoaded || samoBrzmi === "") return;
    const timer = setTimeout(() => speak(samoBrzmi), 250);
    return () => clearTimeout(timer);
  }, [exercise.id, samoBrzmi, voicesLoaded, speak]);

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
        {isBlank ? (
          // Luka pokazuje to, co dziecko właśnie wpisuje: zdanie składa się na oczach, więc
          // widać, czy brzmi sensownie — a o to w tym zadaniu chodzi.
          <div className="card w-full p-5 text-center">
            <p style={{ fontSize: "1.5rem", lineHeight: 1.5 }}>
              {before}
              <span
                className="mx-1 inline-block rounded-xl px-6"
                style={{ background: "var(--color-brand-light)", borderBottom: "3px solid var(--color-brand)" }}
              >
                {value.trim() === "" ? "…" : value}
              </span>
              {after}
            </p>
            {/* Polskie zdanie pod luką, drobnym drukiem — tak samo jak w wersji z kafelkami.
                Nie jest podpowiedzią do usunięcia, a warunkiem odpowiadalności: bez niego
                i bez listy dziecko nie ma po czym pojąć, którego słowa brakuje. Napisać
                i tak musi je z pamięci, w języku kursu. */}
            {str(exercise.payload.translation) && (
              <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
                {str(exercise.payload.translation)}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p style={{ fontSize: "2.5rem", fontWeight: 700 }}>{prompt}</p>
            <SpeakButton text={prompt} lang={promptLang} />
          </div>
        )}
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
