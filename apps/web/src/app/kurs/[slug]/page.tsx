import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LESSONS, plural, WORDS } from "@lingomemo/core";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function CourseMap({ params }: { params: PageProps<"/kurs/[slug]">["params"] }) {
  const { slug } = await params;
  const { supabase } = await requireUser(`/kurs/${slug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, icon")
    .eq("slug", slug)
    .maybeSingle();

  if (!course) notFound();

  const [{ data: units, error: unitsError }, { data: lessons, error: lessonsError }] = await Promise.all([
    supabase.from("units").select("id, title, icon, sort_order").eq("course_id", course.id).order("sort_order"),
    // Widok dokłada do lekcji stan otwarcia i postęp tego ucznia — jedno zapytanie zamiast trzech.
    supabase.from("v_my_lessons").select("*").order("sort_order"),
  ]);

  const error = unitsError ?? lessonsError;
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const byUnit = (unitId: string) => (lessons ?? []).filter((lesson) => lesson.unit_id === unitId);
  const done = (lessons ?? []).filter((lesson) => lesson.status === "completed").length;

  return (
    <>
      <PageHeader
        back={{ href: "/", label: "Kursy" }}
        title={
          <>
            <span aria-hidden>{course.icon}</span> {course.title}
          </>
        }
        intro={`Ukończone: ${plural(done, LESSONS)}`}
      />

      {(units ?? []).map((unit) => (
        <section key={unit.id} className="flex flex-col gap-4">
          <h2>
            <span aria-hidden>{unit.icon} </span>
            {unit.title}
          </h2>
          <ul className="flex flex-wrap gap-4">
            {byUnit(unit.id).map((lesson) => {
              const state = lesson.status === "completed" ? "done" : lesson.is_unlocked ? "available" : "locked";
              const label = `${lesson.title}${state === "locked" ? " — zamknięta" : ""}`;

              const tile = (
                <>
                  <span aria-hidden>{state === "locked" ? "🔒" : (lesson.icon ?? "📘")}</span>
                  {state === "done" && (
                    <span className="text-base" aria-hidden>
                      {"⭐".repeat(lesson.stars ?? 0)}
                    </span>
                  )}
                </>
              );

              return (
                <li key={lesson.id} className="flex w-24 flex-col items-center gap-2 text-center">
                  {state === "locked" ? (
                    <div className="tile" data-state="locked" aria-label={label} title="Najpierw skończ poprzednią lekcję">
                      {tile}
                    </div>
                  ) : (
                    <Link href={`/lekcja/${lesson.id}`} className="tile" data-state={state} aria-label={label}>
                      {tile}
                    </Link>
                  )}
                  <span className="text-base leading-tight">{lesson.title}</span>
                  <span className="text-sm text-zinc-500">{plural(lesson.word_count ?? 0, WORDS)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function CoursePage({ params }: PageProps<"/kurs/[slug]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <CourseMap params={params} />
      </Suspense>
    </Shell>
  );
}
