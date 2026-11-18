import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

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

/** Znaczniki języka przychodzą w kilku postaciach (`it-IT`, `it_IT`, `IT-it`) — zrównujemy je. */
const tag = (lang: string): string => lang.replace('_', '-').toLowerCase();

/** Sam język, bez kraju (`it-IT` → `it`). */
const base = (lang: string): string => tag(lang).slice(0, 2);

/**
 * Głos dla danego języka — i celowo NIE pierwszy z listy.
 *
 * Android podaje dla jednego języka po kilka głosów i nie układa ich od najlepszego. Są wśród
 * nich dwa rodzaje, których dziecko nie chce usłyszeć:
 *
 *   * `…-network` — głos liczony na serwerze Google. Bez internetu albo przy słabym zasięgu
 *     silnik podmienia go po cichu na swój domyślny, czyli włoskie słowo czyta polskim albo
 *     angielskim lektorem. Dlatego `-local` ma pierwszeństwo;
 *   * głos zwykłej jakości, kiedy obok stoi `Enhanced` — ten sam język, tylko wyraźniejszy.
 *
 * Kolejność: najpierw głosy dokładnie w znaczniku kursu (`it-IT`), potem z tej samej rodziny
 * (`it-CH`), a w każdej grupie lokalny i lepszy przed gorszym. Brak zwraca `null` i wtedy nie ma
 * czym czytać.
 */
function pickVoice(voices: Speech.Voice[], lang: string): Speech.Voice | null {
  const wanted = tag(lang);
  const best = voices
    .filter((voice) => base(voice.language) === base(wanted))
    .map((voice) => ({
      voice,
      ocena:
        (tag(voice.language) === wanted ? 4 : 0) +
        (tag(voice.identifier).includes('network') ? 0 : 2) +
        (voice.quality === Speech.VoiceQuality.Enhanced ? 1 : 0),
    }))
    .sort((a, b) => b.ocena - a.ocena)[0];
  return best?.voice ?? null;
}

/**
 * Języki, na których czytanie się wyłożyło, choć głos był na liście — tak wygląda głos
 * zapowiedziany przez system, ale z niepobranymi danymi. Trzymamy to poza hakiem, bo dotyczy
 * całej aplikacji, a nie jednego przycisku, i ma przeżyć przejście do następnego zadania.
 */
const broken = new Set<string>();
const listeners = new Set<() => void>();

function markBroken(lang: string): void {
  if (broken.has(tag(lang))) return;
  broken.add(tag(lang));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Języki, w których telefon już coś przeczytał do końca — ich jedno potknięcie nie przekreśla. */
const worked = new Set<string>();

export function useSpeak(lang: string) {
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const failed = useSyncExternalStore(
    subscribe,
    () => broken.has(tag(lang)),
    () => false,
  );

  useEffect(() => {
    let alive = true;
    void allVoices().then((list) => {
      if (alive) setVoices(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const voice = voices === null ? null : pickVoice(voices, lang);

  /**
   * Pusta lista znaczy „nie wiem”, nie „nie ma”: część telefonów nie wydaje spisu głosów,
   * choć mówi. Wtedy lepiej spróbować niż z góry pominąć zadanie.
   */
  const hasVoice = !failed && (voices === null || voices.length === 0 || voice !== null);

  /**
   * `onDone` woła się raz, gdy wypowiedź się skończy — też wtedy, gdy się nie udała albo gdy
   * nie było czym mówić. Inaczej czytanie listy po kolei stawałoby na pierwszym słowie bez głosu.
   */
  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (text.trim() === '') {
        onDone?.();
        return;
      }
      Speech.stop();
      setSpeaking(true);
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        setSpeaking(false);
        onDone?.();
      };
      const powiedz = (wybrany: Speech.Voice | null) => {
        Speech.speak(text, {
          /**
           * Sam język, bez kraju — i to nie niedopatrzenie. `expo-speech` buduje z tego, co
           * dostanie, `Locale.Builder().setLanguage(…)`, a ten przyjmuje wyłącznie samo `it`.
           * Na pełnym `it-IT` rzuca wyjątkiem, który moduł łapie i po cichu podstawia język
           * urządzenia — włoskie słowo czytał wtedy polski albo angielski lektor. Kraj nie
           * ginie: dobiera go `pickVoice`, dopasowując głos dokładnie do `it-IT`.
           */
          language: base(lang),
          /**
           * Wolniej niż domyślnie, tak samo jak na webie (`apps/web/src/lib/use-speak.ts`):
           * dziecko ma zdążyć usłyszeć każdą głoskę, a przy zadaniu ze słuchu — zapisać słowo.
           */
          rate: 0.85,
          /**
           * Sam `language` Androidowi nie wystarcza. Gdy danych języka nie ma, system nie zgłasza
           * błędu — zostaje przy swoim domyślnym głosie. Wskazanie konkretnego głosu z listy
           * urządzenia nie zostawia mu tego wyboru: albo przeczyta tym głosem, albo powie, że nie
           * umie, i wtedy chowamy głośnik.
           */
          ...(wybrany === null ? {} : { voice: wybrany.identifier }),
          onDone: () => {
            worked.add(tag(lang));
            end();
          },
          onStopped: end,
          onError: () => {
            // Język, w którym nigdy nic nie wyszło, uznajemy za nieobsługiwany — dziecko zobaczy
            // wtedy „ten telefon nie ma głosu", zamiast dotykać głośnika, z którego nic nie leci.
            if (!worked.has(tag(lang))) markBroken(lang);
            end();
          },
        });
      };

      /**
       * Przy pierwszym dotknięciu lista głosów może jeszcze nie dojść — czyta się ją raz na
       * uruchomienie aplikacji i trwa to chwilę. Bez czekania ta jedna wypowiedź poszłaby bez
       * wskazanego głosu, czyli dokładnie tak, jak brzmiał włoski przed tą poprawką.
       */
      if (voices !== null) powiedz(voice);
      else void allVoices().then((list) => powiedz(pickVoice(list, lang)));
    },
    [lang, voice, voices],
  );

  return { speak, speaking, hasVoice, voicesLoaded: voices !== null };
}

/**
 * Znaczniki języków (`pl`, `en`, `it`), dla których ten telefon ma jakikolwiek głos. Do podglądu
 * w sekcji „Konto”; korzysta z tej samej, raz wczytanej listy co czytanie słówek.
 *
 * Głos na liście to jeszcze nie pewność: system zapowiada też języki, których danych nie pobrał
 * (patrz `broken` wyżej). Dlatego podgląd mówi o tym wprost, zamiast obiecywać, że przeczyta.
 */
export async function voiceLanguages(): Promise<string[]> {
  const voices = await allVoices();
  return Array.from(new Set(voices.map((voice) => base(voice.language))));
}
