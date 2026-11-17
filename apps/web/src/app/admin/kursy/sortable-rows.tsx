"use client";

import { Fragment, type ReactNode, startTransition, useActionState, useState } from "react";

import { moveItem, wouldMove } from "@lingomemo/core";

import { type FormState, Status } from "@/components/forms";

export type SortableTableRow = {
  id: string;
  /** Do etykiety uchwytu: „Przenieś dział Jedzenie". Czytnik ekranu nie widzi wiersza obok. */
  label: string;
  /** Komórki wiersza, po kolei — bez komórki uchwytu, tę dokłada tabela. */
  cells: ReactNode;
  /** Formularz rozwinięty pod wierszem. Brak znaczy „wiersz zwinięty". */
  expanded?: ReactNode;
};

/**
 * Tabela, w której da się przestawiać wiersze — używają jej działy w kursie i lekcje w dziale.
 *
 * Kolejność decyduje o tym, co dziecko widzi na ekranie kursu, a dotąd zmieniało się ją polem
 * „Kolejność" w każdym formularzu z osobna: przy sześciu lekcjach to sześć wejść w edycję
 * i liczenie numerów w głowie.
 *
 * Uchwyt jest osobnym przyciskiem, nie całym wierszem: w wierszu jest link, a przeciąganie linku
 * kończy się jego upuszczeniem w pasku adresu. Ten sam przycisk obsługuje strzałki góra/dół,
 * bo przeciąganie nie działa z klawiatury ani dobrze palcem na tablecie — to ta sama uwaga,
 * przez którą w zadaniach dla dziecka nie ma drag & drop.
 *
 * Każde przestawienie leci do bazy całą listą naraz: funkcja przepisuje numery w jednej
 * transakcji, więc lista nigdy nie zostaje przestawiona w połowie.
 */
export function SortableTable({
  parentId,
  action,
  rows,
  noun,
  head,
  columns,
}: {
  parentId: string;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  rows: SortableTableRow[];
  /** Biernik w etykiecie uchwytu: „lekcję" albo „dział". */
  noun: string;
  /** Nagłówki kolumn jako `<th>` po kolei, bez kolumny uchwytu. */
  head: ReactNode;
  /** Ile kolumn ma tabela razem z uchwytem — tyle zajmuje rozwinięty formularz. */
  columns: number;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [kolejnosc, setKolejnosc] = useState<string[]>(() => rows.map((row) => row.id));
  const [ciagniety, setCiagniety] = useState<number | null>(null);

  // W stanie trzymamy same identyfikatory, nie całe wiersze: zawartość przychodzi z góry i zmienia
  // się przy każdym rozwinięciu formularza, więc odłożona kopia pokazywałaby poprzednią. Wiersze,
  // o których ta kolejność nie wie (dopisane po odświeżeniu strony), lądują na końcu.
  const widoczne: SortableTableRow[] = [
    ...kolejnosc.flatMap((id) => rows.filter((row) => row.id === id)),
    ...rows.filter((row) => !kolejnosc.includes(row.id)),
  ];

  function zapisz(nowa: SortableTableRow[]) {
    setKolejnosc(nowa.map((row) => row.id));
    const dane = new FormData();
    dane.set("parent_id", parentId);
    dane.set("ids", nowa.map((row) => row.id).join(","));
    startTransition(() => formAction(dane));
  }

  function przestaw(skad: number, dokad: number) {
    if (wouldMove(widoczne, skad, dokad)) zapisz(moveItem(widoczne, skad, dokad));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card px-3 py-2">
        <table className="admin-table">
          <thead>
            <tr>
              {/* Kolumna uchwytu nie ma nagłówka do przeczytania. */}
              <th />
              {head}
            </tr>
          </thead>
          <tbody>
            {widoczne.map((row, index) => (
              <Fragment key={row.id}>
                <tr
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const skad = ciagniety;
                    setCiagniety(null);
                    if (skad !== null) przestaw(skad, index);
                  }}
                  className={ciagniety === index ? "opacity-50" : ""}
                >
                  <td className="w-10">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setCiagniety(index)}
                      onDragEnd={() => setCiagniety(null)}
                      onKeyDown={(event) => {
                        const dokad =
                          event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
                        if (dokad === null) return;
                        event.preventDefault();
                        przestaw(index, dokad);
                      }}
                      className="btn-row cursor-grab"
                      aria-label={`Przenieś ${noun} ${row.label}. Strzałki góra i dół zmieniają kolejność.`}
                      title="Przeciągnij albo użyj strzałek"
                    >
                      <span aria-hidden>⠿</span>
                    </button>
                  </td>
                  {row.cells}
                </tr>
                {row.expanded !== undefined && (
                  <tr>
                    <td colSpan={columns}>{row.expanded}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Status state={state} />
    </div>
  );
}
