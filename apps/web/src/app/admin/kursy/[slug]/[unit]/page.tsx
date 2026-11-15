import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { NewLesson, UnitSettings } from "../../panels";

async function Unit({ params }: { params: PageProps<"/admin/kursy/[slug]/[unit]">["params"] }) {
  const { slug, unit: unitSlug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}/${unitSlug}`);

  const { data: course } = await supabase.from("courses").select("id, slug, title").eq("slug", slug).maybeSingle();
  if (!course) notFound();

  const { data: unit } = await supabase
    .from("units")
    .select("id, slug, title, icon, color, sort_order, is_published")
    .eq("course_id", course.id)
    .eq("slug", unitSlug)
    .maybeSingle();

  if (!unit) notFound();

  const [{ data: lessons, error }, { data: items }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, slug, title, icon, kind, sort_order, is_published")
      .eq("unit_id", unit.id)
      .order("sort_order"),
    supabase.from("lesson_items").select("lesson_id"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const words = (lessonId: string) => (items ?? []).filter((item) => item.lesson_id === lessonId).length;
  const nextOrder = Math.max(0, ...(lessons ?? []).map((lesson) => lesson.sort_order)) + 1;
  const others = (lessons ?? []).map((lesson) => ({ id: lesson.id, title: lesson.title }));

  return (
    <>
      <PageHeader
        back={{ href: `/admin/kursy/${course.slug}`, label: course.title }}
        title={
          <>
            <span aria-hidden>{unit.icon}</span> {unit.title}
          </>
        }
        intro="Lekcje w dziale. Kolejność decyduje o tym, co dziecko widzi na mapie kursu."
      />

      <UnitSettings unit={unit} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Lekcje</h2>
        {(lessons ?? []).length === 0 && <p className="text-zinc-600 dark:text-zinc-400">Dział nie ma jeszcze lekcji.</p>}
        <ul className="flex flex-col gap-3">
          {(lessons ?? []).map((lesson) => (
            <li key={lesson.id}>
              <Link
                href={`/admin/kursy/${course.slug}/${unit.slug}/${lesson.slug}`}
                className="card flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl" aria-hidden>
                    {lesson.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{lesson.title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">
                      {lesson.slug} · słówek: {words(lesson.id)}
                      {lesson.kind === "review" && " · powtórka"}
                    </span>
                  </span>
                </span>
                <span className="chip">{lesson.is_published ? "widoczna" : "ukryta"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <NewLesson unitId={unit.id} nextOrder={nextOrder} others={others} />
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
