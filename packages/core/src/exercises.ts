/** Typy zadań. Kolejność i nazwy muszą zgadzać się z enumem `public.exercise_type` w bazie. */
export const EXERCISE_TYPES = [
  'translate_ab',
  'translate_ba',
  'fill_blank_choice',
  'inflection',
  'listening',
  'match_pairs',
  'sentence_order',
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];

/**
 * Payload zadania w wersji, którą dostaje przeglądarka — bez kluczy odpowiedzi. Baza wycina
 * `accepted` / `answer` / `solution` w `get_lesson_exercises`, więc tych pól tu nie ma i być nie może.
 */
export type ExercisePayload =
  | { type: 'translate_ab'; prompt: string; hint?: string }
  | { type: 'translate_ba'; prompt: string; hint?: string }
  | { type: 'fill_blank_choice'; sentence: string; options: string[]; translation?: string }
  | { type: 'inflection'; base: string; formLabel: string; instruction?: string }
  | { type: 'listening'; speak: string; lang: string; audioPath?: string }
  | { type: 'match_pairs'; instruction?: string; pairsLeft: string[]; pairsRight: string[] }
  | { type: 'sentence_order'; prompt?: string; tokens: string[] };

/** Co dziecko widzi nad zadaniem. Jedno miejsce, żeby nazwy nie rozjechały się między ekranami. */
export const EXERCISE_LABEL: Record<ExerciseType, string> = {
  translate_ab: 'Przetłumacz',
  translate_ba: 'Przetłumacz na polski',
  fill_blank_choice: 'Uzupełnij zdanie',
  inflection: 'Odmień słowo',
  listening: 'Posłuchaj i napisz',
  match_pairs: 'Połącz w pary',
  sentence_order: 'Ułóż zdanie',
};
