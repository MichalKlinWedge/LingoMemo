"use server";

import type { Json } from "@lingomemo/db";

import { requireUser } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Akcje silnika lekcji. Wszystkie tylko przekazują odpowiedź do bazy — ocena, punkty i stan
 * powtórek powstają w `submit_attempt`, nie tutaj. Przeglądarka nigdy nie wysyła wyniku.
 */

export type Verdict = {
  correct: boolean;
  nearMiss: boolean;
  /** Dziecko kliknęło „Nie wiem" zamiast odpowiadać. Dla bazy to błąd, dla ekranu inny napis. */
  skipped?: boolean;
  grade: number;
  points: number;
  correctAnswer: Json;
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
): Promise<{ sessionId: string } | { error: string }> {
  const { supabase } = await requireUser(`/lekcja/${lessonId}`);
  const { data, error } = await supabase.rpc("start_lesson_session", {
    p_lesson: lessonId,
    p_idempotency_key: idempotencyKey,
    p_stage: stage,
    p_level: level,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zacząć lekcji.") };
  return { sessionId: data as string };
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

export async function finishLesson(sessionId: string): Promise<{ summary: Summary } | { error: string }> {
  const { supabase } = await requireUser("/");
  const { data, error } = await supabase.rpc("finish_lesson_session", { p_session: sessionId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zamknąć lekcji.") };
  return { summary: data as unknown as Summary };
}
