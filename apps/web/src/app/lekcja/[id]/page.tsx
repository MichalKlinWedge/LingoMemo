import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { Exercise } from "@/components/exercises/types";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { LessonRunner } from "./lesson-runner";

async function Lesson({ params }: { params: PageProps<"/lekcja/[id]">["params"] }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/lekcja/${id}`);

  const { data: lesson } = await supabase
    .from("lessons")
    // `units!unit_id`: lekcja wskazuje na dział dwoma kluczami (zwykłym i zakresem powtórki),
    // więc PostgREST musi wiedzieć, o który chodzi.
    .select("id, title, units!unit_id(courses!inner(slug, source_lang, target_lang))")
    .eq("id", id)
    .maybeSingle();

  if (!lesson) notFound();

  const course = lesson.units.courses;

  // Znacznik języka dla syntezatora mowy bierzemy ze słownika, a nie zgadujemy z kodu kursu.
  const { data: languages } = await supabase
    .from("languages")
    .select("code, tts_lang")
    .in("code", [course.source_lang, course.target_lang]);

  const tts = (code: string) => languages?.find((l) => l.code === code)?.tts_lang ?? code;

  // Zadania wydaje funkcja w bazie: bez poprawnych odpowiedzi i tylko dla otwartej lekcji.
  const { data: exercises, error } = await supabase.rpc("get_lesson_exercises", { p_lesson: id });

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <span className="text-6xl" aria-hidden>
          🔒
        </span>
        <h1>{lesson.title}</h1>
        <p className="msg-error">{dbLoadError(error)}</p>
      </div>
    );
  }

  return (
    <LessonRunner
      lessonId={id}
      courseSlug={course.slug}
      exercises={(exercises ?? []) as unknown as Exercise[]}
      targetLang={tts(course.target_lang)}
    />
  );
}

export default function LessonPage({ params }: PageProps<"/lekcja/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Lesson params={params} />
      </Suspense>
    </Shell>
  );
}
