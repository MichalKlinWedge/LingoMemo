import { dbErrorMessage } from '@lingomemo/core';
import type { Json } from '@lingomemo/db';
import * as Crypto from 'expo-crypto';

import { supabase } from '@/lib/supabase';

/**
 * Silnik lekcji po stronie telefonu — dokładnie te same funkcje bazy, które woła web
 * (`apps/web/src/app/lekcja/[id]/lesson-actions.ts`). Wszystkie tylko przekazują odpowiedź:
 * ocena, punkty i stan powtórek powstają w `submit_attempt`, nie tutaj. Telefon nigdy nie
 * wysyła wyniku ani liczby punktów.
 *
 * Na webie te wywołania są Server Actions, bo przeglądarka nie ma pokazywać kluczy odpowiedzi.
 * Tutaj nie ma serwera aplikacji i nie jest potrzebny: praw pilnuje RLS, a klucze wycina
 * `get_lesson_exercises`.
 */

/** Zadanie w wersji, jaką dostaje klient — bez poprawnych odpowiedzi. */
export type Exercise = {
  id: string;
  type: string;
  sort_order: number;
  concept_id: string | null;
  points: number;
  payload: Record<string, Json>;
};

/** Co komponent zadania oddaje do sprawdzenia. Kształt musi pasować do `submit_attempt`. */
export type Answer = Record<string, Json>;

export type Verdict = {
  correct: boolean;
  nearMiss: boolean;
  /**
   * Baza nie oceniła odpowiedzi, tylko prosi o poprawienie literówki — raz na zadanie. Próba
   * nie jest zapisana, więc nic się jeszcze nie policzyło: dziecko poprawia i wysyła znowu.
   */
  retry?: boolean;
  /** Po co poprawka: `typo` to pomyłka o literę, `order` to te same litery w złej kolejności. */
  reason?: 'typo' | 'order';
  /** Dziecko wybrało „Nie wiem”. Dla bazy to błąd, dla ekranu inny napis. */
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

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Klucz idempotencji sesji: po zerwanym połączeniu ponowne wysłanie wraca do tej samej sesji. */
export const sessionKey = (): string => Crypto.randomUUID();

export async function startLesson(
  lessonId: string,
  idempotencyKey: string,
  stage: number,
  level: number,
): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('start_lesson_session', {
    p_lesson: lessonId,
    p_idempotency_key: idempotencyKey,
    p_stage: stage,
    p_level: level,
    // Podglądu z panelu na telefonie nie ma — telefon jest tylko dla ucznia.
    p_preview: false,
  });
  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się zacząć lekcji.') };
  return { ok: true, value: data as unknown as string };
}

/**
 * Podpowiedź: zamiana zadania na łatwiejszą wersję tego samego słówka. Pulę na dziś i wybór
 * zamiennika liczy baza — klient dostaje gotowe zadanie i to, ile podpowiedzi zostało.
 */
export async function askHint(
  sessionId: string,
  exerciseId: string,
): Promise<Result<{ exercise: Exercise; hintsLeft: number }>> {
  const { data, error } = await supabase.rpc('use_hint', { p_session: sessionId, p_exercise: exerciseId });
  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wziąć podpowiedzi.') };

  const row = data as unknown as {
    id: string;
    type: string;
    conceptId: string | null;
    points: number;
    payload: Record<string, Json>;
    hintsLeft: number;
  };

  return {
    ok: true,
    value: {
      exercise: {
        id: row.id,
        type: row.type,
        // Numer w kolejności zostaje ten sam co zadania, które zastępuje — pasek postępu
        // liczy pozycje, a nie identyfikatory.
        sort_order: 0,
        concept_id: row.conceptId,
        points: row.points,
        payload: row.payload,
      },
      hintsLeft: row.hintsLeft,
    },
  };
}

export async function submitAnswer(
  sessionId: string,
  exerciseId: string,
  answer: Answer,
  responseMs: number | null,
  hintUsed: boolean,
): Promise<Result<Verdict>> {
  const { data, error } = await supabase.rpc('submit_attempt', {
    p_session: sessionId,
    p_exercise: exerciseId,
    p_answer: answer as Json,
    p_response_ms: responseMs ?? undefined,
    p_hint_used: hintUsed,
  });
  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się sprawdzić odpowiedzi.') };
  return { ok: true, value: data as unknown as Verdict };
}

/**
 * Ile punktów odblokowania zostało na koncie. Konto bierzemy z zapisanej sesji, a nie z bazy:
 * `unlock_status` pyta o nie wprost, a przebieg lekcji identyfikatora ucznia nie potrzebuje
 * do niczego innego.
 */
export async function unlockLeft(): Promise<number> {
  const { data: stored } = await supabase.auth.getSession();
  const userId = stored.session?.user.id ?? null;
  if (userId === null) return 0;

  const { data } = await supabase.rpc('unlock_status', { p_user: userId });
  return (data as { left?: number } | null)?.left ?? 0;
}

/**
 * Zamknięcie etapu, a po nim świeża pula podpowiedzi i stan punktów odblokowania. Jedno i drugie
 * czytamy osobnym zapytaniem, bo nagroda za poziom nie jest niczym przyznawanym
 * w `finish_lesson_session` — liczą ją `hints_left()` i `unlock_status()` na bieżąco
 * z `lesson_level_progress` (średni dokłada podpowiedź, trudny daje punkt).
 */
export async function finishLesson(
  sessionId: string,
): Promise<Result<{ summary: Summary; hintsLeft: number; unlockLeft: number }>> {
  const { data, error } = await supabase.rpc('finish_lesson_session', { p_session: sessionId });
  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się zamknąć lekcji.') };

  const [{ data: hintsLeft }, unlocks] = await Promise.all([supabase.rpc('hints_left'), unlockLeft()]);
  return {
    ok: true,
    value: { summary: data as unknown as Summary, hintsLeft: hintsLeft ?? 0, unlockLeft: unlocks },
  };
}
