import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Flag } from "@/components/flag";
import { CRUMB_COURSES, CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { EnrollmentButton, UnitTable, type UnitRow } from "../panels";

async function Course({ params }: { params: PageProps<"/admin/kursy/[slug]">["params"] }) {
  const { slug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}`);

  // Tylko to, z czego ta strona składa nagłówek: dane do edycji kursu bierze jego wiersz
  // na liście kursów, bo tam się go teraz poprawia.
  const { data: course } = await supabase
    .from("courses")
    .select("id, slug, title, icon, target_lang")
    .eq("slug", slug)
    .maybeSingle();

  if (!course) notFound();

  const [
    { data: units, error: unitsError },
    { data: lessons },
    { data: items },
    { data: students, error: studentsError },
    { data: enrolled },
    { data: requests },
  ] = await Promise.all([
    supabase
      .from("units")
      .select("id, slug, title, icon, color, sort_order, is_published")
      .eq("course_id", course.id)
      .order("sort_order"),
    supabase.from("lessons").select("id, unit_id"),
    // Słówka działu: pozycje lekcji, nie słówka kursu — to samo słówko może być w dwóch lekcjach.
    supabase.from("lesson_items").select("lesson_id, concept_id"),
    supabase.rpc("list_students"),
    supabase.from("enrollments").select("user_id").eq("course_id", course.id),
    supabase.rpc("admin_course_requests"),
  ]);

  const error = unitsError ?? studentsError;
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const unitLessons = (unitId: string) => (lessons ?? []).filter((lesson) => lesson.unit_id === unitId);
  /** Różne słówka w całym dziale: ta sama para słów w dwóch lekcjach to jedno słówko. */
  const unitWords = (unitId: string) => {
    const lessonIds = new Set(unitLessons(unitId).map((lesson) => lesson.id));
    const concepts = (items ?? []).filter((item) => lessonIds.has(item.lesson_id)).map((item) => item.concept_id);
    return new Set(concepts).size;
  };

  const enrolledIds = new Set((enrolled ?? []).map((row) => row.user_id));
  const prosza = new Set((requests ?? []).filter((row) => row.course_id === course.id).map((row) => row.user_id));

  const unitRows: UnitRow[] = (units ?? []).map((unit) => ({
    ...unit,
    counts: { lessons: unitLessons(unit.id).length, words: unitWords(unit.id) },
  }));

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL, CRUMB_COURSES]}
        title={
          <>
            <Flag code={course.target_lang} fallback={course.icon} size={32} /> {course.title}
          </>
        }
        intro="Działy kursu i zapisani uczniowie."
      />

      <UnitTable courseId={course.id} courseSlug={course.slug} units={unitRows} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Kto się uczy tego kursu</h2>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Wypisanie nie kasuje postępów — po ponownym zapisaniu dziecko ma je z powrotem.
        </p>
        <ul className="flex flex-col gap-3">
          {(students ?? []).map((student) => (
            <li key={student.user_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {student.display_name}
                  {student.is_admin && " · administrator"}
                </span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{student.email}</span>
              </span>
              <span className="flex items-center gap-3">
                {/* Ślad prośby, nie zgłoszenie do odhaczenia: znika sam w chwili zapisu. */}
                {prosza.has(student.user_id) && <span className="chip">✋ prosi o dostęp</span>}
                <span className="chip">{enrolledIds.has(student.user_id) ? "zapisany" : "niezapisany"}</span>
                <EnrollmentButton
                  userId={student.user_id}
                  courseId={course.id}
                  enrolled={enrolledIds.has(student.user_id)}
                />
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Nagłówek siedzi w środku `<Suspense>`: sięgnięcie po `params` na zewnątrz blokuje
 *  prerenderowanie całej trasy i wywala build. */
export default function CoursePage({ params }: PageProps<"/admin/kursy/[slug]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Course params={params} />
      </Suspense>
    </Shell>
  );
}
