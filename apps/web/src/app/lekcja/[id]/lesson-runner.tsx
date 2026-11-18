"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { HINTS, plural, UNLOCKS } from "@lingomemo/core";

import { ChoiceExercise } from "@/components/exercises/choice";
import { ImageChoiceExercise } from "@/components/exercises/image-choice";
import { ListenMatchExercise } from "@/components/exercises/listen-match";
import { ListeningExercise } from "@/components/exercises/listening";
import { MatchPairsExercise } from "@/components/exercises/match-pairs";
import { SentenceOrderExercise } from "@/components/exercises/sentence-order";
import type { Answer, Exercise } from "@/components/exercises/types";
import { TypingExercise } from "@/components/exercises/typing";
import { useFeedbackSound } from "@/lib/use-feedback-sound";

import { askHint, finishLesson, startLesson, submitAnswer, type Summary, type Verdict } from "./lesson-actions";

type Phase = "answering" | "checking" | "feedback" | "done";

/**
 * Nazwa poziomu w znaczniku. Krótka, bo znacznik stoi w jednym rzędzie z etapem, podpowiedziami
 * i licznikiem zadań — pełne „Poziom trudny" idzie do dymka i do etykiety dla czytnika ekranu.
 */
function levelName(level: number) {
  if (level === 2) return "Średni";
  if (level === 3) return "Trudny";
  return "Łatwy";
}


/**
 * Przebieg lekcji. Komponent pilnuje tylko kolejności zadań i tego, co widać na ekranie —
 * o tym, czy odpowiedź jest poprawna i ile jest za nią punktów, decyduje wyłącznie baza.
 */
export function LessonRunner({
  lessonId,
  courseSlug,
  exercises,
  sourceLang,
  targetLang,
  badgeNames,
  stage,
  stages,
  level,
  hintsLeft,
  unlockLeft,
  preview,
  autoNextMs,
}: {
  lessonId: string;
  courseSlug: string;
  exercises: Exercise[];
  /** Język dziecka. Po nim czytamy polecenie w `translate_ab` — tam słowo jest po polsku. */
  sourceLang: string;
  targetLang: string;
  /** Kod odznaki -> nazwa z ikoną. Dziecko ma zobaczyć „Pierwszy krok”, nie `first_lesson`. */
  badgeNames: Record<string, string>;
  /** Który etap lekcji jest rozgrywany i ile ich jest w całej lekcji. */
  stage: number;
  stages: number;
  /** 1 łatwy (lekcja z etapami), 2 średni, 3 trudny — krótkie wejście na ośmiu słówkach. */
  level: number;
  /** Ile podpowiedzi zostało dziecku na dziś. Pula odnawia się o północy w jego strefie. */
  hintsLeft: number;
  /** Punkty odblokowania sprzed lekcji — po zamknięciu poznajemy po różnicy, czy przybył nowy. */
  unlockLeft: number;
  /** Podgląd z panelu: baza wpuszcza administratora także w lekcję zamkniętą
   *  albo nieopublikowaną. Ucząc się normalnie, ma zamki jak dziecko. */
  preview: boolean;
  /**
   * Ile czekamy po dobrej odpowiedzi, zanim lekcja przejdzie dalej sama. Z ustawień
   * aplikacji, bo właściwy czas widać dopiero na dziecku — jedno czyta dłużej, drugie
   * klika szybciej, niż ekran zdąży się przerysować.
   */
  autoNextMs: number;
}) {
  const [index, setIndex] = useState(0);
  // Zadania, które wracają w tym podejściu: numery tych, na które odpowiedź była zła. Kolejka
  // etapu to lista zadań plus te numery, więc pozycje od 0 do `exercises.length - 1` to pierwsze
  // pokazanie zadania, a wszystko dalej to powtórka.
  const [repeats, setRepeats] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("answering");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Ile podpowiedzi dołożyła właśnie zaliczona lekcja. Nie pytamy o to bazy wprost: pula po
  // zamknięciu lekcji minus pula sprzed niego to dokładnie tyle, ile przybyło.
  const [hintsWon, setHintsWon] = useState(0);
  const [unlocks, setUnlocks] = useState(unlockLeft);
  const [unlocksWon, setUnlocksWon] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Zadanie, w którego polu dziecko już coś napisało. Trzymamy IDENTYFIKATOR, nie flagę:
  // przy przejściu dalej wystarczy, że przestaje pasować do bieżącego zadania, więc nie trzeba
  // go zerować w efekcie (czego linter i tak nie puszcza).
  const [draftOf, setDraftOf] = useState<string | null>(null);
  // Podpowiedzi: ile zostało i które zadania zostały już zamienione na łatwiejsze. Zamiennik
  // trzymamy po numerze w kolejności, bo to on wyznacza, co jest na ekranie.
  const [hints, setHints] = useState(hintsLeft);
  const [swapped, setSwapped] = useState<Record<number, Exercise>>({});
  // Prośba o poprawienie literówki. Trzymamy identyfikator zadania, nie flagę — przy przejściu
  // dalej przestaje pasować do bieżącego zadania i znika sam, bez zerowania w efekcie.
  const [fixAsked, setFixAsked] = useState<string | null>(null);
  // Po co poprawka: literówka czy przestawiona kolejność. Dwa różne komunikaty, bo dziecko
  // szukające literówki w zdaniu, które ma wszystkie słowa dobre, nie znajdzie niczego.
  const [fixReason, setFixReason] = useState<"typo" | "order">("typo");

  const { play, enabled: soundOn, toggle: toggleSound } = useFeedbackSound();

  const sessionRef = useRef<string | null>(null);
  // Klucz idempotencji: po zerwanym połączeniu ponowne wysłanie wraca do tej samej sesji.
  // Nadawany przy pierwszej odpowiedzi, czyli w obsłudze zdarzenia — w trakcie renderu nie wolno
  // wołać funkcji, które za każdym razem dają inny wynik.
  const keyRef = useRef<string | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    startedAt.current = Date.now();
  }, [index]);

  /**
   * Wyjście z lekcji kasuje przebieg, żeby kolejne wejście zaczynało etap od zera.
   *
   * Next nie odmontowuje strony, z której dziecko wychodzi — chowa ją (`<Activity>`), żeby
   * powrót był natychmiastowy, i pokazuje ten sam komponent z całym stanem sprzed wyjścia.
   * Dziecko wchodzące w ten sam etap drugi raz widziało więc od razu podsumowanie poprzedniego
   * podejścia zamiast pierwszego zadania. Klucz na komponencie tego nie łapie, bo wraca
   * dokładnie ten sam komponent, a nie nowy — łapie to sprzątanie efektu, które wykonuje się
   * przy chowaniu ekranu (i przy odmontowaniu, gdzie jest już tylko bez znaczenia).
   */
  useEffect(() => {
    return () => {
      setIndex(0);
      setRepeats([]);
      setPhase("answering");
      setVerdict(null);
      setSummary(null);
      setHintsWon(0);
      setUnlocksWon(0);
      setError(null);
      setDraftOf(null);
      setSwapped({});
      setFixAsked(null);
      // Nowy przebieg to nowa sesja w bazie: stary klucz idempotencji wróciłby do zamkniętej.
      sessionRef.current = null;
      keyRef.current = null;
      startedAt.current = Date.now();
    };
  }, []);

  // Kolejka etapu: najpierw wszystkie zadania po kolei, potem te, które wróciły po błędzie.
  // Trzymamy numery, nie same zadania — podpowiedź podmienia zadanie na łatwiejsze tylko na tej
  // jednej pozycji, więc powtórka pokazuje je znowu w pełnej postaci.
  const queue = [...exercises.map((_, nr) => nr), ...repeats];
  const total = queue.length;
  const repeat = index >= exercises.length;
  const exercise = swapped[index] ?? exercises[queue[index]];
  const hinted = swapped[index] !== undefined;

  const handleAnswer = useCallback(
    async (answer: Answer) => {
      if (phase !== "answering" || !exercise) return;
      setPhase("checking");
      setError(null);

      if (keyRef.current === null) {
        keyRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}`;
      }

      if (sessionRef.current === null) {
        const started = await startLesson(lessonId, keyRef.current, stage, level, preview);
        if ("error" in started) {
          setError(started.error);
          setPhase("answering");
          return;
        }
        sessionRef.current = started.sessionId;
      }

      const result = await submitAnswer(
        sessionRef.current,
        exercise.id,
        answer,
        startedAt.current > 0 ? Date.now() - startedAt.current : null,
        // Zadanie wzięte z podpowiedzi liczy się dla harmonogramu powtórek jako trudniejsze:
        // słówko wróci szybciej niż po samodzielnej odpowiedzi.
        hinted,
      );
      if ("error" in result) {
        setError(result.error);
        setPhase("answering");
        return;
      }

      // Prośba o poprawkę, a nie werdykt: baza nic nie zapisała i czeka na drugie podejście.
      // Wracamy do pisania z tym, co dziecko wpisało — nie czyścimy pola, bo poprawia się
      // literówkę, a nie pisze od nowa. Dźwięku nie ma: nic jeszcze nie jest ani dobre, ani złe.
      if (result.verdict.retry) {
        setFixAsked(exercise.id);
        setFixReason(result.verdict.reason === "order" ? "order" : "typo");
        setPhase("answering");
        return;
      }

      // Źle zrobione zadanie wraca na koniec kolejki etapu — jeszcze raz, w tym samym podejściu,
      // zaraz po tym, jak dziecko zobaczyło poprawną odpowiedź. Pominięcie też jest błędem,
      // więc też wraca. Tylko raz (`index` z pierwszego pokazania): inaczej dziecko, które
      // czegoś nie umie, kręciłoby się na jednym zadaniu do końca etapu. Wynik na tym nie traci
      // — baza liczy teraz każdą odpowiedź z osobna, więc powtórka dokłada zadanie do mianownika.
      if (!result.verdict.correct && !repeat) {
        setRepeats((prev) => [...prev, index]);
      }

      setFixAsked(null);
      setVerdict(result.verdict);
      play(result.verdict.correct ? "correct" : "wrong");
      setPhase("feedback");
    },
    [exercise, hinted, index, lessonId, level, phase, play, preview, repeat, stage],
  );

  /**
   * Podpowiedź. Zamienia zadanie na łatwiejszą wersję tego samego słówka — wybór zamiennika
   * i pilnowanie dziennej puli należą do bazy. Sesję trzeba założyć wcześniej niż przy
   * pierwszej odpowiedzi, bo to w niej zapisuje się zamiana.
   */
  const takeHint = useCallback(async () => {
    if (phase !== "answering") return;
    setError(null);

    if (keyRef.current === null) {
      keyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}`;
    }

    if (sessionRef.current === null) {
      const started = await startLesson(lessonId, keyRef.current, stage, level, preview);
      if ("error" in started) {
        setError(started.error);
        return;
      }
      sessionRef.current = started.sessionId;
    }

    const result = await askHint(sessionRef.current, exercise.id);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSwapped((prev) => ({ ...prev, [index]: result.exercise }));
    setHints(result.hintsLeft);
    setDraftOf(null);
    startedAt.current = Date.now();
  }, [exercise, index, lessonId, level, phase, preview, stage]);

  const next = useCallback(async () => {
    setVerdict(null);
    // Powtórzone zadanie ma ten sam identyfikator co za pierwszym razem, więc ślad po wpisanej
    // wtedy odpowiedzi nie zniknąłby sam — a z nim chowałoby się wyjście „Nie wiem, pomiń".
    setDraftOf(null);
    if (index + 1 < total) {
      setIndex(index + 1);
      setPhase("answering");
      return;
    }
    setPhase("checking");
    if (sessionRef.current === null) {
      setPhase("done");
      return;
    }
    const finished = await finishLesson(sessionRef.current);
    if ("error" in finished) {
      setError(finished.error);
      setPhase("feedback");
      return;
    }
    setSummary(finished.summary);
    setHintsWon(Math.max(finished.hintsLeft - hints, 0));
    setHints(finished.hintsLeft);
    setUnlocksWon(Math.max(finished.unlockLeft - unlocks, 0));
    setUnlocks(finished.unlockLeft);
    setPhase("done");
  }, [hints, index, total, unlocks]);

  if (phase === "done" && summary) {
    return (
      <SummaryScreen
        summary={summary}
        lessonId={lessonId}
        courseSlug={courseSlug}
        badgeNames={badgeNames}
        hintsWon={hintsWon}
        unlocksWon={unlocksWon}
      />
    );
  }

  // Etap, w którym dziecko nie odpowiedziało ani razu — wszystkie zadania były ze słuchu,
  // a przeglądarka nie ma głosu. Nie ma sesji, więc nie ma też czego podsumować: zamiast
  // zablokowanego ostatniego zadania pokazujemy wyjście.
  if (phase === "done") {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="text-6xl" aria-hidden>
          🔈
        </span>
        <p>Tego etapu nie da się zrobić bez głosu w przeglądarce. Nic nie policzyliśmy.</p>
        <Link href={`/kurs/${courseSlug}`} className="btn-primary">
          Wróć do kursu
        </Link>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <p>Ta lekcja nie ma jeszcze żadnych zadań.</p>
        <Link href={`/kurs/${courseSlug}`} className="btn-secondary">
          Wróć do kursu
        </Link>
      </div>
    );
  }

  const locked = phase !== "answering";
  // Pole bieżącego zadania nie jest puste — wtedy chowamy pomijanie.
  const hasDraft = draftOf !== null && draftOf === exercise?.id;

  // O tym, czy tłumaczenie jest wyborem z listy, decyduje payload, nie typ zadania: ten sam
  // `translate_ab` raz ma `options` (dodane przez panel, gdy w lekcji jest z czego wybierać),
  // a raz nie. Bez tego sprawdzenia zadanie bez opcji pokazywało samo słowo i pustkę pod nim —
  // dziecko nie miało czym odpowiedzieć. Baza przyjmuje oba warianty (`text` albo `choice`).
  const options = exercise.payload.options;
  const hasOptions = Array.isArray(options) && options.length >= 2;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Wyjście jest napisem, nie krzyżykiem: dziecko w drugiej klasie czyta „Wyjdź", a ✕ musi
          sobie wytłumaczyć. Czerwień mówi, że to wyjście bez zapisania etapu do końca, i odróżnia
          je od wszystkiego innego na ekranie lekcji. Rząd zawija się, bo przycisk zajmuje więcej
          miejsca niż krzyżyk i na wąskim ekranie zepchnąłby licznik zadań poza widok. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/kurs/${courseSlug}`} className="btn-danger btn-compact shrink-0" aria-label="Wyjdź z lekcji">
          Wyjdź
        </Link>
        {/* Poziom mówi kolorem paska postępu, a nie własnym znacznikiem z napisem: rząd ma 48 rem
            i „Poziom łatwy" przy każdej lekcji spychał licznik zadań do drugiego wiersza. Kolory
            te same co kwadraciki na ekranie kursu (zielony → żółty → czerwony), więc dziecko
            poznaje poziom tym samym znakiem, którym go wybierało. Obrys jest konieczny: na
            pierwszym zadaniu wypełnienie ma zerową szerokość i nie byłoby po czym poznać. */}
        <div
          className="lesson-bar h-5 flex-1 overflow-hidden rounded-full"
          data-level={level}
          style={{ background: "var(--color-zinc-200)" }}
          role="progressbar"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label={`Postęp lekcji — poziom ${levelName(level).toLowerCase()}`}
          title={`Poziom ${levelName(level).toLowerCase()}`}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.round((index / total) * 100)}%` }}
          />
        </div>
        <button
          type="button"
          onClick={toggleSound}
          className="chip justify-center"
          // Przełącznik jest drugorzędny, ale wciąż dotyka go dziecko — 44 px to minimum,
          // poniżej którego trafienie palcem staje się loterią.
          style={{ minWidth: "2.75rem", minHeight: "2.75rem" }}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Wyłącz dźwięki" : "Włącz dźwięki"}
          title={soundOn ? "Wyłącz dźwięki" : "Włącz dźwięki"}
        >
          <span aria-hidden>{soundOn ? "🔔" : "🔕"}</span>
        </button>
        {/* Przy jednoetapowej lekcji numer etapu byłby szumem — dziecko ma na pasku licznik
            zadań i tyle. */}
        {stages > 1 && (
          <span className="chip" aria-label={`Etap ${stage} z ${stages}`}>
            Etap {stage}/{stages}
          </span>
        )}
        {/* Podgląd z panelu wygląda dokładnie jak lekcja dziecka — a przecież omija zamki.
            Bez tego napisu administrator nie odróżniłby „lekcja jest otwarta" od „wszedłem
            tylnymi drzwiami". */}
        {preview && <span className="chip">👀 Podgląd</span>}
        {/* Zadanie, które wróciło po błędzie. Bez tego napisu dziecko widzi tylko, że ekran
            pokazuje coś, co już było — a ma wiedzieć, że dostaje drugie podejście. */}
        {repeat && <span className="chip">🔁 Jeszcze raz</span>}
        <span className="chip" aria-label={`Podpowiedzi na dziś: ${hints}`} title="Podpowiedzi na dziś">
          💡 {hints}
        </span>
        <span className="chip">
          {index + 1}/{total}
        </span>
      </div>

      {/* Klucz z pozycji w kolejce i identyfikatora zadania. Bez niego React przy przejściu
          dalej zostawia ten sam komponent, a w nim stan poprzedniego zadania: wpisaną odpowiedź,
          zaznaczony kafelek, ułożone zdanie. Pozycja jest w kluczu, bo sam identyfikator
          nie wystarcza — powtórzone zadanie ma ten sam, a ma zacząć się od czystego ekranu. */}
      {exercise.type === "listening" ? (
        <ListeningExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
          onDraft={(has) => setDraftOf(has ? exercise.id : null)}
        />
      ) : exercise.type === "listen_match" ? (
        <ListenMatchExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
        />
      ) : exercise.type === "match_pairs" ? (
        <MatchPairsExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
          targetLang={targetLang}
        />
      ) : exercise.type === "image_choice" ? (
        <ImageChoiceExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
          targetLang={targetLang}
          result={phase === "feedback" && verdict ? (verdict.correct ? "correct" : "wrong") : null}
          correctAnswer={
            phase === "feedback" && verdict && typeof verdict.correctAnswer === "string"
              ? verdict.correctAnswer
              : null
          }
        />
      ) : exercise.type === "sentence_order" ? (
        <SentenceOrderExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
        />
      ) : exercise.type === "fill_blank_choice" || (exercise.type === "translate_ab" && hasOptions) ? (
        <ChoiceExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
          targetLang={targetLang}
          result={phase === "feedback" && verdict ? (verdict.correct ? "correct" : "wrong") : null}
        />
      ) : (
        <TypingExercise
          key={`${index}-${exercise.id}`}
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          onSkip={next}
          onDraft={(has) => setDraftOf(has ? exercise.id : null)}
          // W `translate_ab` słowo nad polem jest w języku dziecka, w pozostałych w uczonym —
          // głośnik czytający „czarny" po angielsku brzmi jak awaria.
          promptLang={exercise.type === "translate_ab" ? sourceLang : targetLang}
        />
      )}

      {/* Bliska pomyłka w pisaniu: baza prosi o poprawkę zamiast oceniać. Komunikat stoi pod
          polem, żeby dziecko czytało go razem z tym, co samo napisało. Nie mówi, co jest źle —
          wtedy poprawianie byłoby przepisywaniem. */}
      {fixAsked === exercise.id && phase === "answering" && (
        <p className="msg-warn" role="status">
          {fixReason === "order"
            ? "Prawie! Wszystkie słowa są dobre, tylko w innej kolejności — poukładaj je i wyślij jeszcze raz."
            : "Prawie! Zajrzyj w litery i popraw — sprawdzimy jeszcze raz."}
        </p>
      )}

      {/* Podpowiedź: to samo słówko w łatwiejszej postaci — zamiast wpisywać, dziecko wskazuje
          albo układa z klocków. Pięć na dobę, pula wraca o północy. Znika po użyciu na tym
          zadaniu i wtedy, gdy na dziś nic nie zostało. */}
      {phase === "answering" && hints > 0 && !hinted && (
        <button type="button" className="btn-secondary self-center" onClick={takeHint}>
          <span aria-hidden>💡</span> Podpowiedź ({hints})
        </button>
      )}

      {/* Wyjście dla dziecka, które utknęło. Idzie do bazy jako odpowiedź `{"skipped": true}`,
          więc liczy się jak błąd: zero punktów i słówko wraca w powtórkach. Alternatywą było
          zgadywanie w kółko albo wyjście z lekcji w połowie.

          Znika, gdy w polu coś już jest: przycisk nie czyta pola, więc jedno dotknięcie tuż pod
          „Sprawdź" kasowało gotową — czasem poprawną — odpowiedź i cofało słówko w powtórkach.
          Jest też cichy (`back-link`, nie drugi duży klawisz), bo to wyjście awaryjne, a nie
          równorzędny wybór. */}
      {phase === "answering" && !hasDraft && (
        <button
          type="button"
          className="back-link self-center"
          onClick={() => void handleAnswer({ skipped: true })}
        >
          Nie wiem, pomiń
        </button>
      )}

      {error && <p className="msg-error">{error}</p>}

      {phase === "feedback" && verdict && (
        <Feedback
          verdict={verdict}
          onNext={next}
          autoNextMs={autoNextMs}
          last={index + 1 >= total}
          // Po ostatnim zadaniu etapu kończy się etap, nie lekcja — „Zakończ lekcję" przy
          // dwunastu zadaniach z czterdziestu to obietnica, której przycisk nie dotrzyma.
          lastLabel={stages > 1 && stage < stages ? "Zakończ etap" : "Zakończ lekcję"}
          // Przy wyborze obrazka poprawną odpowiedzią jest ścieżka do pliku. Dziecku mówi
          // ona tyle co nic — właściwy obrazek podświetla się na kafelku.
          showAnswer={exercise.type !== "image_choice"}
        />
      )}
    </div>
  );
}

function Feedback({
  verdict,
  onNext,
  autoNextMs,
  last,
  lastLabel = "Zakończ lekcję",
  showAnswer = true,
}: {
  verdict: Verdict;
  onNext: () => void;
  autoNextMs: number;
  last: boolean;
  /** Napis na przycisku po ostatnim zadaniu: etap albo cała lekcja. */
  lastLabel?: string;
  showAnswer?: boolean;
}) {
  const shown = showAnswer && typeof verdict.correctAnswer === "string" ? verdict.correctAnswer : null;

  /**
   * Po dobrej odpowiedzi lekcja idzie dalej sama po czasie z ustawień aplikacji.
   *
   * Tylko po dobrej: przy błędnej dziecko musi zdążyć przeczytać, jak było poprawnie, a tego
   * nie da się zmierzyć zegarem. Tylko gdy jest następne zadanie: zakończenie etapu albo lekcji
   * zapisuje wynik i przyznaje punkty, więc ten jeden przycisk dziecko naciska samo.
   *
   * Każde kliknięcie i każdy klawisz odmierzają czas od nowa — dziecko, które słucha słówka
   * głośnikiem albo ogląda odpowiedzi, nie ma zniknąć ekranu sprzed nosa w połowie.
   */
  const auto = verdict.correct && !last;
  /** Rośnie przy każdym przestawieniu licznika. Jako `key` paska wymusza animację od nowa. */
  const [odliczanie, setOdliczanie] = useState(0);

  useEffect(() => {
    if (!auto) return;

    let timer = 0;
    const odlicz = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onNext, autoNextMs);
    };
    const przestaw = () => {
      setOdliczanie((n) => n + 1);
      odlicz();
    };

    odlicz();
    // Faza przechwytywania: licznik ma się przestawić także wtedy, gdy kliknięcie zatrzyma
    // się na przycisku i nie dojdzie do okna.
    window.addEventListener("pointerdown", przestaw, true);
    window.addEventListener("keydown", przestaw, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", przestaw, true);
      window.removeEventListener("keydown", przestaw, true);
    };
    // `odliczanie` celowo poza zależnościami: przestawienie paska nie ma restartować efektu,
    // bo ten ustawiłby drugi `setTimeout` obok już działającego.
  }, [auto, autoNextMs, onNext]);

  return (
    <div
      className="anim-slide-up sticky bottom-0 -mx-4 flex flex-col gap-3 border-t-2 p-4"
      style={{
        background: verdict.correct ? "var(--color-grass-light)" : "var(--color-coral-light)",
        borderColor: verdict.correct ? "var(--color-grass)" : "var(--color-coral)",
      }}
      role="status"
    >
      <p style={{ fontSize: "1.5rem", fontWeight: 700, color: verdict.correct ? "#0f5c37" : "#8f2420" }}>
        <span className={verdict.correct ? "anim-pop inline-block" : "inline-block"} aria-hidden>
          {verdict.correct ? "🎉 " : verdict.skipped ? "👀 " : "💪 "}
        </span>
        {verdict.correct
          ? verdict.nearMiss
            ? "Prawie! Zaliczone"
            : "Brawo!"
          : verdict.skipped
            ? "Pominięte"
            : "Nie tym razem"}
      </p>
      {!verdict.correct && shown && (
        <p style={{ color: "#8f2420" }}>
          Poprawnie: <strong>{shown}</strong>
        </p>
      )}
      {verdict.correct && verdict.points > 0 && <p style={{ color: "#0f5c37" }}>+{verdict.points} punktów</p>}
      <button type="button" className="btn-primary relative overflow-hidden" onClick={onNext} autoFocus>
        {last ? lastLabel : "Dalej"}
        {/* Pasek kurczy się przez ten czas, żeby przejście nie było zaskoczeniem.
            `key` przestawia animację na początek, gdy dziecko kliknie cokolwiek. */}
        {auto && (
          <span
            key={odliczanie}
            className="countdown"
            style={{ animationDuration: `${autoNextMs}ms` }}
            aria-hidden
          />
        )}
      </button>
    </div>
  );
}

/**
 * Podsumowanie. Przy lekcji wieloetapowej mówi o ETAPIE, a puchar zostaje na koniec — inaczej
 * dziecko po pierwszym z trzech kawałków widziałoby „Lekcja zaliczona!" i nie miałoby powodu
 * wracać po resztę.
 */
function SummaryScreen({
  summary,
  lessonId,
  courseSlug,
  badgeNames,
  hintsWon,
  unlocksWon,
}: {
  summary: Summary;
  lessonId: string;
  courseSlug: string;
  badgeNames: Record<string, string>;
  /** Ile podpowiedzi przybyło za zaliczenie tej lekcji. Zero przy etapie i przy powtórce. */
  hintsWon: number;
  /** Ile punktów odblokowania przybyło — jeden za zaliczony poziom trudny, zero poza nim. */
  unlocksWon: number;
}) {
  const stars = "⭐".repeat(summary.stars) + "☆".repeat(3 - summary.stars);
  const split = summary.stages > 1;
  const nextStage = summary.passed && !summary.lessonPassed ? summary.stage + 1 : null;

  const title = summary.lessonPassed
    ? "Lekcja zaliczona!"
    : summary.passed
      ? `Etap ${summary.stage} z ${summary.stages} zaliczony!`
      : "Jeszcze trochę";

  return (
    <div className="flex flex-col items-center gap-5 pt-6 text-center">
      <span className="anim-pop text-7xl" aria-hidden>
        {summary.lessonPassed ? "🏆" : summary.passed ? "🎯" : "🌱"}
      </span>
      <h1>{title}</h1>
      <p style={{ fontSize: "2.5rem", letterSpacing: "0.2em" }} aria-label={`${summary.stars} z 3 gwiazdek`}>
        {stars}
      </p>
      <p>
        Dobrze: <strong>{summary.correct}</strong> z <strong>{summary.total}</strong>
      </p>
      {split && !summary.lessonPassed && (
        <p className="chip">
          Etapy za tobą: {summary.stagesDone} z {summary.stages}
        </p>
      )}
      {summary.xp > 0 && <p className="chip">+{summary.xp} punktów za {split ? "etap" : "lekcję"}</p>}
      {hintsWon > 0 && <p className="chip">💡 +{plural(hintsWon, HINTS)} na dziś</p>}
      {/* Punkt zostaje do wydania, więc mówimy wprost, na co: dziecko dopiero poznaje tę walutę. */}
      {unlocksWon > 0 && (
        <p className="chip">🔑 +{plural(unlocksWon, UNLOCKS)} — otworzysz nim zamkniętą lekcję</p>
      )}
      {summary.streak > 1 && <p className="chip">🔥 {summary.streak} dni z rzędu</p>}
      {summary.badges.length > 0 && (
        <p className="msg-ok">
          {summary.badges.length === 1 ? "Nowa odznaka!" : "Nowe odznaki!"}{" "}
          {summary.badges.map((code) => badgeNames[code] ?? code).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {nextStage !== null && (
          <Link href={`/lekcja/${lessonId}?etap=${nextStage}`} className="btn-primary">
            Następny etap
          </Link>
        )}
        <Link
          href={`/kurs/${courseSlug}`}
          className={nextStage !== null ? "btn-secondary" : "btn-primary"}
        >
          Wróć do kursu
        </Link>
      </div>
    </div>
  );
}
