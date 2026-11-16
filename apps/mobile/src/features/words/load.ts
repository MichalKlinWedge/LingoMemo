import { dbErrorMessage } from '@lingomemo/core';

import { supabase } from '@/lib/supabase';

/**
 * Plansza ze słówkami lekcji — tryb nauki przed lekcją. Te same zapytania co na webie
 * (`apps/web/src/app/lekcja/[id]/nauka/page.tsx`): słówka lekcji, pojęcia z obrazkiem
 * i emoji, słowa główne w obu językach.
 *
 * Nic tu nie jest sprawdzane i nic nie wchodzi do powtórek — dziecko dotyka słowa, słyszy je
 * i czyta tłumaczenie.
 */
export type BoardWord = {
  conceptId: string;
  /** Emoji z `concepts.tags` albo pusty napis. */
  emoji: string;
  /** Ścieżka obrazka w buckecie, jeśli słówko go ma. */
  imagePath: string | null;
  source: string;
  target: string;
  ipa: string | null;
};

export type Board = {
  title: string;
  courseSlug: string;
  targetLang: string;
  kind: string;
  words: BoardWord[];
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function loadBoard(lessonId: string): Promise<Result<Board>> {
  const { data: lesson, error: lessonError } = await supabase
    .from('lessons')
    .select('id, title, kind, units!unit_id(courses!inner(slug, source_lang, target_lang))')
    .eq('id', lessonId)
    .maybeSingle();

  if (lessonError) return { ok: false, error: dbErrorMessage(lessonError, 'Nie udało się wczytać słówek.') };
  if (!lesson) return { ok: false, error: 'Nie ma takiej lekcji.' };

  const course = lesson.units.courses;

  const [{ data: items, error }, { data: languages }] = await Promise.all([
    supabase.from('lesson_items').select('concept_id, sort_order').eq('lesson_id', lessonId).order('sort_order'),
    supabase.from('languages').select('code, tts_lang').in('code', [course.source_lang, course.target_lang]),
  ]);

  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wczytać słówek.') };

  const conceptIds = (items ?? []).map((item) => item.concept_id);
  const [{ data: concepts }, { data: terms }] = await Promise.all([
    supabase.from('concepts').select('id, tags, image_path').in('id', conceptIds),
    supabase.from('terms').select('concept_id, lang, text, is_primary, ipa').in('concept_id', conceptIds),
  ]);

  /** Słowo główne w danym języku. Synonimy zostawiamy lekcji — na planszy mąciłyby obraz. */
  const primary = (conceptId: string, lang: string) =>
    (terms ?? []).find((term) => term.concept_id === conceptId && term.lang === lang && term.is_primary);

  const words: BoardWord[] = (items ?? []).flatMap((item) => {
    const target = primary(item.concept_id, course.target_lang);
    const source = primary(item.concept_id, course.source_lang);
    // Słówko bez którejś ze stron nie ma czego pokazać ani co przeczytać.
    if (!target || !source) return [];
    const concept = (concepts ?? []).find((row) => row.id === item.concept_id);
    return [
      {
        conceptId: item.concept_id,
        emoji: concept?.tags?.[0] ?? '',
        imagePath: concept?.image_path ?? null,
        source: source.text,
        target: target.text,
        ipa: target.ipa,
      },
    ];
  });

  return {
    ok: true,
    value: {
      title: lesson.title,
      courseSlug: course.slug,
      kind: lesson.kind,
      targetLang: (languages ?? []).find((row) => row.code === course.target_lang)?.tts_lang ?? course.target_lang,
      words,
    },
  };
}
