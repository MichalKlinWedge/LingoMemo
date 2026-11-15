"use client";

import { type ReactNode, startTransition, useActionState, useState } from "react";

import { moveItem, wouldMove } from "@lingomemo/core";

import { type FormState, Status } from "@/components/forms";

export type SortableRow = {
  id: string;
  /** Do etykiety przycisku: „Przenieś dział Jedzenie". Czytnik ekranu nie widzi wiersza obok. */
  label: string;
  content: ReactNode;
};

/**
 * Lista, w której da się przestawiać wiersze — używają jej lekcje w dziale i działy w kursie.
 *
 * Kolejność decyduje o tym, co dziecko widzi na mapie kursu, a dotąd zmieniało się ją polem
 * „Kolejność" w każdym formularzu z osobna: przy sześciu lekcjach to sześć wejść w edycję
 * i liczenie numerów w głowie.
 *
 * Uchwyt jest osobnym przyciskiem, nie całym wierszem: wiersz to link, a przeciąganie linku
 * kończy się jego upuszczeniem w pasku adresu. Ten sam przycisk obsługuje strzałki góra/dół,
 * bo przeciąganie nie działa z klawiatury ani dobrze palcem na tablecie — to ta sama uwaga,
 * przez którą w zadaniach dla dziecka nie ma drag & drop.
 *
 * Każde przestawienie leci do bazy całą listą naraz: funkcja przepisuje numery w jednej
 * transakcji, więc lista nigdy nie zostaje przestawiona w połowie.
 */
export function SortableRows({
  parentId,
  action,
  items,
  noun,
}: {
  parentId: string;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  items: SortableRow[];
  /** Biernik w etykiecie przycisku: „lekcję" albo „dział". */
  noun: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [kolejnosc, setKolejnosc] = useState(items);
  const [ciagniety, setCiagniety] = useState<number | null>(null);

  function zapisz(nowa: SortableRow[]) {
    setKolejnosc(nowa);
    const dane = new FormData();
    dane.set("parent_id", parentId);
    dane.set("ids", nowa.map((wiersz) => wiersz.id).join(","));
    startTransition(() => formAction(dane));
  }

  function przestaw(skad: number, dokad: number) {
    if (wouldMove(kolejnosc, skad, dokad)) zapisz(moveItem(kolejnosc, skad, dokad));
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {kolejnosc.map((wiersz, index) => (
          <li
            key={wiersz.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const skad = ciagniety;
              setCiagniety(null);
              if (skad !== null) przestaw(skad, index);
            }}
            className={`card flex flex-wrap items-center gap-3 p-4 ${ciagniety === index ? "opacity-50" : ""}`}
          >
            <button
              type="button"
              draggable
              onDragStart={() => setCiagniety(index)}
              onDragEnd={() => setCiagniety(null)}
              onKeyDown={(event) => {
                const dokad = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
                if (dokad === null) return;
                event.preventDefault();
                przestaw(index, dokad);
              }}
              className="btn-secondary cursor-grab px-3"
              style={{ minHeight: "3rem" }}
              aria-label={`Przenieś ${noun} ${wiersz.label}. Strzałki góra i dół zmieniają kolejność.`}
              title="Przeciągnij albo użyj strzałek"
            >
              <span aria-hidden>⠿</span>
            </button>

            {wiersz.content}
          </li>
        ))}
      </ul>

      <Status state={state} />
    </div>
  );
}
