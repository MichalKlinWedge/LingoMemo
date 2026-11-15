"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChoiceExercise } from "@/components/exercises/choice";
import { ImageChoiceExercise } from "@/components/exercises/image-choice";
import { ListenMatchExercise } from "@/components/exercises/listen-match";
import { ListeningExercise } from "@/components/exercises/listening";
import { MatchPairsExercise } from "@/components/exercises/match-pairs";
import { SentenceOrderExercise } from "@/components/exercises/sentence-order";
import type { Answer, Exercise } from "@/components/exercises/types";
import { TypingExercise } from "@/components/exercises/typing";
import { useFeedbackSound } from "@/lib/use-feedback-sound";

import { finishLesson, startLesson, submitAnswer, type Summary, type Verdict } from "./lesson-actions";

type Phase = "answering" | "checking" | "feedback" | "done";

/**
 * Przebieg lekcji. Komponent pilnuje tylko kolejności zadań i tego, co widać na ekranie —
 * o tym, czy odpowiedź jest poprawna i ile jest za nią punktów, decyduje wyłącznie baza.
 */
export function LessonRunner({
  lessonId,
  courseSlug,
  exercises,
  targetLang,
  badgeNames,
}: {
  lessonId: string;
  courseSlug: string;
  exercises: Exercise[];
  targetLang: string;
  /** Kod odznaki -> nazwa z ikoną. Dziecko ma zobaczyć „Pierwszy krok”, nie `first_lesson`. */
  badgeNames: Record<string, string>;
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("answering");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const exercise = exercises[index];
  const total = exercises.length;

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
        const started = await startLesson(lessonId, keyRef.current);
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
        false,
      );
      if ("error" in result) {
        setError(result.error);
        setPhase("answering");
        return;
      }

      setVerdict(result.verdict);
      play(result.verdict.correct ? "correct" : "wrong");
      setPhase("feedback");
    },
    [exercise, lessonId, phase, play],
  );

  const next = useCallback(async () => {
    setVerdict(null);
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
    setPhase("done");
  }, [index, total]);

  if (phase === "done" && summary) {
    return <SummaryScreen summary={summary} courseSlug={courseSlug} badgeNames={badgeNames} />;
  }

  if (!exercise) {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <p>Ta lekcja nie ma jeszcze żadnych zadań.</p>
        <Link href={`/kurs/${courseSlug}`} className="btn-secondary">
          Wróć do mapy
        </Link>
      </div>
    );
  }

  const locked = phase !== "answering";

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/kurs/${courseSlug}`}
          className="back-link justify-center"
          style={{ minWidth: "2.75rem", minHeight: "2.75rem" }}
          aria-label="Przerwij lekcję"
        >
          ✕
        </Link>
        <div
          className="h-4 flex-1 overflow-hidden rounded-full"
          style={{ background: "var(--color-zinc-200)" }}
          role="progressbar"
          aria-valuenow={index}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-label="Postęp lekcji"
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.round((index / total) * 100)}%`, background: "var(--color-grass)" }}
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
        <span className="chip">
          {index + 1}/{total}
        </span>
      </div>

      {exercise.type === "listening" ? (
        <ListeningExercise exercise={exercise} locked={locked} onAnswer={handleAnswer} />
      ) : exercise.type === "listen_match" ? (
        <ListenMatchExercise exercise={exercise} locked={locked} onAnswer={handleAnswer} />
      ) : exercise.type === "match_pairs" ? (
        <MatchPairsExercise exercise={exercise} locked={locked} onAnswer={handleAnswer} targetLang={targetLang} />
      ) : exercise.type === "image_choice" ? (
        <ImageChoiceExercise
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          targetLang={targetLang}
          result={phase === "feedback" && verdict ? (verdict.correct ? "correct" : "wrong") : null}
          correctAnswer={
            phase === "feedback" && verdict && typeof verdict.correctAnswer === "string"
              ? verdict.correctAnswer
              : null
          }
        />
      ) : exercise.type === "sentence_order" ? (
        <SentenceOrderExercise exercise={exercise} locked={locked} onAnswer={handleAnswer} />
      ) : exercise.type === "translate_ab" || exercise.type === "fill_blank_choice" ? (
        <ChoiceExercise
          exercise={exercise}
          locked={locked}
          onAnswer={handleAnswer}
          targetLang={targetLang}
          result={phase === "feedback" && verdict ? (verdict.correct ? "correct" : "wrong") : null}
        />
      ) : (
        <TypingExercise exercise={exercise} locked={locked} onAnswer={handleAnswer} promptLang={targetLang} />
      )}

      {error && <p className="msg-error">{error}</p>}

      {phase === "feedback" && verdict && (
        <Feedback
          verdict={verdict}
          onNext={next}
          last={index + 1 >= total}
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
  last,
  showAnswer = true,
}: {
  verdict: Verdict;
  onNext: () => void;
  last: boolean;
  showAnswer?: boolean;
}) {
  const shown = showAnswer && typeof verdict.correctAnswer === "string" ? verdict.correctAnswer : null;

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
          {verdict.correct ? "🎉 " : "💪 "}
        </span>
        {verdict.correct ? (verdict.nearMiss ? "Prawie! Zaliczone" : "Brawo!") : "Nie tym razem"}
      </p>
      {!verdict.correct && shown && (
        <p style={{ color: "#8f2420" }}>
          Poprawnie: <strong>{shown}</strong>
        </p>
      )}
      {verdict.correct && verdict.points > 0 && <p style={{ color: "#0f5c37" }}>+{verdict.points} punktów</p>}
      <button type="button" className="btn-primary" onClick={onNext} autoFocus>
        {last ? "Zakończ lekcję" : "Dalej"}
      </button>
    </div>
  );
}

function SummaryScreen({
  summary,
  courseSlug,
  badgeNames,
}: {
  summary: Summary;
  courseSlug: string;
  badgeNames: Record<string, string>;
}) {
  const stars = "⭐".repeat(summary.stars) + "☆".repeat(3 - summary.stars);

  return (
    <div className="flex flex-col items-center gap-5 pt-6 text-center">
      <span className="anim-pop text-7xl" aria-hidden>
        {summary.passed ? "🏆" : "🌱"}
      </span>
      <h1>{summary.passed ? "Lekcja zaliczona!" : "Jeszcze trochę"}</h1>
      <p style={{ fontSize: "2.5rem", letterSpacing: "0.2em" }} aria-label={`${summary.stars} z 3 gwiazdek`}>
        {stars}
      </p>
      <p>
        Dobrze: <strong>{summary.correct}</strong> z <strong>{summary.total}</strong>
      </p>
      {summary.xp > 0 && <p className="chip">+{summary.xp} punktów za lekcję</p>}
      {summary.streak > 1 && <p className="chip">🔥 {summary.streak} dni z rzędu</p>}
      {summary.badges.length > 0 && (
        <p className="msg-ok">
          {summary.badges.length === 1 ? "Nowa odznaka!" : "Nowe odznaki!"}{" "}
          {summary.badges.map((code) => badgeNames[code] ?? code).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        <Link href={`/kurs/${courseSlug}`} className="btn-primary">
          Wróć do mapy
        </Link>
      </div>
    </div>
  );
}
