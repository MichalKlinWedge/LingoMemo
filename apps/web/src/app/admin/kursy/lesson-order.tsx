"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { moveItem, wouldMove } from "@lingomemo/core";

import { reorderLessonsAction } from "@/app/admin/kursy/actions";
import { type FormState, Status } from "@/components/forms";

export type LessonRow = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  kind: string;
  is_published: boolean;
  words: number;
};


/**
 * Lista lekcji z przestawianiem.
 *
 * Kolejność decyduje o tym, co dziecko widzi na mapie kursu, a dotąd zmieniało się ją polem
 * „Kolejność" w każdej lekcji z osobna — przy sześciu lekcjach to sześć wejść w formularz
 * i liczenie numerów w głowie.
 *
 * Uchwyt jest osobnym przyciskiem, nie całym wierszem: wiersz to link do lekcji, a przeciąganie
 * całego linku kończyłoby się jego upuszczeniem w pasku adresu. Ten sam przycisk obsługuje
 * strzałki góra/dół, bo przeciąganie nie działa z klawiatury ani dobrze palcem na tablecie.
 *
 * Każde przestawienie od razu leci do bazy, całą listą naraz — `admin_reorder_lessons`
 * przepisuje numery w jednej transakcji, więc lista nigdy nie zostaje w połowie przestawiona.
 */
export function LessonOrder({
  unitId,
  courseSlug,
  unitSlug,
  lessons,
}: {
  unitId: string;
  courseSlug: string;
  unitSlug: string;
  lessons: LessonRow[];
}) {
  const [state, action] = useActionState<FormState, FormData>(reorderLessonsAction, {});
  const [kolejnosc, setKolejnosc] = useState(lessons);
  const [ciagniete, setCiagniete] = useState<number | null>(null);

  function zapisz(nowa: LessonRow[]) {
    setKolejnosc(nowa);
    const dane = new FormData();
    dane.set("unit_id", unitId);
    dane.set("ids", nowa.map((lekcja) => lekcja.id).join(","));
    startTransition(() => action(dane));
  }

  function naKlawisz(event: React.KeyboardEvent, index: number) {
    const dokad = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
    if (dokad === null) return;
    event.preventDefault();
    if (wouldMove(kolejnosc, index, dokad)) zapisz(moveItem(kolejnosc, index, dokad));
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {kolejnosc.map((lesson, index) => (
          <li
            key={lesson.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (ciagniete === null) return;
              const skad = ciagniete;
              setCiagniete(null);
              if (wouldMove(kolejnosc, skad, index)) zapisz(moveItem(kolejnosc, skad, index));
            }}
            className={`card flex flex-wrap items-center gap-3 p-4 ${ciagniete === index ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              draggable
              onDragStart={() => setCiagniete(index)}
              onDragEnd={() => setCiagniete(null)}
              onKeyDown={(event) => naKlawisz(event, index)}
              className="btn-secondary cursor-grab px-3"
              style={{ minHeight: "3rem" }}
              aria-label={`Przenieś lekcję ${lesson.title}. Strzałki góra i dół zmieniają kolejność.`}
              title="Przeciągnij albo użyj strzałek"
            >
              <span aria-hidden>⠿</span>
            </button>

            <Link
              href={`/admin/kursy/${courseSlug}/${unitSlug}/${lesson.slug}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <span className="text-3xl" aria-hidden>
                {lesson.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{lesson.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">
                  {lesson.slug} · słówek: {lesson.words}
                  {lesson.kind === "review" && " · powtórka"}
                </span>
              </span>
            </Link>

            <span className="chip">{lesson.is_published ? "widoczna" : "ukryta"}</span>
          </li>
        ))}
      </ul>

      <Status state={state} />
    </div>
  );
}
