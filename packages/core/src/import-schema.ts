/**
 * Format importu lekcji.
 *
 * To jest jedyne źródło prawdy dla kształtu danych wchodzących do aplikacji — baza sprawdza
 * payload zadań jeszcze raz (`validate_exercise_payload`), ale czytelne komunikaty o tym, co
 * jest nie tak z wklejonym JSON-em, powstają tutaj.
 *
 * Klucze naturalne (`course`, `unit.slug`, `lesson.slug`, `concept.key`) sprawiają, że ponowny
 * import tego samego pliku aktualizuje treść, zamiast ją dublować. Dlatego w formacie nie ma
 * żadnych identyfikatorów — plik da się napisać ręcznie albo wygenerować poza aplikacją.
 */
import { z } from 'zod';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'dozwolone małe litery, cyfry i myślniki');

const nonEmpty = z.string().trim().min(1, 'nie może być puste').max(300, 'najwyżej 300 znaków');

const langCode = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'kod języka, np. "pl" albo "en-GB"');

const termForm = z.object({
  label: nonEmpty.max(40),
  text: nonEmpty,
});

const term = z.object({
  text: nonEmpty,
  pos: z.enum(['noun', 'verb', 'adjective', 'adverb', 'phrase', 'other']).optional(),
  ipa: z.string().optional(),
  gender: z.string().max(10).optional(),
  article: z.string().max(10).optional(),
  audioPath: z.string().optional(),
  note: z.string().optional(),
  /** Synonimy mają `false`. Przy sprawdzaniu odpowiedzi liczą się wszystkie warianty. */
  isPrimary: z.boolean().default(true),
  forms: z.array(termForm).default([]),
});

const concept = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'np. "animal.dog"'),
    image: z.string().optional(),
    tags: z.array(z.string()).default([]),
    terms: z.record(langCode, z.array(term).min(1, 'przynajmniej jedno słowo')),
  })
  .refine(
    (value) => Object.values(value.terms).every((list) => list.filter((item) => item.isPrimary).length === 1),
    { message: 'każdy język musi mieć dokładnie jedno słowo główne (isPrimary)' },
  );

/** Wspólne pola każdego zadania. */
const exerciseBase = {
  conceptKey: z.string().optional(),
  points: z.number().int().min(0).max(1000).default(10),
};

const translatePayload = z.object({
  prompt: nonEmpty,
  accepted: z.array(nonEmpty).min(1, 'podaj przynajmniej jedną poprawną odpowiedź'),
  hint: z.string().optional(),
  /** Gdy są `options`, zadanie staje się wyborem z listy zamiast pisaniem. */
  options: z.array(nonEmpty).min(2).max(6).optional(),
});

const exercise = z.discriminatedUnion('type', [
  z.object({ ...exerciseBase, type: z.literal('translate_ab'), payload: translatePayload }),
  z.object({ ...exerciseBase, type: z.literal('translate_ba'), payload: translatePayload }),
  z.object({
    ...exerciseBase,
    type: z.literal('fill_blank_choice'),
    payload: z
      .object({
        sentence: nonEmpty.refine((value) => value.includes('{{blank}}'), 'zdanie musi zawierać {{blank}}'),
        options: z.array(nonEmpty).min(2).max(6),
        answer: nonEmpty,
        translation: z.string().optional(),
      })
      .refine((value) => value.options.includes(value.answer), {
        path: ['answer'],
        message: 'poprawna odpowiedź musi być jedną z opcji',
      })
      .refine((value) => new Set(value.options).size === value.options.length, {
        path: ['options'],
        message: 'opcje nie mogą się powtarzać',
      }),
  }),
  z.object({
    ...exerciseBase,
    type: z.literal('inflection'),
    payload: z.object({
      base: nonEmpty,
      formLabel: nonEmpty,
      instruction: z.string().optional(),
      accepted: z.array(nonEmpty).min(1),
    }),
  }),
  z.object({
    ...exerciseBase,
    type: z.literal('listening'),
    payload: z.object({
      speak: nonEmpty,
      lang: langCode,
      accepted: z.array(nonEmpty).min(1),
      audioPath: z.string().optional(),
    }),
  }),
  z.object({
    ...exerciseBase,
    type: z.literal('match_pairs'),
    payload: z
      .object({
        instruction: z.string().optional(),
        pairs: z.array(z.object({ a: nonEmpty, b: nonEmpty })).min(3).max(8),
      })
      .refine((value) => new Set(value.pairs.map((pair) => pair.a)).size === value.pairs.length, {
        path: ['pairs'],
        message: 'słowa po lewej nie mogą się powtarzać',
      })
      .refine((value) => new Set(value.pairs.map((pair) => pair.b)).size === value.pairs.length, {
        path: ['pairs'],
        message: 'słowa po prawej nie mogą się powtarzać',
      }),
  }),
  z.object({
    ...exerciseBase,
    type: z.literal('sentence_order'),
    payload: z
      .object({
        prompt: z.string().optional(),
        tokens: z.array(nonEmpty).min(2).max(12),
        solution: z.array(nonEmpty).min(2).max(12),
      })
      // Rozsypanka musi dać się ułożyć dokładnie z tych klocków, które dostaje dziecko.
      .refine(
        (value) =>
          [...value.tokens].sort().join('\u0000') === [...value.solution].sort().join('\u0000'),
        { path: ['solution'], message: 'rozwiązanie musi składać się dokładnie z podanych słów' },
      ),
  }),
]);

export const lessonImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    course: slug,
    unit: z.object({
      slug,
      title: nonEmpty,
      icon: z.string().optional(),
      color: z.string().optional(),
      sortOrder: z.number().int().min(0),
    }),
    lesson: z.object({
      slug,
      title: nonEmpty,
      icon: z.string().optional(),
      kind: z.enum(['standard', 'review', 'test']).default('standard'),
      sortOrder: z.number().int().min(0),
      xpReward: z.number().int().min(0).max(1000).default(50),
      passThreshold: z.number().min(0).max(1).default(0.8),
      /** „lekcja" albo „dzial/lekcja", gdy warunek jest w innym dziale. */
      prerequisiteLessonSlug: z.string().nullable().default(null),
      isPublished: z.boolean().default(true),
    }),
    concepts: z.array(concept).min(1, 'lekcja bez słówek nie ma sensu'),
    exercises: z.array(exercise).min(1, 'lekcja bez zadań nie ma sensu').max(60),
  })
  .superRefine((data, ctx) => {
    const keys = new Set(data.concepts.map((item) => item.key));
    if (keys.size !== data.concepts.length) {
      ctx.addIssue({ code: 'custom', path: ['concepts'], message: 'klucze słówek nie mogą się powtarzać' });
    }
    data.exercises.forEach((item, index) => {
      if (item.conceptKey !== undefined && !keys.has(item.conceptKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['exercises', index, 'conceptKey'],
          message: `nie ma słówka o kluczu "${item.conceptKey}"`,
        });
      }
    });
  });

export type LessonImport = z.infer<typeof lessonImportSchema>;

/** Błąd zod na jedną linijkę ze ścieżką, np. `exercises[3].payload.answer: …`. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path
      .map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`))
      .join('')
      .replace(/^\./, '');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}
