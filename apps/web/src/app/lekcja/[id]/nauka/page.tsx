import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { plural, WORDS } from "@lingomemo/core";

import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { WordBoard, type BoardWord } from "./word-board";

async function Board({ params }: { params: PageProps<"/lekcja/[id]/nauka">["params"] }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/lekcja/${id}/nauka`);

  // Polityka `lessons_read` przepuszcza tylko lekcję opublikowaną i otwartą dla tego dziecka,
  // więc zamknięta lekcja po prostu nie ma tu wiersza — tak samo jak przy wejściu do lekcji.
  // `units!unit_id`: lekcja wskazuje dział dwoma kluczami (zwykłym i zakresem powtórki).
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, title, icon, kind, units!unit_id(courses!inner(slug, title, source_lang, target_lang))")
    .eq("id", id)
    .maybeSingle();

  if (!lesson) notFound();

  const course = lesson.units.courses;

  const [{ data: items, error }, { data: languages }] = await Promise.all([
    supabase.from("lesson_items").select("concept_id, sort_order").eq("lesson_id", id).order("sort_order"),
    // Znacznik języka dla syntezatora bierzemy ze słownika, a nie zgadujemy z kodu kursu.
    supabase.from("languages").select("code, tts_lang").in("code", [course.source_lang, course.target_lang]),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const conceptIds = (items ?? []).map((item) => item.concept_id);
  const [{ data: concepts }, { data: terms }] = await Promise.all([
    supabase.from("concepts").select("id, tags, image_path").in("id", conceptIds),
    supabase.from("terms").select("concept_id, lang, text, is_primary, ipa, audio_path").in("concept_id", conceptIds),
  ]);

  /** Słowo główne w danym języku. Synonimy zostawiamy lekcji — na planszy mąciłyby obraz. */
  const primary = (conceptId: string, lang: string) =>
    (terms ?? []).find((term) => term.concept_id === conceptId && term.lang === lang && term.is_primary);

  const words: BoardWord[] = (items ?? []).flatMap((item) => {
    const target = primary(item.concept_id, course.target_lang);
    const source = primary(item.concept_id, course.source_lang);
    // Słówko bez którejś ze stron nie ma czego pokazać ani co przeczytać.
    if (!target || !source) return [];

    const concept = (concepts ?? []).find((row) => row.id === item.concept_id);
    return [
      {
        conceptId: item.concept_id,
        emoji: concept?.tags?.[0] ?? "",
        imagePath: concept?.image_path ?? null,
        source: source.text,
        target: target.text,
        ipa: target.ipa,
        audioPath: target.audio_path,
      },
    ];
  });

  const tts = (code: string) => (languages ?? []).find((row) => row.code === code)?.tts_lang ?? code;

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, { href: `/kurs/${course.slug}`, label: course.title }]}
        title={
          <>
            <span aria-hidden>🦉</span> {lesson.title}
          </>
        }
        intro={
          words.length === 0
            ? undefined
            : `Dotknij słówka, żeby je usłyszeć. ${plural(words.length, WORDS)} do nauczenia się przed lekcją.`
        }
      />

      {words.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          {lesson.kind === "review"
            ? "Powtórka nie ma własnych słówek — składa się z tego, co już przerabiałeś w innych lekcjach. Posłuchaj ich na planszy tamtej lekcji."
            : "Ta lekcja nie ma jeszcze słówek do posłuchania."}
        </p>
      ) : (
        <WordBoard words={words} targetLang={tts(course.target_lang)} />
      )}

      <Link href={`/lekcja/${id}`} className="btn-primary self-start">
        Zacznij lekcję
      </Link>
    </>
  );
}

export default function BoardPage({ params }: PageProps<"/lekcja/[id]/nauka">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Board params={params} />
      </Suspense>
    </Shell>
  );
}
