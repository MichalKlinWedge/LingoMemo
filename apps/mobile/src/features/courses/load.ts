import { dbErrorMessage } from '@lingomemo/core';

import { supabase } from '@/lib/supabase';

/**
 * Dane mapy kursu. Odpowiednik `apps/web/src/app/kurs/[slug]/page.tsx` — te same zapytania
 * i ten sam widok `v_my_lessons`, który dokłada do lekcji stan otwarcia i postęp ucznia.
 * Reguł (co jest otwarte, kiedy zamyka się kurs) nie liczymy tutaj: przychodzą z bazy.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type Course = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
};

export type Lesson = {
  id: string;
  unit_id: string | null;
  title: string;
  icon: string | null;
  kind: string;
  is_unlocked: boolean | null;
  status: string | null;
  stars: number | null;
  word_count: number | null;
  stage_count: number | null;
  stages_done: number | null;
};

export type Unit = { id: string; title: string; icon: string | null };

export type LevelRow = {
  lesson_id: string | null;
  level: number | null;
  status: string | null;
  is_unlocked: boolean | null;
  stars: number | null;
  exercise_count: number | null;
};

export type Gate = {
  active: boolean;
  due: number;
  limit: number;
  lessonId: string | null;
  passedToday: boolean;
  triedToday: boolean;
};

export type CourseMap = {
  course: Course;
  units: Unit[];
  lessons: Lesson[];
  levels: LevelRow[];
  /** Gwiazdki pojedynczych etapów: identyfikator lekcji -> (numer etapu -> gwiazdki). */
  stageStars: Record<string, Record<number, number>>;
  gate: Gate | null;
  /** Ukończone lekcje tego kursu — bez testu powtórkowego, który lekcją do zrobienia nie jest. */
  done: number;
};

/** Kursy, na które uczeń jest zapisany. Kurs bez zapisu jest w bazie zamknięty, więc go nie ma. */
export async function loadMyCourses(userId: string): Promise<Result<Course[]>> {
  const [{ data: courses, error }, { data: enrolled }] = await Promise.all([
    supabase.from('courses').select('id, slug, title, description, icon').order('sort_order'),
    // Filtr po użytkowniku mimo RLS: uczeń widzi tu tylko swoje zapisy, ale rodzic widzi też
    // zapisy dzieci — bez filtru miałby u siebie kursy, których sam się nie uczy.
    supabase.from('enrollments').select('course_id').eq('user_id', userId),
  ]);

  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wczytać kursów.') };

  const mine = new Set((enrolled ?? []).map((row) => row.course_id));
  return { ok: true, value: (courses ?? []).filter((course) => mine.has(course.id)) };
}

export async function loadCourseMap(slug: string, userId: string): Promise<Result<CourseMap>> {
  const { data: course, error: courseError } = await supabase
    .from('courses')
    .select('id, slug, title, description, icon')
    .eq('slug', slug)
    .maybeSingle();

  if (courseError) return { ok: false, error: dbErrorMessage(courseError, 'Nie udało się wczytać kursu.') };
  if (!course) return { ok: false, error: 'Nie ma takiego kursu.' };

  const [
    { data: units, error: unitsError },
    { data: lessons, error: lessonsError },
    { data: levels, error: levelsError },
    { data: stages, error: stagesError },
    { data: gate },
  ] = await Promise.all([
    supabase.from('units').select('id, title, icon, sort_order').eq('course_id', course.id).order('sort_order'),
    supabase.from('v_my_lessons').select('*').order('sort_order'),
    // Stan każdego poziomu każdej lekcji: kwadraciki średniego i trudnego pod kafelkiem.
    supabase.from('v_my_lesson_levels').select('*').order('level'),
    supabase.from('lesson_stage_progress').select('lesson_id, stage_nr, stars').eq('user_id', userId),
    // Bramka zaległych powtórek: przy dziesięciu zaległych słówkach kurs jest zamknięty do
    // zdanego testu. Regułę liczy baza — ekran tylko nazywa to, co z niej wyszło.
    supabase.rpc('review_gate', { p_course: course.id }),
  ]);

  // Błąd zapytania o poziomy albo etapy też musi być widoczny: po cichu znikają wtedy
  // kwadraciki, a ekran wygląda na poprawny — tak właśnie wygląda brak migracji w bazie.
  const error = unitsError ?? lessonsError ?? levelsError ?? stagesError;
  if (error) return { ok: false, error: dbErrorMessage(error, 'Nie udało się wczytać mapy kursu.') };

  const bramka = (gate as unknown as Gate | null) ?? null;
  const reviewLesson = bramka?.lessonId ?? null;
  const unitIds = new Set((units ?? []).map((unit) => unit.id));

  const stageStars: Record<string, Record<number, number>> = {};
  for (const row of stages ?? []) {
    if (row.lesson_id === null) continue;
    stageStars[row.lesson_id] ??= {};
    stageStars[row.lesson_id][row.stage_nr] = row.stars ?? 0;
  }

  // Widok wydaje lekcje wszystkich kursów ucznia, więc zostawiamy tylko działy tego kursu.
  const mine = (lessons ?? []).filter(
    (lesson) => lesson.unit_id !== null && unitIds.has(lesson.unit_id) && lesson.id !== reviewLesson,
  ) as Lesson[];

  return {
    ok: true,
    value: {
      course,
      units: (units ?? []).map(({ id, title, icon }) => ({ id, title, icon })),
      lessons: mine,
      levels: (levels ?? []) as LevelRow[],
      stageStars,
      gate: bramka,
      done: mine.filter((lesson) => lesson.status === 'completed').length,
    },
  };
}
