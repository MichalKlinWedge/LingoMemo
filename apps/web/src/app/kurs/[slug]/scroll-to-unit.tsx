"use client";

import { useEffect } from "react";

/**
 * Ustawia stronę kursu na pierwszym niezaliczonym dziale.
 *
 * Kurs rośnie: po kilku zdanych testach działów dziecko wchodziło na ekran i widziało same
 * zielone kafelki z poprzednich miesięcy, a to, co ma dziś zrobić, leżało trzy ekrany niżej.
 * Przewijanie ręką za każdym wejściem jest dokładnie tą pracą, którą komputer ma wykonać sam.
 *
 * Który dział jest „kolejny", decyduje strona po stanie z bazy (zdany test działu), a nie ten
 * komponent — on dostaje gotowy identyfikator albo nie powstaje wcale.
 *
 * Nie `scrollIntoView`: pasek na górze jest `position: sticky`, więc nagłówek działu schowałby
 * się pod nim. Wysokość paska mierzymy, zamiast ją wpisywać — pasek zawija znaczniki i ma raz
 * dwa wiersze, raz trzy, zależnie od szerokości okna i od tego, ile liczników ma dziecko.
 */
export function ScrollToUnit({ id }: { id: string }) {
  useEffect(() => {
    const target = document.getElementById(id);
    if (!target) return;
    const bar = document.querySelector(".app-bar");
    const zapas = (bar?.getBoundingClientRect().height ?? 0) + 8;
    // Bez animacji: to nie jest ruch, który dziecko ma obejrzeć, tylko miejsce, w którym strona
    // ma się otworzyć. Animacja z góry strony przez pół kursu trwa i wygląda jak usterka.
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - zapas });
  }, [id]);

  return null;
}
