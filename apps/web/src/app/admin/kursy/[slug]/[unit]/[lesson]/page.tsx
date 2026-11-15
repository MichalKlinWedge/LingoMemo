import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { AddWord, LessonSettings } from "../../../panels";

async function Lesson({ params }: { params: PageProps<"/admin/kursy/[slug]/[unit]/[lesson]">["params"] }) {
  const { slug, unit: unitSlug, lesson: lessonSlug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}/${unitSlug}/${lessonSlug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, slug, source_lang, target_lang")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) notFound();

  const { data: unit } = await supabase
    .from("units")
    .select("id, slug")
    .eq("course_id", course.id)
    .eq("slug", unitSlug)
    .maybeSingle();
  if (!unit) notFound();

  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, slug, title, icon, kind, sort_order, xp_reward, pass_threshold, prerequisite_lesson_id, is_published")
    .eq("unit_id", unit.id)
    .eq("slug", lessonSlug)
    .maybeSingle();
  if (!lesson) notFound();

  const [{ data: items, error }, { data: siblings }, { data: exercises }, { data: languages }] = await Promise.all([
    supabase.from("lesson_items").select("concept_id, sort_order").eq("lesson_id", lesson.id).order("sort_order"),
    supabase.from("lessons").select("id, title").eq("unit_id", unit.id).order("sort_order"),
    supabase.from("exercises").select("id, concept_id, type").eq("lesson_id", lesson.id),
    supabase.from("languages").select("code, name_pl"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const conceptIds = (items ?? []).map((item) => item.concept_id);
  const [{ data: concepts }, { data: terms }] = await Promise.all([
    supabase.from("concepts").select("id, key, tags").in("id", conceptIds),
    supabase.from("terms").select("concept_id, lang, text, is_primary").in("concept_id", conceptIds),
  ]);

  const nameOf = (code: string) => (languages ?? []).find((lang) => lang.code === code)?.name_pl ?? code;
  const termOf = (conceptId: string, lang: string) =>
    (terms ?? []).find((term) => term.concept_id === conceptId && term.lang === lang && term.is_primary)?.text ?? "—";
  const keyOf = (conceptId: string) => (concepts ?? []).find((concept) => concept.id === conceptId);
  const taskCount = (conceptId: string) => (exercises ?? []).filter((item) => item.concept_id === conceptId).length;

  const others = (siblings ?? []).filter((item) => item.id !== lesson.id);

  return (
    <>
      <PageHeader
        back={{ href: `/admin/kursy/${course.slug}/${unit.slug}`, label: "Lekcje" }}
        title={
          <>
            <span aria-hidden>{lesson.icon}</span> {lesson.title}
          </>
        }
        intro="Słówka lekcji. Każde nowe słówko dostaje od razu trzy zadania."
      />

      <LessonSettings lesson={lesson} unitId={unit.id} others={others} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Słówka ({(items ?? []).length})</h2>
        {(items ?? []).length === 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">
            Lekcja jest pusta — dla dziecka nie ma w niej jeszcze nic do zrobienia.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {(items ?? []).map((item) => {
            const concept = keyOf(item.concept_id);
            return (
              <li key={item.concept_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl" aria-hidden>
                    {concept?.tags?.[0]}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">
                      {termOf(item.concept_id, course.source_lang)} → {termOf(item.concept_id, course.target_lang)}
                    </span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">{concept?.key}</span>
                  </span>
                </span>
                <span className="chip">zadań: {taskCount(item.concept_id)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Zadania złożone ręcznie (rozsypanki, dopasowywanie par, luki w zdaniu) wchodzą{" "}
          <Link href="/admin/import" className="back-link">
            importem JSON
          </Link>
          .
        </p>
      </section>

      <AddWord
        lessonId={lesson.id}
        sourceLabel={nameOf(course.source_lang).toLowerCase()}
        targetLabel={nameOf(course.target_lang).toLowerCase()}
      />

      <Link href={`/lekcja/${lesson.id}`} className="btn-secondary self-start">
        Zobacz lekcję oczami dziecka
      </Link>
    </>
  );
}

export default function LessonPage({ params }: PageProps<"/admin/kursy/[slug]/[unit]/[lesson]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Lesson params={params} />
      </Suspense>
    </Shell>
  );
}
