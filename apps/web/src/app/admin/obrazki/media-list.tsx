"use client";

import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";

import { EXERCISES, plural, WORDS } from "@lingomemo/core";

import { type FormState, Status, SubmitButton } from "@/components/forms";

import { deleteMediaAction } from "./actions";

export type MediaFile = {
  path: string;
  url: string;
  size: number;
  updatedAt: string | null;
  /** Ile słówek i zadań wskazuje ten plik. Zero znaczy „nikt", a nie „nie wiem". */
  concepts: number;
  exercises: number;
};

function kilobajty(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}

function uzycie(file: MediaFile): string | null {
  const czesci: string[] = [];
  if (file.concepts > 0) czesci.push(plural(file.concepts, WORDS));
  if (file.exercises > 0) czesci.push(plural(file.exercises, EXERCISES));
  return czesci.length === 0 ? null : czesci.join(" · ");
}

function data(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("pl-PL") : "—";
}

/**
 * Ile plików na stronie. Biblioteka rośnie z każdą lekcją, a kilkaset wierszy naraz to strona,
 * której przeglądarka nie zdąży narysować, zanim administrator zacznie przewijać.
 */
const NA_STRONIE = 20;

/** Jeden plik jako wiersz tabeli. Kasowanie nie dzieje się tutaj — wiersz tylko o nie prosi. */
function Wiersz({ file, onDelete }: { file: MediaFile; onDelete: () => void }) {
  const w_uzyciu = uzycie(file);

  return (
    <tr>
      <td>
        {/* Zwykły <img>: pliki wgrywa administrator w trakcie działania aplikacji, więc nie ma
            ich czym zoptymalizować przy budowaniu. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.url}
          alt=""
          className="rounded-lg"
          style={{ width: "3rem", height: "3rem", objectFit: "contain", background: "var(--color-zinc-100)" }}
        />
      </td>
      {/* `w-full` na jednej komórce: tabela rozdziela szerokość tak, że pozostałe kolumny biorą
          tyle, ile im trzeba, a cała reszta zostaje dla ścieżki — to ona bywa długa.

          Rozmiar i data stoją pod ścieżką, a nie w osobnej kolumnie: szerokość treści jest na
          wszystkich stronach ta sama (736 px), a kolumna z nimi zabierała tyle, że przy dłuższym
          opisie użycia tabela nie mieściła się w karcie. Wysokość wiersza jest tańsza. */}
      <td className="w-full">
        {/* Pole tekstowe, nie napis: ścieżkę trzeba zaznaczyć i skopiować do pliku lekcji.
            `min-h-0` zdejmuje wysokość dla palca — w wierszu tabeli rozpychałaby każdy rząd. */}
        <input
          className="field min-h-0 min-w-0 px-2 py-1 font-mono text-sm sm:min-w-64"
          readOnly
          value={file.path}
          aria-label={`Ścieżka pliku ${file.path}`}
        />
        <span className="mt-0.5 block whitespace-nowrap px-2 text-sm text-zinc-500">
          {kilobajty(file.size)} · {data(file.updatedAt)}
        </span>
      </td>
      {/* Poniżej 640 px kolumna znika: nie mieści się obok ścieżki, a o użyciu i tak mówi
          okno potwierdzenia — czyli dokładnie wtedy, kiedy ta informacja jest potrzebna. */}
      <td className="hidden whitespace-nowrap sm:table-cell">
        {w_uzyciu ? (
          <span className="chip text-sm">{w_uzyciu}</span>
        ) : (
          <span className="text-sm text-zinc-500">Nieużywany</span>
        )}
      </td>
      <td className="text-right">
        {/* Poniżej 640 px zostaje sama ikona — podpis powtarza się w każdym wierszu i zabiera
            szerokość, której brakuje ścieżce. Nazwę dla czytnika ekranu niesie `aria-label`. */}
        <button type="button" className="btn-row" onClick={onDelete} aria-label={`Usuń ${file.path}`}>
          <span aria-hidden>🗑️</span>
          <span className="hidden sm:inline">Usuń</span>
        </button>
      </td>
    </tr>
  );
}

/**
 * Treść okna potwierdzenia dla jednego pliku. Montuje się od nowa przy każdym otwarciu
 * (klucz na ścieżce), więc nie pamięta wyniku poprzedniego kasowania.
 *
 * Plik w użyciu wymaga dodatkowo zaznaczonej zgody. Samo okno zatrzymuje pomyłkę („kliknąłem
 * nie ten wiersz"), ale nie mówi, że obrazek zniknie dziecku sprzed oczu w lekcji — a to jest
 * inna decyzja, warta osobnego ruchu. Serwer sprawdza zgodę po swojemu, niezależnie od tego pola.
 */
function Potwierdzenie({ file, onClose }: { file: MediaFile; onClose: () => void }) {
  const [state, action] = useActionState<FormState, FormData>(deleteMediaAction, {});
  const [zgoda, setZgoda] = useState(false);
  const w_uzyciu = uzycie(file);

  // Udane skasowanie zamyka okno samo: wiersza już nie ma, nie ma czego potwierdzać.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form action={action} className="flex flex-col gap-4">
      <h2 className="card-title">Skasować obrazek?</h2>

      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={file.url}
          alt=""
          className="rounded-lg"
          style={{ width: "4rem", height: "4rem", objectFit: "contain", background: "var(--color-zinc-100)" }}
        />
        <span className="break-all font-mono text-sm">{file.path}</span>
      </div>

      <input type="hidden" name="path" value={file.path} />
      <input type="hidden" name="used" value={w_uzyciu ? "1" : "0"} />

      {w_uzyciu ? (
        <>
          <p className="msg-warn">
            Plik jest w użyciu: {w_uzyciu}. Skasowanie nie rusza tych wierszy — dziecko zobaczy tam puste miejsce.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="confirm"
              className="mt-1 h-5 w-5"
              checked={zgoda}
              onChange={(event) => setZgoda(event.target.checked)}
            />
            <span>Wiem, że zniknie z miejsc, w których jest użyty.</span>
          </label>
        </>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nie wskazuje go żadne słówko ani zadanie. Kasowania nie da się cofnąć.
        </p>
      )}

      <Status state={state} />

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Anuluj
        </button>
        <SubmitButton pendingLabel="Kasuję…" variant="danger" disabled={w_uzyciu !== null && !zgoda}>
          Usuń
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Biblioteka jako tabela.
 *
 * Wcześniej każdy plik był kartą z podglądem na całą szerokość i czerwonym przyciskiem pod
 * spodem — przy pięćdziesięciu plikach sprawdzenie, czy obrazek o danej nazwie już jest,
 * kosztowało kilka ekranów przewijania. Teraz jeden wiersz na plik, podgląd jako miniatura.
 *
 * Kasowanie pyta w oknie, nie od razu: czerwony przycisk stał w siatce tuż obok sąsiednich
 * i pomyłka o jeden kafel kosztowała plik.
 */
export function MediaList({ files }: { files: MediaFile[] }) {
  const [doKasacji, setDoKasacji] = useState<MediaFile | null>(null);
  const [szukane, setSzukane] = useState("");
  const [strona, setStrona] = useState(0);
  const okno = useRef<HTMLDialogElement>(null);
  const poleId = useId();

  useEffect(() => {
    const element = okno.current;
    if (!element) return;
    if (doKasacji && !element.open) element.showModal();
    else if (!doKasacji && element.open) element.close();
  }, [doKasacji]);

  // Filtrowanie po ścieżce, bez rozróżniania wielkości liter: nazwy plików są z małych liter,
  // ale szuka się ich tak, jak się je pamięta.
  const pasujace = useMemo(() => {
    const fraza = szukane.trim().toLowerCase();
    return fraza === "" ? files : files.filter((file) => file.path.toLowerCase().includes(fraza));
  }, [files, szukane]);

  // Nowa fraza wraca na pierwszą stronę: wynik jest inny, więc „strona 3" znaczyłaby co innego
  // niż przed chwilą. Stan poprawiamy w trakcie renderowania, nie w efekcie — efekt z `setState`
  // to kaskada renderów, której linter słusznie zabrania.
  const [poprzednieSzukane, setPoprzednieSzukane] = useState(szukane);
  if (szukane !== poprzednieSzukane) {
    setPoprzednieSzukane(szukane);
    setStrona(0);
  }

  const stron = Math.max(1, Math.ceil(pasujace.length / NA_STRONIE));
  // Skasowanie ostatniego pliku na ostatniej stronie zostawiłoby pustą stronę, a lista przychodzi
  // z serwera już bez niego — dlatego numer strony przycinamy przy każdym renderowaniu.
  const biezaca = Math.min(strona, stron - 1);
  const od = biezaca * NA_STRONIE;
  const widoczne = pasujace.slice(od, od + NA_STRONIE);

  if (files.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        W bibliotece nie ma jeszcze żadnego pliku. Wgraj pierwszy powyżej.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-60 flex-1 flex-col gap-1" htmlFor={poleId}>
          <span className="sr-only">Filtruj po ścieżce</span>
          <input
            id={poleId}
            className="field"
            type="search"
            value={szukane}
            placeholder="Szukaj w ścieżce, np. „liczba” albo „2026/kolor”"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSzukane(event.target.value)}
          />
        </label>
        <span className="text-zinc-600 dark:text-zinc-400" role="status">
          {pasujace.length === files.length
            ? `Pokazane ${od + 1}–${od + widoczne.length} z ${files.length}`
            : `Pasuje ${pasujace.length} z ${files.length}`}
        </span>
      </div>

      {pasujace.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Żaden plik nie ma tego w ścieżce. Wyczyść pole, żeby zobaczyć całą bibliotekę.
        </p>
      )}

      {pasujace.length > 0 && (
        <div className="card px-3 py-2">
          {/* Poziome przewijanie wewnątrz karty: ścieżka ma zagwarantowaną szerokość, a kolumna
              użycia bywa długa („3 słówka · 22 zadania") — bez tego przy wąskim oknie przycisk
              „Usuń" wychodził poza obramowanie karty zamiast zostać w środku. */}
          <div className="overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Obrazek</th>
                <th>Ścieżka</th>
                <th className="hidden sm:table-cell">Użycie</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {widoczne.map((file) => (
                <Wiersz key={file.path} file={file} onDelete={() => setDoKasacji(file)} />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {stron > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-3" aria-label="Strony biblioteki">
          <button
            type="button"
            className="btn-row"
            disabled={biezaca === 0}
            onClick={() => setStrona(biezaca - 1)}
          >
            ← Poprzednia
          </button>
          <span className="text-zinc-600 dark:text-zinc-400" role="status">
            Strona {biezaca + 1} z {stron}
          </span>
          <button
            type="button"
            className="btn-row"
            disabled={biezaca === stron - 1}
            onClick={() => setStrona(biezaca + 1)}
          >
            Następna →
          </button>
        </nav>
      )}

      {/* Element okna stoi w drzewie na stałe, a wymienia się tylko jego treść: `showModal()`
          i `close()` potrzebują tego samego elementu, a nie nowego przy każdym otwarciu.
          `onClose` łapie też zamknięcie klawiszem Escape, którego żaden przycisk nie obsługuje. */}
      <dialog ref={okno} className="modal" aria-label="Potwierdzenie skasowania" onClose={() => setDoKasacji(null)}>
        {doKasacji && <Potwierdzenie key={doKasacji.path} file={doKasacji} onClose={() => setDoKasacji(null)} />}
      </dialog>
    </div>
  );
}
