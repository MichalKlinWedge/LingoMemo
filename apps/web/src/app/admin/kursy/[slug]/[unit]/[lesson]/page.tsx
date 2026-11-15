import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { CRUMB_COURSES, CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { AddImageTask } from "../../../image-task";
import { AddWord, LessonSettings, WordTable, type WordRow } from "../../../panels";

async function Lesson({ params }: { params: PageProps<"/admin/kursy/[slug]/[unit]/[lesson]">["params"] }) {
  const { slug, unit: unitSlug, lesson: lessonSlug } = await params;
  const { supabase } = await requireAdmin(`/admin/kursy/${slug}/${unitSlug}/${lessonSlug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, slug, title, source_lang, target_lang")
    .eq("slug", slug)
    .maybeSingle();
  if (!course) notFound();

  const { data: unit } = await supabase
    .from("units")
    .select("id, slug, title")
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

  // Warunek wstępny wolno postawić na lekcji z dowolnego działu kursu, więc do wyboru idą
  // wszystkie lekcje kursu, pogrupowane działami — nie tylko te z tego działu.
  const { data: courseUnits } = await supabase
    .from("units")
    .select("id, title")
    .eq("course_id", course.id)
    .order("sort_order");

  const [
    { data: items, error },
    { data: siblings },
    { data: exercises },
    { data: languages },
    { count: children },
    { count: opened },
  ] = await Promise.all([
    supabase.from("lesson_items").select("concept_id, sort_order").eq("lesson_id", lesson.id).order("sort_order"),
    supabase
      .from("lessons")
      .select("id, title, unit_id")
      .in("unit_id", (courseUnits ?? []).map((item) => item.id))
      .order("sort_order"),
    supabase.from("exercises").select("id, concept_id, type").eq("lesson_id", lesson.id),
    supabase.from("languages").select("code, name_pl, tts_lang"),
    // Co przepadnie przy kasowaniu: postępy dzieci z tej lekcji i warunki wstępne innych lekcji.
    supabase.from("lesson_progress").select("user_id", { count: "exact", head: true }).eq("lesson_id", lesson.id),
    supabase.from("lessons").select("id", { count: "exact", head: true }).eq("prerequisite_lesson_id", lesson.id),
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
  /**
   * Wszystkie poprawne odpowiedzi w jednym polu, słowo główne na początku — dokładnie tak, jak
   * formularz je przyjmuje. Gdyby pokazywał samo słowo główne, pierwszy zapis skasowałby
   * synonimy, bo zapisuje się dokładnie to, co w polu stoi.
   */
  const termsOf = (conceptId: string, lang: string) => {
    const list = (terms ?? []).filter((term) => term.concept_id === conceptId && term.lang === lang);
    const primary = list.filter((term) => term.is_primary).map((term) => term.text);
    const rest = list.filter((term) => !term.is_primary).map((term) => term.text);
    return [...primary, ...rest].join(", ");
  };
  const keyOf = (conceptId: string) => (concepts ?? []).find((concept) => concept.id === conceptId);
  const taskCount = (conceptId: string) => (exercises ?? []).filter((item) => item.concept_id === conceptId).length;

  const others = (courseUnits ?? []).flatMap((item) =>
    (siblings ?? [])
      .filter((entry) => entry.unit_id === item.id && entry.id !== lesson.id)
      .map((entry) => ({ id: entry.id, title: entry.title, unit: item.title })),
  );

  // Zadanie z obrazkiem wskazuje słówko lekcji — bez niego nie wchodzi do powtórek.
  const words = (items ?? []).map((item) => ({
    id: item.concept_id,
    label: `${termOf(item.concept_id, course.source_lang)} → ${termOf(item.concept_id, course.target_lang)}`,
  }));
  // Bez `tts_lang` nie ma czym przeczytać słowa, więc głośnik w ogóle się nie pokazuje.
  const ttsLang = (languages ?? []).find((lang) => lang.code === course.target_lang)?.tts_lang ?? null;

  const rows: WordRow[] = (items ?? []).map((item) => ({
    conceptId: item.concept_id,
    emoji: keyOf(item.concept_id)?.tags?.[0] ?? "",
    source: termOf(item.concept_id, course.source_lang),
    target: termOf(item.concept_id, course.target_lang),
    sourceAll: termsOf(item.concept_id, course.source_lang),
    targetAll: termsOf(item.concept_id, course.target_lang),
    conceptKey: keyOf(item.concept_id)?.key ?? "",
    tasks: taskCount(item.concept_id),
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
        ]}
        title={
          <>
            <span aria-hidden>{lesson.icon}</span> {lesson.title}
          </>
        }
        intro="Słówka lekcji. Każde nowe słówko dostaje od razu trzy zadania."
      />

      <LessonSettings
        lesson={lesson}
        unitId={unit.id}
        others={others}
        courseSlug={course.slug}
        unitSlug={unit.slug}
        counts={{ exercises: (exercises ?? []).length, children: children ?? 0, opened: opened ?? 0 }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Słówka ({rows.length})</h2>
        <WordTable
          rows={rows}
          lessonId={lesson.id}
          sourceLabel={nameOf(course.source_lang).toLowerCase()}
          targetLabel={nameOf(course.target_lang).toLowerCase()}
        />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Zadanie z obrazkiem dodasz niżej. Reszta złożonych ręcznie (rozsypanki, dopasowywanie par
          i ze słuchu, luki w zdaniu) wchodzi{" "}
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

      <AddImageTask
        lessonId={lesson.id}
        words={words}
        speakLang={ttsLang}
        speakLabel={nameOf(course.target_lang)}
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
