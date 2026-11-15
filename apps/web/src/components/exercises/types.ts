import type { Json } from "@lingomemo/db";

/** Zadanie w wersji, jaką dostaje przeglądarka — bez poprawnych odpowiedzi. */
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

export type ExerciseProps = {
  exercise: Exercise;
  /** Zablokowane po udzieleniu odpowiedzi, na czas pokazywania informacji zwrotnej. */
  locked: boolean;
  onAnswer: (answer: Answer) => void;
  /**
   * Przejście dalej BEZ zapisywania próby. Dla zadania, którego nie da się zrobić nie z winy
   * dziecka — przeglądarka bez głosu dla języka. Pusta odpowiedź poszłaby do bazy jako błąd:
   * mniej gwiazdek i słówko cofnięte w harmonogramie powtórek za cudzy brak syntezatora.
   */
  onSkip: () => void;
};

export const str = (value: Json | undefined): string => (typeof value === "string" ? value : "");
export const list = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
