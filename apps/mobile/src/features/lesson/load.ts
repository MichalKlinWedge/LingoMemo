import { dbErrorMessage } from '@lingomemo/core';

import type { Exercise } from '@/features/lesson/api';
import { supabase } from '@/lib/supabase';

/**
 * Wszystko, czego przebieg lekcji potrzebuje przed pierwszym zadaniem. Na webie składa to
 * komponent serwerowy (`apps/web/src/app/lekcja/[id]/page.tsx`) — tutaj jedna funkcja, bo
 * telefon rozmawia z bazą wprost. Reguły są przepisane co do kropki: etap bez wskazania to
 * pierwszy niezaliczony, poziom średni i trudny nie mają etapów, a zadania wydaje
 * `get_lesson_exercises` (bez kluczy odpowiedzi).
 */
export type LessonData = {
  title: string;
  courseSlug: string;
  /** Znaczniki dla syntezatora mowy ze słownika `languages`, nie z kodu kursu. */
  sourceLang: string;
  targetLang: string;
  exercises: Exercise[];
  stage: number;
  stages: number;
  level: number;
  hintsLeft: number;
  /** Punkty odblokowania sprzed lekcji — po zamknięciu poznajemy po różnicy, czy przybył nowy. */
  unlockLeft: number;
  autoNextMs: number;
  badgeNames: Record<string, string>;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function loadLesson(
  lessonId: string,
  userId: string,
  wanted: { stage?: number; level?: number },
): Promise<Result<LessonData>> {
  const { data: lesson, error: lessonError } = await supabase
    .from('lessons')
    // `units!unit_id`: lekcja wskazuje na dział dwoma kluczami (zwykłym i zakresem powtórki),
    // więc PostgREST musi wiedzieć, o który chodzi.
    .select('id, title, units!unit_id(courses!inner(slug, source_lang, target_lang))')
    .eq('id', lessonId)
    .maybeSingle();

  if (lessonError) return { ok: false, error: dbErrorMessage(lessonError, 'Nie udało się wczytać lekcji.') };
  if (!lesson) return { ok: false, error: 'Nie ma takiej lekcji.' };

  const course = lesson.units.courses;

  const [{ data: languages }, { data: mapRow }, { data: stageProgress }] = await Promise.all([
    supabase.from('languages').select('code, tts_lang').in('code', [course.source_lang, course.target_lang]),
    supabase.from('v_my_lessons').select('stage_count').eq('id', lessonId).maybeSingle(),
    // Filtr po użytkowniku mimo RLS: uczeń widzi w tej tabeli tylko swoje wiersze, ale konto
    // z szerszymi prawami widzi więcej — bez filtru etap wyszedłby z cudzego podejścia.
    supabase
      .from('lesson_stage_progress')
      .select('stage_nr, status')
      .eq('lesson_id', lessonId)
      .eq('user_id', userId),
  ]);

  const tts = (code: string) => languages?.find((row) => row.code === code)?.tts_lang ?? code;

  // Poziom z adresu: łatwy (bez parametru) to lekcja z etapami, średni i trudny to jedno
  // krótkie wejście na ośmiu losowych słówkach — więc etapów tam nie ma.
  const level = wanted.level === 2 || wanted.level === 3 ? wanted.level : 1;
  const stages = level > 1 ? 1 : (mapRow?.stage_count ?? 1);

  const done = new Set(
    (stageProgress ?? []).filter((row) => row.status === 'completed').map((row) => row.stage_nr),
  );
  const firstOpen = Array.from({ length: stages }, (_, i) => i + 1).find((nr) => !done.has(nr)) ?? 1;
  const stage =
    wanted.stage !== undefined && Number.isInteger(wanted.stage) && wanted.stage >= 1 && wanted.stage <= stages
      ? wanted.stage
      : firstOpen;

  const [
    { data: exercises, error },
    { data: hintsLeft },
    { data: unlock },
    { data: autoNextSeconds },
    { data: badges },
  ] = await Promise.all([
    supabase.rpc('get_lesson_exercises', {
      p_lesson: lessonId,
      p_stage: stage,
      p_level: level,
      p_preview: false,
    }),
    supabase.rpc('hints_left'),
    // Punkty odblokowania sprzed lekcji: za zaliczony poziom trudny przybywa jeden, a różnica
    // mówi podsumowaniu, czy ma o nim powiedzieć.
    supabase.rpc('unlock_status', { p_user: userId }),
    // Czas automatycznego przejścia dalej jest ustawieniem aplikacji, nie stałą w kodzie:
    // właściwa wartość wychodzi dopiero z obserwacji dziecka przy lekcji.
    supabase.rpc('setting_int', { p_key: 'auto_next_seconds', p_default: 6 }),
    supabase.from('badges').select('code, title, icon'),
  ]);

  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się pobrać zadań.') };

  return {
    ok: true,
    value: {
      title: lesson.title,
      courseSlug: course.slug,
      sourceLang: tts(course.source_lang),
      targetLang: tts(course.target_lang),
      exercises: (exercises ?? []) as unknown as Exercise[],
      stage,
      stages,
      level,
      hintsLeft: hintsLeft ?? 0,
      unlockLeft: (unlock as { left?: number } | null)?.left ?? 0,
      autoNextMs: (autoNextSeconds ?? 6) * 1000,
      badgeNames: Object.fromEntries(
        (badges ?? []).map((badge) => [badge.code, `${badge.icon ?? '🏅'} ${badge.title}`]),
      ),
    },
  };
}
