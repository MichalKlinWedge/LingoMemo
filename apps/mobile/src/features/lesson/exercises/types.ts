import type { Json } from '@lingomemo/db';

import type { Answer, Exercise } from '@/features/lesson/api';

export type ExerciseProps = {
  exercise: Exercise;
  /** Zablokowane po udzieleniu odpowiedzi, na czas pokazywania informacji zwrotnej. */
  locked: boolean;
  onAnswer: (answer: Answer) => void;
  /**
   * Przejście dalej BEZ zapisywania próby. Dla zadania, którego nie da się zrobić nie z winy
   * dziecka — telefon bez głosu dla języka kursu. Pusta odpowiedź poszłaby do bazy jako błąd:
   * mniej gwiazdek i słówko cofnięte w powtórkach za cudzy brak syntezatora.
   */
  onSkip: () => void;
  /**
   * Czy dziecko ma już coś wpisane. Przebieg lekcji chowa wtedy „Nie wiem, pomiń”: ten przycisk
   * nie czyta pola, więc jedno dotknięcie obok „Sprawdź” kasowało gotową, poprawną odpowiedź.
   */
  onDraft?: (hasDraft: boolean) => void;
};

export const str = (value: Json | undefined): string => (typeof value === 'string' ? value : '');

export const list = (value: Json | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
