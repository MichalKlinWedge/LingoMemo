/** Typy zadań. Kolejność i nazwy muszą zgadzać się z enumem `public.exercise_type` w bazie. */
export const EXERCISE_TYPES = [
  'translate_ab',
  'translate_ba',
  'fill_blank_choice',
  'inflection',
  'listening',
  'match_pairs',
  'sentence_order',
  'listen_match',
  'image_choice',
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
  | { type: 'sentence_order'; prompt?: string; tokens: string[] }
  /**
   * Dopasowywanie ze słuchu. `audio` to słowa do przeczytania głosem (bez nich nie ma czego
   * wymówić), `words` to kafelki po polsku. Obie listy są potasowane osobno, więc rozwiązaniem
   * jest przyporządkowanie, a tego w payloadzie nie widać.
   */
  | {
      type: 'listen_match';
      instruction?: string;
      lang: string;
      audio: { text: string; audioPath?: string | null }[];
      words: string[];
    }
  /**
   * Wybór obrazka. `options` to ścieżki w buckecie `lesson-media` — publiczny adres składa
   * przeglądarka. `speak` i `lang` są opcjonalne: gdy są, nad obrazkami stoi głośnik i zadanie
   * jest „posłuchaj i wskaż” zamiast „przeczytaj i wskaż”.
   */
  | { type: 'image_choice'; prompt: string; options: string[]; speak?: string; lang?: string };

/** Co dziecko widzi nad zadaniem. Jedno miejsce, żeby nazwy nie rozjechały się między ekranami. */
export const EXERCISE_LABEL: Record<ExerciseType, string> = {
  translate_ab: 'Przetłumacz',
  translate_ba: 'Przetłumacz na polski',
  fill_blank_choice: 'Uzupełnij zdanie',
  inflection: 'Odmień słowo',
  listening: 'Posłuchaj i napisz',
  match_pairs: 'Połącz w pary',
  sentence_order: 'Ułóż zdanie',
  listen_match: 'Posłuchaj i dopasuj',
  image_choice: 'Wskaż obrazek',
};
