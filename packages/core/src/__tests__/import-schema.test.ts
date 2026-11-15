import { describe, expect, it } from 'vitest';

import { formatIssues, lessonImportSchema } from '../import-schema.ts';

/** Najmniejszy poprawny plik importu — punkt wyjścia dla testów błędów. */
function minimalLesson() {
  return {
    schemaVersion: 1 as const,
    course: 'pl-en-starter',
    unit: { slug: 'zwierzeta', title: 'Zwierzęta', sortOrder: 1 },
    lesson: { slug: 'domowe', title: 'Zwierzęta domowe', sortOrder: 1 },
    concepts: [
      {
        key: 'animal.dog',
        terms: { pl: [{ text: 'pies' }], en: [{ text: 'dog' }] },
      },
    ],
    exercises: [
      {
        type: 'translate_ab' as const,
        conceptKey: 'animal.dog',
        payload: { prompt: 'pies', accepted: ['dog'] },
      },
    ],
  };
}

describe('schemat importu', () => {
  it('przyjmuje minimalną poprawną lekcję i uzupełnia wartości domyślne', () => {
    const result = lessonImportSchema.safeParse(minimalLesson());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.lesson.kind).toBe('standard');
    expect(result.data.lesson.xpReward).toBe(50);
    expect(result.data.lesson.passThreshold).toBe(0.8);
    expect(result.data.exercises[0]?.points).toBe(10);
    expect(result.data.concepts[0]?.terms.pl?.[0]?.isPrimary).toBe(true);
  });

  it('odrzuca zadanie wskazujące na nieistniejące słówko', () => {
    const data = minimalLesson();
    data.exercises[0]!.conceptKey = 'animal.nieistnieje';
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).join(' ')).toContain('animal.nieistnieje');
  });

  it('odrzuca powtórzone klucze słówek', () => {
    const data = minimalLesson();
    data.concepts.push({ ...data.concepts[0]! });
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('wymaga, by poprawna odpowiedź była jedną z opcji', () => {
    const data = {
      ...minimalLesson(),
      exercises: [
        {
          type: 'fill_blank_choice' as const,
          payload: { sentence: 'My {{blank}} is here.', options: ['dog', 'cat'], answer: 'bird' },
        },
      ],
    };
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).join(' ')).toContain('musi być jedną z opcji');
  });

  it('wymaga znacznika {{blank}} w zdaniu z luką', () => {
    const data = {
      ...minimalLesson(),
      exercises: [
        {
          type: 'fill_blank_choice' as const,
          payload: { sentence: 'Tu nie ma luki.', options: ['dog', 'cat'], answer: 'dog' },
        },
      ],
    };
    expect(lessonImportSchema.safeParse(data).success).toBe(false);
  });

  it('wymaga, by rozsypankę dało się ułożyć z podanych klocków', () => {
    const data = {
      ...minimalLesson(),
      exercises: [
        {
          type: 'sentence_order' as const,
          payload: { tokens: ['I', 'have', 'a', 'dog'], solution: ['I', 'have', 'a', 'cat'] },
        },
      ],
    };
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).join(' ')).toContain('dokładnie z podanych słów');
  });

  it('nie pozwala na powtórzone słowa po jednej stronie par', () => {
    const data = {
      ...minimalLesson(),
      exercises: [
        {
          type: 'match_pairs' as const,
          payload: {
            pairs: [
              { a: 'pies', b: 'dog' },
              { a: 'pies', b: 'cat' },
              { a: 'ptak', b: 'bird' },
            ],
          },
        },
      ],
    };
    expect(lessonImportSchema.safeParse(data).success).toBe(false);
  });

  it('przyjmuje dopasowywanie ze słuchu i pilnuje liczby par', () => {
    const pairs = [
      { a: 'pies', b: 'dog' },
      { a: 'kot', b: 'cat' },
      { a: 'ptak', b: 'bird' },
    ];
    const withPairs = (list: { a: string; b: string }[]) => ({
      ...minimalLesson(),
      exercises: [{ type: 'listen_match' as const, payload: { lang: 'en-GB', pairs: list } }],
    });

    expect(lessonImportSchema.safeParse(withPairs(pairs)).success).toBe(true);
    // Dwie pary to już nie zadanie, siedem — za dużo jak na pamięć słuchową dziecka.
    expect(lessonImportSchema.safeParse(withPairs(pairs.slice(0, 2))).success).toBe(false);
    expect(
      lessonImportSchema.safeParse(
        withPairs([...pairs, { a: 'ryba', b: 'fish' }, { a: 'koń', b: 'horse' }, { a: 'krowa', b: 'cow' }, { a: 'owca', b: 'sheep' }]),
      ).success,
    ).toBe(false);
  });

  it('nie pozwala na powtórzone słowo w dopasowywaniu ze słuchu', () => {
    const data = {
      ...minimalLesson(),
      exercises: [
        {
          type: 'listen_match' as const,
          payload: {
            lang: 'en-GB',
            pairs: [
              { a: 'pies', b: 'dog' },
              { a: 'kot', b: 'dog' },
              { a: 'ptak', b: 'bird' },
            ],
          },
        },
      ],
    };
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).join(' ')).toContain('do odsłuchania');
  });

  it('przyjmuje wybór obrazka i pilnuje liczby obrazków', () => {
    const withOptions = (options: string[]) => ({
      ...minimalLesson(),
      exercises: [
        {
          type: 'image_choice' as const,
          conceptKey: 'animal.dog',
          payload: { prompt: 'pies', options, answer: '2026/pies.png' },
        },
      ],
    });

    expect(lessonImportSchema.safeParse(withOptions(['2026/pies.png', '2026/kot.png'])).success).toBe(true);
    // Jeden obrazek to nie wybór, pięć nie zmieści się na telefonie bez przewijania.
    expect(lessonImportSchema.safeParse(withOptions(['2026/pies.png'])).success).toBe(false);
    expect(
      lessonImportSchema.safeParse(
        withOptions(['2026/pies.png', '2026/kot.png', '2026/ptak.png', '2026/ryba.png', '2026/kon.png']),
      ).success,
    ).toBe(false);
    // Poprawnej odpowiedzi nie ma wśród obrazków.
    expect(lessonImportSchema.safeParse(withOptions(['2026/kot.png', '2026/ptak.png'])).success).toBe(false);
    // Ten sam obrazek dwa razy to dwie poprawne odpowiedzi, z których jedna liczy się jako błąd.
    expect(lessonImportSchema.safeParse(withOptions(['2026/pies.png', '2026/pies.png'])).success).toBe(false);
  });

  it('w wyborze obrazka żąda ścieżki pliku, nie adresu, i języka przy głosie', () => {
    const imageExercise = (payload: Record<string, unknown>) => ({
      ...minimalLesson(),
      exercises: [{ type: 'image_choice' as const, payload }],
    });

    const url = lessonImportSchema.safeParse(
      imageExercise({
        prompt: 'pies',
        options: ['https://example.com/pies.png', '2026/kot.png'],
        answer: 'https://example.com/pies.png',
      }),
    );
    expect(url.success).toBe(false);
    if (!url.success) expect(formatIssues(url.error).join(' ')).toContain('Obrazki');

    const noLang = lessonImportSchema.safeParse(
      imageExercise({
        prompt: 'pies',
        options: ['2026/pies.png', '2026/kot.png'],
        answer: '2026/pies.png',
        speak: 'dog',
      }),
    );
    expect(noLang.success).toBe(false);
    if (!noLang.success) expect(formatIssues(noLang.error).join(' ')).toContain('język');
  });

  it('wymaga dokładnie jednego słowa głównego na język', () => {
    const data = minimalLesson();
    data.concepts[0]!.terms.en = [{ text: 'dog' }, { text: 'doggy' }];
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).join(' ')).toContain('isPrimary');
  });

  it('ścieżka błędu wskazuje konkretne zadanie', () => {
    const base = minimalLesson();
    // Nowy obiekt, nie `push`: typ tablicy zostałby zawężony do pierwszego typu zadania.
    const data = {
      ...base,
      exercises: [
        ...base.exercises,
        { type: 'translate_ba', conceptKey: 'animal.dog', payload: { prompt: 'dog', accepted: [] } },
      ],
    };
    const result = lessonImportSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).some((line) => line.startsWith('exercises[1]'))).toBe(true);
  });
});
