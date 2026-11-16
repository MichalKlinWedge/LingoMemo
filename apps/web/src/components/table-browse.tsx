"use client";

import { type ReactNode, useId, useMemo, useState } from "react";

/**
 * Przeglądanie długiej tabeli: filtr po tekście i strony.
 *
 * Dwie tabele w panelu urosły na tyle, że przestały mieścić się na ekranie — biblioteka
 * obrazków i lista kont. Obie potrzebują tego samego, więc logika stoi w jednym miejscu:
 * inaczej jedna z nich po kilku poprawkach zaczyna zachowywać się inaczej niż druga.
 *
 * Wszystko dzieje się w przeglądarce, bez adresu i bez ponownego zapytania do bazy. Dane są
 * już wczytane w całości, a przeładowywanie strony serwerowej przy każdej literze byłoby
 * wolniejsze od przefiltrowania tablicy.
 */

/** Ile wierszy na stronie. Tyle mieści się na ekranie laptopa bez długiego przewijania. */
const NA_STRONIE = 20;

export type Przegladanie<T> = {
  szukane: string;
  setSzukane: (wartosc: string) => void;
  /** Wszystko, co pasuje do filtra — do licznika „pasuje X z Y". */
  pasujace: T[];
  /** Wiersze bieżącej strony. */
  widoczne: T[];
  /** Numer pierwszego widocznego wiersza, licząc od zera. */
  od: number;
  strona: number;
  stron: number;
  idzDo: (strona: number) => void;
  wszystkich: number;
};

/**
 * `tekstDo` zwraca to, czego filtr szuka w jednym wierszu — ścieżkę pliku, imię z adresem.
 * Porównanie idzie bez rozróżniania wielkości liter: nazwy bywają z małych liter, ale szuka
 * się ich tak, jak się je pamięta.
 */
export function useTableBrowse<T>(wiersze: T[], tekstDo: (wiersz: T) => string): Przegladanie<T> {
  const [szukane, setSzukane] = useState("");
  const [strona, setStrona] = useState(0);

  const pasujace = useMemo(() => {
    const fraza = szukane.trim().toLowerCase();
    return fraza === "" ? wiersze : wiersze.filter((wiersz) => tekstDo(wiersz).toLowerCase().includes(fraza));
    // `tekstDo` bywa funkcją pisaną w miejscu wywołania, więc zmienia tożsamość przy każdym
    // renderowaniu — gdyby weszła do zależności, cały filtr liczyłby się od nowa bez powodu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wiersze, szukane]);

  // Nowa fraza wraca na pierwszą stronę: wynik jest inny, więc „strona 3" znaczyłaby co innego
  // niż przed chwilą. Stan poprawiamy w trakcie renderowania, nie w efekcie — efekt z `setState`
  // to kaskada renderów, której linter słusznie zabrania.
  const [poprzednie, setPoprzednie] = useState(szukane);
  if (szukane !== poprzednie) {
    setPoprzednie(szukane);
    setStrona(0);
  }

  const stron = Math.max(1, Math.ceil(pasujace.length / NA_STRONIE));
  // Skasowanie ostatniego wiersza na ostatniej stronie zostawiłoby pustą stronę, a lista
  // przychodzi z serwera już bez niego — dlatego numer przycinamy przy każdym renderowaniu.
  const biezaca = Math.min(strona, stron - 1);
  const od = biezaca * NA_STRONIE;

  return {
    szukane,
    setSzukane,
    pasujace,
    widoczne: pasujace.slice(od, od + NA_STRONIE),
    od,
    strona: biezaca,
    stron,
    idzDo: setStrona,
    wszystkich: wiersze.length,
  };
}

/** Pole filtra z licznikiem. `placeholder` mówi, czego w tej konkretnej tabeli można szukać. */
export function TableFilter<T>({
  stan,
  placeholder,
  etykieta,
}: {
  stan: Przegladanie<T>;
  placeholder: string;
  /** Opis pola dla czytnika ekranu — na ekranie zastępuje go `placeholder`. */
  etykieta: string;
}) {
  const poleId = useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex min-w-60 flex-1 flex-col gap-1" htmlFor={poleId}>
        <span className="sr-only">{etykieta}</span>
        <input
          id={poleId}
          className="field"
          type="search"
          value={stan.szukane}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => stan.setSzukane(event.target.value)}
        />
      </label>
      <span className="text-zinc-600 dark:text-zinc-400" role="status">
        {stan.pasujace.length === stan.wszystkich
          ? `Pokazane ${stan.od + 1}–${stan.od + stan.widoczne.length} z ${stan.wszystkich}`
          : `Pasuje ${stan.pasujace.length} z ${stan.wszystkich}`}
      </span>
    </div>
  );
}

/**
 * Przyciski stron. Przy jednej stronie nie rysuje się nic — nie ma dokąd przejść.
 *
 * Stoją nad tabelą i pod nią. Pod spodem są tam, gdzie kończy się czytanie strony, ale po
 * przejściu dalej wzrok jest już na dole, a nowa strona zaczyna się na górze — wtedy bliżej
 * jest do tych nad tabelą. Para kosztuje jeden rząd przycisków, a oszczędza przewijanie
 * w obie strony przy każdej zmianie.
 */
export function TablePager<T>({ stan, etykieta }: { stan: Przegladanie<T>; etykieta: string }) {
  if (stan.stron <= 1) return null;

  return (
    <nav className="flex flex-wrap items-center justify-center gap-3" aria-label={etykieta}>
      <button type="button" className="btn-row" disabled={stan.strona === 0} onClick={() => stan.idzDo(stan.strona - 1)}>
        ← Poprzednia
      </button>
      <span className="text-zinc-600 dark:text-zinc-400" role="status">
        Strona {stan.strona + 1} z {stan.stron}
      </span>
      <button
        type="button"
        className="btn-row"
        disabled={stan.strona === stan.stron - 1}
        onClick={() => stan.idzDo(stan.strona + 1)}
      >
        Następna →
      </button>
    </nav>
  );
}

/** Komunikat, gdy filtr nic nie znalazł. */
export function TableEmpty({ children }: { children: ReactNode }) {
  return <p className="text-zinc-600 dark:text-zinc-400">{children}</p>;
}
