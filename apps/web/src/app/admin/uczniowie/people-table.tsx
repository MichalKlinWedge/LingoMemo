"use client";

import Link from "next/link";
import { Fragment, useState } from "react";

import { PasswordForm } from "@/app/admin/konta/password-form";

import { FamilyPanel, type Osoba } from "./family-panel";

/** Jeden wiersz tabeli. Daty i czas są już sformatowane na serwerze — tu tylko się je rysuje. */
export type PersonRow = {
  userId: string;
  displayName: string;
  email: string;
  /** „administrator", „rodzic" albo „uczeń" — jedna rola na wiersz. */
  role: string;
  isParent: boolean;
  childIds: string[];
  /** Rodzic czeka na przypisanie dziecka. */
  waiting: boolean;
  self: boolean;
  points: number;
  lessons: number;
  streak: number;
  time: string;
  /** Daty konta jednym zdaniem: ostatnia nauka, założenie, logowanie, hasło, prośba. */
  details: string;
};

/**
 * Konta jako tabela.
 *
 * Wcześniej każda osoba była kartą z chipami i dwiema rozwijankami — przy kilku kontach
 * zajmowało to cały ekran, a porównanie „kto ile zrobił" wymagało przewijania. Teraz jeden
 * wiersz na osobę, a daty konta, przypisywanie dzieci i zmiana hasła rozwijają się pod tym
 * wierszem, który się akurat poprawia.
 *
 * Otwarty jest najwyżej jeden wiersz: formularz hasła ma pole z wartością wziętą przy wejściu
 * na stronę, a kilka otwartych naraz kusi, żeby wpisać coś w dwóch i zapisać jeden.
 */
export function PeopleTable({ rows, people }: { rows: PersonRow[]; people: Osoba[] }) {
  const [otwarte, setOtwarte] = useState<string | null>(null);

  return (
    <div className="card overflow-x-auto px-3 py-2">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Kto</th>
            <th>Rola</th>
            <th className="hidden text-right sm:table-cell">Punkty</th>
            <th className="hidden text-right sm:table-cell">Lekcje</th>
            <th className="hidden text-right sm:table-cell">Seria</th>
            <th className="hidden text-right sm:table-cell">Czas</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = otwarte === row.userId;
            return (
              <Fragment key={row.userId}>
                <tr>
                  <td>
                    <span className="flex flex-col">
                      {/* Imię prowadzi do karty dziecka — tam jest wykres i słabe słówka. */}
                      <Link href={`/admin/uczniowie/${row.userId}`} className="font-semibold hover:text-brand">
                        {row.displayName}
                        {row.self && " · to Ty"}
                      </Link>
                      <span className="text-sm text-zinc-500">{row.email}</span>
                    </span>
                  </td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="chip text-sm">{row.role}</span>
                      {row.waiting && (
                        <span
                          className="chip text-sm"
                          style={{ background: "var(--color-sun)" }}
                          title="Rodzic czeka na przypisanie dziecka"
                        >
                          ⏳
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{row.points}</td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{row.lessons}</td>
                  <td className="hidden text-right tabular-nums sm:table-cell">{row.streak}</td>
                  <td className="hidden whitespace-nowrap text-right sm:table-cell">{row.time}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-row"
                      aria-expanded={open}
                      onClick={() => setOtwarte(open ? null : row.userId)}
                    >
                      {open ? "Zwiń" : <><span aria-hidden>✏️</span> Konto</>}
                    </button>
                  </td>
                </tr>

                {open && (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col gap-4 py-3">
                        <p className="text-sm text-zinc-500">{row.details}</p>
                        <FamilyPanel
                          userId={row.userId}
                          isParent={row.isParent}
                          childIds={row.childIds}
                          people={people}
                        />
                        <PasswordForm userId={row.userId} displayName={row.displayName} self={row.self} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
