import { notFound } from "next/navigation";
import { Suspense } from "react";

import type { Exercise } from "@/components/exercises/types";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { LessonRunner } from "./lesson-runner";

async function Lesson({
  params,
  searchParams,
}: {
  params: PageProps<"/lekcja/[id]">["params"];
  searchParams: PageProps<"/lekcja/[id]">["searchParams"];
}) {
  const { id } = await params;
  const { etap } = await searchParams;
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

  // Długa lekcja jest podzielona na etapy po najwyżej 15 zadań. Bez wskazania w adresie
  // zaczynamy od pierwszego niezaliczonego — dziecko wraca tam, gdzie skończyło.
  const [{ data: mapRow }, { data: stageProgress }] = await Promise.all([
    supabase.from("v_my_lessons").select("stage_count").eq("id", id).maybeSingle(),
    supabase.from("lesson_stage_progress").select("stage_nr, status").eq("lesson_id", id),
  ]);

  const stages = mapRow?.stage_count ?? 1;
  const done = new Set(
    (stageProgress ?? []).filter((row) => row.status === "completed").map((row) => row.stage_nr),
  );
  const firstOpen = Array.from({ length: stages }, (_, i) => i + 1).find((nr) => !done.has(nr)) ?? 1;
  const wanted = Number(Array.isArray(etap) ? etap[0] : etap);
  const stage = Number.isInteger(wanted) && wanted >= 1 && wanted <= stages ? wanted : firstOpen;

  // Zadania wydaje funkcja w bazie: bez poprawnych odpowiedzi i tylko dla otwartej lekcji.
  const { data: exercises, error } = await supabase.rpc("get_lesson_exercises", {
    p_lesson: id,
    p_stage: stage,
  });

  // Nazwy odznak, żeby na ekranie podsumowania nie wyświetlił się kod w rodzaju `first_lesson`.
  const { data: badges } = await supabase.from("badges").select("code, title, icon");
  const badgeNames = Object.fromEntries(
    (badges ?? []).map((badge) => [badge.code, `${badge.icon ?? "🏅"} ${badge.title}`]),
  );

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
      // Przejście do następnego etapu to ten sam adres z innym parametrem, więc React trzymałby
      // stan poprzedniego etapu (numer zadania, ekran podsumowania). Klucz wymusza świeży start.
      key={stage}
      lessonId={id}
      courseSlug={course.slug}
      exercises={(exercises ?? []) as unknown as Exercise[]}
      sourceLang={tts(course.source_lang)}
      targetLang={tts(course.target_lang)}
      badgeNames={badgeNames}
      stage={stage}
      stages={stages}
    />
  );
}

export default function LessonPage({ params, searchParams }: PageProps<"/lekcja/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Lesson params={params} searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
