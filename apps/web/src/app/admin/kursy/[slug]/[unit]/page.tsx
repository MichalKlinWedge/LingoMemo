import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CRUMB_COURSES, CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { LessonTable, type LessonRow } from "../../panels";

async function Unit({ params }: { params: PageProps<"/admin/kursy/[slug]/[unit]">["params"] }) {
  const { slug, unit: unitSlug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}/${unitSlug}`);

  const { data: course } = await supabase.from("courses").select("id, slug, title").eq("slug", slug).maybeSingle();
  if (!course) notFound();

  // Tylko to, z czego ta strona składa nagłówek: dane do edycji działu bierze jego wiersz
  // na stronie kursu, bo tam się go teraz poprawia.
  const { data: unit } = await supabase
    .from("units")
    .select("id, slug, title, icon")
    .eq("course_id", course.id)
    .eq("slug", unitSlug)
    .maybeSingle();

  if (!unit) notFound();

  // Warunek wstępny wolno postawić na lekcji z dowolnego działu kursu, więc do wyboru idą
  // wszystkie lekcje kursu, pogrupowane działami — nie tylko te z tego działu.
  const { data: courseUnits } = await supabase
    .from("units")
    .select("id, title")
    .eq("course_id", course.id)
    .order("sort_order");

  const [{ data: lessons, error }, { data: courseLessons }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, slug, title, icon, kind, sort_order, xp_reward, pass_threshold, prerequisite_lesson_id, is_published")
      .eq("unit_id", unit.id)
      .order("sort_order"),
    supabase
      .from("lessons")
      .select("id, title, unit_id")
      .in("unit_id", (courseUnits ?? []).map((item) => item.id))
      .order("sort_order"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  // Liczniki wierszy bierzemy hurtem, jednym zapytaniem na rodzaj: lekcji w dziale jest kilka,
  // a tak idzie to jedną rundą do bazy niezależnie od tego, ile ich przybędzie.
  const lessonIds = (lessons ?? []).map((lesson) => lesson.id);
  const [{ data: items }, { data: exercises }, { data: progress }, { data: opens }] = await Promise.all([
    supabase.from("lesson_items").select("lesson_id, concept_id").in("lesson_id", lessonIds),
    supabase.from("exercises").select("id, lesson_id").in("lesson_id", lessonIds),
    // Co przepadnie przy kasowaniu lekcji: postępy dzieci i warunki wstępne innych lekcji.
    supabase.from("lesson_progress").select("lesson_id, user_id").in("lesson_id", lessonIds),
    supabase.from("lessons").select("id, prerequisite_lesson_id").in("prerequisite_lesson_id", lessonIds),
  ]);

  const ile = <T,>(rows: T[] | null, klucz: (row: T) => string | null) => {
    const licznik = new Map<string, number>();
    for (const row of rows ?? []) {
      const id = klucz(row);
      if (id) licznik.set(id, (licznik.get(id) ?? 0) + 1);
    }
    return licznik;
  };

  const wordCount = ile(items ?? [], (item) => item.lesson_id);
  const exerciseCount = ile(exercises ?? [], (item) => item.lesson_id);
  const childCount = ile(progress ?? [], (item) => item.lesson_id);
  const openedCount = ile(opens ?? [], (item) => item.prerequisite_lesson_id);

  const others = (courseUnits ?? []).flatMap((item) =>
    (courseLessons ?? [])
      .filter((entry) => entry.unit_id === item.id)
      .map((entry) => ({ id: entry.id, title: entry.title, unit: item.title })),
  );

  const rows: LessonRow[] = (lessons ?? []).map((lesson) => ({
    ...lesson,
    counts: {
      words: wordCount.get(lesson.id) ?? 0,
      exercises: exerciseCount.get(lesson.id) ?? 0,
      children: childCount.get(lesson.id) ?? 0,
      opened: openedCount.get(lesson.id) ?? 0,
    },
  }));

  return (
    <>
      <PageHeader
        crumbs={[
          CRUMB_HOME,
          CRUMB_PANEL,
          CRUMB_COURSES,
          { href: `/admin/kursy/${course.slug}`, label: course.title },
        ]}
        title={
          <>
            <span aria-hidden>{unit.icon}</span> {unit.title}
          </>
        }
        intro="Lekcje w dziale. Kolejność decyduje o tym, co dziecko widzi na mapie kursu."
      />

      <LessonTable
        unitId={unit.id}
        courseSlug={course.slug}
        unitSlug={unit.slug}
        lessons={rows}
        others={others}
      />
    </>
  );
}

export default function UnitPage({ params }: PageProps<"/admin/kursy/[slug]/[unit]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Unit params={params} />
      </Suspense>
    </Shell>
  );
}
