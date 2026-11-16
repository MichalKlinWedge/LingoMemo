import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CRUMB_COURSES, CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { ExercisePanel, type ExerciseRow } from "../../exercise-panel";

/**
 * Zadania jednego słówka w jednej lekcji.
 *
 * Osobna strona, a nie kolejna rozwijanka w tabeli słówek: zadań bywa pięć, każde ma własną
 * treść na kilkanaście wierszy, a tabela słówek ma być listą do przeglądania, nie edytorem.
 */
async function Exercises({ params }: { params: PageProps<"/admin/zadania/[lesson]/[concept]">["params"] }) {
  const { lesson: lessonId, concept: conceptId } = await params;
  const { supabase } = await requireAdmin(`/admin/zadania/${lessonId}/${conceptId}`);

  // Lekcja razem z działem i kursem — potrzebne do okruszków i do powrotu na listę słówek.
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, title, slug, units!unit_id(slug, title, courses!inner(slug, title, source_lang, target_lang))")
    .eq("id", lessonId)
    .maybeSingle();

  if (!lesson) notFound();

  const unit = lesson.units;
  const course = unit.courses;

  const [{ data: concept }, { data: terms }, { data: exercises, error }] = await Promise.all([
    supabase.from("concepts").select("id, key").eq("id", conceptId).maybeSingle(),
    supabase.from("terms").select("lang, text, is_primary").eq("concept_id", conceptId),
    supabase
      .from("exercises")
      .select("id, type, level, points, is_active, sort_order, payload, easy_for")
      .eq("lesson_id", lessonId)
      .eq("concept_id", conceptId)
      .order("sort_order"),
  ]);

  if (!concept) notFound();
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const primary = (lang: string) =>
    (terms ?? []).find((term) => term.lang === lang && term.is_primary)?.text ?? "—";

  const rows: ExerciseRow[] = (exercises ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    level: row.level ?? 1,
    points: row.points,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    payload: JSON.stringify(row.payload, null, 2),
    easyFor: row.easy_for,
  }));

  return (
    <>
      <PageHeader
        crumbs={[
          CRUMB_HOME,
          CRUMB_PANEL,
          CRUMB_COURSES,
          { href: `/admin/kursy/${course.slug}`, label: course.title },
          { href: `/admin/kursy/${course.slug}/${unit.slug}`, label: unit.title },
          { href: `/admin/kursy/${course.slug}/${unit.slug}/${lesson.slug}`, label: lesson.title },
        ]}
        title={
          <>
            {primary(course.source_lang)} — {primary(course.target_lang)}
          </>
        }
        intro={`Zadania tego słówka w lekcji „${lesson.title}". Klucz: ${concept.key}.`}
      />

      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          To słówko nie ma w tej lekcji ani jednego zadania. Dodaj je przez import albo usuń słówko
          z lekcji — bez zadań dziecko i tak go nie zobaczy.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ExercisePanel row={row} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ExercisesPage({ params }: PageProps<"/admin/zadania/[lesson]/[concept]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Exercises params={params} />
      </Suspense>
    </Shell>
  );
}
