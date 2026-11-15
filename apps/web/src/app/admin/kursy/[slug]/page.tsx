import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { CourseSettings, EnrollmentButton, NewUnit } from "../panels";

async function Course({ params }: { params: PageProps<"/admin/kursy/[slug]">["params"] }) {
  const { slug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, slug, title, description, icon, source_lang, target_lang, sort_order, is_published")
    .eq("slug", slug)
    .maybeSingle();

  if (!course) notFound();

  const [
    { data: units, error: unitsError },
    { data: lessons },
    { data: students, error: studentsError },
    { data: enrolled },
    { data: languages },
    { count: words },
  ] = await Promise.all([
    supabase
      .from("units")
      .select("id, slug, title, icon, sort_order, is_published")
      .eq("course_id", course.id)
      .order("sort_order"),
    supabase.from("lessons").select("id, unit_id"),
    supabase.rpc("list_students"),
    supabase.from("enrollments").select("user_id").eq("course_id", course.id),
    supabase.from("languages").select("code, name_pl").eq("is_active", true).order("code"),
    // Liczba słówek rozstrzyga dwie rzeczy: czy wolno zmienić języki kursu i co zniknie z nim razem.
    supabase.from("concepts").select("id", { count: "exact", head: true }).eq("course_id", course.id),
  ]);

  const error = unitsError ?? studentsError;
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const lessonCount = (unitId: string) => (lessons ?? []).filter((lesson) => lesson.unit_id === unitId).length;
  const enrolledIds = new Set((enrolled ?? []).map((row) => row.user_id));
  const nextOrder = Math.max(0, ...(units ?? []).map((unit) => unit.sort_order)) + 1;
  const unitIds = new Set((units ?? []).map((unit) => unit.id));
  const counts = {
    units: (units ?? []).length,
    lessons: (lessons ?? []).filter((lesson) => unitIds.has(lesson.unit_id)).length,
    words: words ?? 0,
    students: enrolledIds.size,
  };

  return (
    <>
      <PageHeader
        back={{ href: "/admin/kursy", label: "Kursy" }}
        title={
          <>
            <span aria-hidden>{course.icon}</span> {course.title}
          </>
        }
        intro="Działy kursu i zapisani uczniowie."
      />

      <CourseSettings course={course} languages={languages ?? []} counts={counts} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Działy</h2>
        {(units ?? []).length === 0 && <p className="text-zinc-600 dark:text-zinc-400">Kurs nie ma jeszcze działów.</p>}
        <ul className="flex flex-col gap-3">
          {(units ?? []).map((unit) => (
            <li key={unit.id}>
              <Link
                href={`/admin/kursy/${course.slug}/${unit.slug}`}
                className="card flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl" aria-hidden>
                    {unit.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{unit.title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">
                      {unit.slug} · lekcji: {lessonCount(unit.id)}
                    </span>
                  </span>
                </span>
                <span className="chip">{unit.is_published ? "widoczny" : "ukryty"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <NewUnit courseId={course.id} nextOrder={nextOrder} />

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
