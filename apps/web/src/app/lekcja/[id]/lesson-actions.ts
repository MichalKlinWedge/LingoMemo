"use server";

import type { Json } from "@lingomemo/db";

import type { Exercise } from "@/components/exercises/types";
import { requireUser } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Akcje silnika lekcji. Wszystkie tylko przekazują odpowiedź do bazy — ocena, punkty i stan
 * powtórek powstają w `submit_attempt`, nie tutaj. Przeglądarka nigdy nie wysyła wyniku.
 */

export type Verdict = {
  correct: boolean;
  nearMiss: boolean;
  /**
   * Baza nie oceniła odpowiedzi, tylko prosi o poprawienie literówki — bliska pomyłka
   * w zadaniu z pisaniem, raz na zadanie. Próba nie jest zapisana, więc nic się jeszcze
   * nie policzyło: dziecko poprawia i wysyła jeszcze raz.
   */
  retry?: boolean;
  /**
   * Po co poprawka: `typo` to pomyłka o literę, `order` to te same litery w złej kolejności
   * (przestawione wyrazy w zdaniu albo zamienione litery w słowie). Ekran mówi co innego
   * w każdym z tych dwóch przypadków — „zajrzyj w litery" nic nie da, gdy litery są dobre.
   */
  reason?: "typo" | "order";
  /** Dziecko kliknęło „Nie wiem" zamiast odpowiadać. Dla bazy to błąd, dla ekranu inny napis. */
  skipped?: boolean;
  grade: number;
  points: number;
  correctAnswer: Json;
  /**
   * Co usłyszane słowo znaczy po polsku. Tylko przy zadaniu ze słuchu i tylko po odpowiedzi:
   * „sandwich” da się napisać ze słuchu, nie wiedząc, co się napisało.
   */
  meaning?: string | null;
};

export type Summary = {
  total: number;
  correct: number;
  score: number;
  stars: number;
  /** Wynik ZAMKNIĘTEGO ETAPU. O całej lekcji mówi dopiero `lessonPassed`. */
  passed: boolean;
  xp: number;
  streak: number;
  badges: string[];
  stage: number;
  stages: number;
  stagesDone: number;
  level: number;
  lessonPassed: boolean;
};

export async function startLesson(
  lessonId: string,
  idempotencyKey: string,
  stage: number,
  level: number,
  /** Podgląd z panelu: omija zamki i brak publikacji, ale tylko administratorowi. */
  preview = false,
): Promise<{ sessionId: string } | { error: string }> {
  const { supabase } = await requireUser(`/lekcja/${lessonId}`);
  const { data, error } = await supabase.rpc("start_lesson_session", {
    p_lesson: lessonId,
    p_idempotency_key: idempotencyKey,
    p_stage: stage,
    p_level: level,
    p_preview: preview,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zacząć lekcji.") };
  return { sessionId: data as string };
}

/**
 * Podpowiedź: zamiana zadania na łatwiejszą wersję tego samego słówka. Pulę na dziś i wybór
 * zamiennika liczy baza — przeglądarka dostaje gotowe zadanie i to, ile podpowiedzi zostało.
 */
export async function askHint(
  sessionId: string,
  exerciseId: string,
): Promise<{ exercise: Exercise; hintsLeft: number } | { error: string }> {
  const { supabase } = await requireUser("/");
  const { data, error } = await supabase.rpc("use_hint", { p_session: sessionId, p_exercise: exerciseId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się wziąć podpowiedzi.") };

  const row = data as unknown as {
    id: string;
    type: string;
    conceptId: string | null;
    points: number;
    payload: Exercise["payload"];
    hintsLeft: number;
  };

  return {
    exercise: {
      id: row.id,
      type: row.type,
      // Numer w kolejności zostaje ten sam co zadania, które zastępuje — pasek postępu lekcji
      // liczy pozycje, a nie identyfikatory.
      sort_order: 0,
      concept_id: row.conceptId,
      points: row.points,
      payload: row.payload,
    },
    hintsLeft: row.hintsLeft,
  };
}

export async function submitAnswer(
  sessionId: string,
  exerciseId: string,
  answer: Record<string, Json>,
  responseMs: number | null,
  hintUsed: boolean,
): Promise<{ verdict: Verdict } | { error: string }> {
  const { supabase } = await requireUser("/");
  const { data, error } = await supabase.rpc("submit_attempt", {
    p_session: sessionId,
    p_exercise: exerciseId,
    p_answer: answer as Json,
    p_response_ms: responseMs ?? undefined,
    p_hint_used: hintUsed,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się sprawdzić odpowiedzi.") };
  return { verdict: data as unknown as Verdict };
}

/**
 * Zamknięcie lekcji, a po nim świeża pula podpowiedzi i stan punktów odblokowania.
 *
 * Jedno i drugie czytamy osobnym zapytaniem, zamiast dokładać do odpowiedzi
 * `finish_lesson_session`: nagroda za poziom nie jest tam niczym przyznawanym, tylko liczoną
 * na bieżąco z `lesson_level_progress` (średni dokłada podpowiedź, trudny daje punkt), więc
 * `hints_left()` i `unlock_status()` wiedzą o niej od razu. Po to, żeby ekran podsumowania mógł
 * powiedzieć dziecku, co właśnie dostało.
 */
export async function finishLesson(
  sessionId: string,
): Promise<{ summary: Summary; hintsLeft: number; unlockLeft: number } | { error: string }> {
  const { supabase, userId } = await requireUser("/");
  const { data, error } = await supabase.rpc("finish_lesson_session", { p_session: sessionId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zamknąć lekcji.") };

  const [{ data: hintsLeft }, { data: unlock }] = await Promise.all([
    supabase.rpc("hints_left"),
    supabase.rpc("unlock_status", { p_user: userId }),
  ]);
  return {
    summary: data as unknown as Summary,
    hintsLeft: hintsLeft ?? 0,
    unlockLeft: (unlock as { left?: number } | null)?.left ?? 0,
  };
}
