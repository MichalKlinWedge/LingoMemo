import Link from "next/link";
import { Suspense } from "react";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { CourseTable } from "./panels";

async function Courses() {
  const { supabase } = await requireAdmin("/admin/kursy");

  // Liczniki wierszy bierzemy hurtem, a nie po jednym zapytaniu na kurs: kursów są jednostki,
  // a tak idzie to jedną rundą do bazy niezależnie od tego, ile ich przybędzie.
  const [
    { data: courses, error },
    { data: languages },
    { data: units, error: unitsError },
    { data: lessons },
    { data: concepts },
    { data: enrollments },
    { data: started },
    { data: requests },
  ] = await Promise.all([
    supabase
      .from("courses")
      .select("id, slug, title, description, icon, source_lang, target_lang, sort_order, is_published")
      .order("sort_order"),
    supabase.from("languages").select("code, name_pl").eq("is_active", true).order("code"),
    supabase.from("units").select("id, course_id"),
    supabase.from("lessons").select("unit_id"),
    supabase.from("concepts").select("course_id"),
    supabase.from("enrollments").select("course_id"),
    // Czy w kursie jest ślad nauki. Po tym kosz w wierszu wie, czy obiecywać skasowanie,
    // czy ukrycie — liczy to baza, bo śladów jest kilka rodzajów i leżą w trzech tabelach.
    supabase.rpc("list_courses_started"),
    // Kto prosi o dostęp. Bez tego trzeba by wejść w każdy kurs po kolei, żeby się dowiedzieć.
    supabase.rpc("admin_course_requests"),
  ]);

  const loadError = error ?? unitsError;
  if (loadError) return <p className="msg-error">{dbLoadError(loadError)}</p>;

  const courseOfUnit = new Map((units ?? []).map((unit) => [unit.id, unit.course_id]));
  const ile = <T,>(rows: T[] | null, klucz: (row: T) => string | null | undefined) => {
    const licznik = new Map<string, number>();
    for (const row of rows ?? []) {
      const id = klucz(row);
      if (id) licznik.set(id, (licznik.get(id) ?? 0) + 1);
    }
    return licznik;
  };

  const unitCount = ile(units ?? [], (unit) => unit.course_id);
  const lessonCount = ile(lessons ?? [], (lesson) => courseOfUnit.get(lesson.unit_id));
  const wordCount = ile(concepts ?? [], (concept) => concept.course_id);
  const studentCount = ile(enrollments ?? [], (enrollment) => enrollment.course_id);
  const zaczete = new Set((started ?? []).filter((row) => row.started).map((row) => row.course_id));

  const rows = (courses ?? []).map((course) => ({
    ...course,
    counts: {
      units: unitCount.get(course.id) ?? 0,
      lessons: lessonCount.get(course.id) ?? 0,
      words: wordCount.get(course.id) ?? 0,
      students: studentCount.get(course.id) ?? 0,
    },
    started: zaczete.has(course.id),
  }));

  const tytul = new Map((courses ?? []).map((course) => [course.id, course.title]));
  const slugKursu = new Map((courses ?? []).map((course) => [course.id, course.slug]));

  return (
    <>
      {/* Prośby stoją NAD tabelą, bo inaczej trzeba by wejść w każdy kurs, żeby je zobaczyć.
          Zapisanie dziecka jest w kursie — stąd odnośnik, a nie przycisk w tym miejscu. */}
      {(requests ?? []).length > 0 && (
        <section className="msg-warn flex flex-col gap-2">
          <span className="font-semibold">Prośby o dostęp</span>
          <ul className="flex flex-col gap-1">
            {(requests ?? []).map((request) => (
              <li key={`${request.user_id}-${request.course_id}`}>
                {request.display_name} prosi o kurs{" "}
                <Link href={`/admin/kursy/${slugKursu.get(request.course_id) ?? ""}`} className="underline">
                  {tytul.get(request.course_id) ?? "nieznany"}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <CourseTable courses={rows} languages={languages ?? []} />
    </>
  );
}

export default function CoursesPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Kursy"
        intro="Kurs → działy → lekcje → słówka. Ukryte treści widzi tylko administrator."
      />
      <Suspense fallback={<Loading />}>
        <Courses />
      </Suspense>
    </Shell>
  );
}
