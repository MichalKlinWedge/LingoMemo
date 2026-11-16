"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { plural, UNLOCKS } from "@lingomemo/core";

import { type FormState, Status, SubmitButton } from "@/components/forms";

import { unlockLessonAction } from "./unlock-actions";

/**
 * Kłódka, którą da się otworzyć punktem odblokowania.
 *
 * Dziecko klika w kłódkę — tam, gdzie i tak klikało, licząc, że lekcja się otworzy — a dopiero
 * potem dostaje pytanie. Pytanie jest konieczne: punkt zdobywa się na poziomie trudnym, więc
 * wydanie go przez pomyłkę to kilkanaście zadań do powtórzenia.
 *
 * Okno jest natywnym `<dialog>` z `showModal()`: pułapka na fokus, Escape i tło blokujące
 * kliknięcia przychodzą z przeglądarki, a nie z własnej nakładki, która zwykle ma dwie z trzech.
 */
export function UnlockLesson({
  lessonId,
  slug,
  title,
  label,
  left,
}: {
  lessonId: string;
  slug: string;
  title: string;
  /** Nazwa kafelka dla czytnika ekranu — ta sama, co przy lekcji otwartej. */
  label: string;
  /** Ile punktów dziecko ma teraz. Zero tu nie trafia: wtedy kłódka zostaje nieklikalna. */
  left: number;
}) {
  const [pytanie, setPytanie] = useState(false);
  const okno = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState<FormState, FormData>(unlockLessonAction, {});

  useEffect(() => {
    if (pytanie) okno.current?.showModal();
    else okno.current?.close();
  }, [pytanie]);

  return (
    <>
      <button
        type="button"
        className="tile"
        data-state="locked"
        data-unlockable="true"
        aria-label={`${label} — otwórz za punkt odblokowania`}
        title="Otwórz tę lekcję za punkt odblokowania"
        onClick={() => setPytanie(true)}
      >
        <span aria-hidden>🔒</span>
        <span className="text-base" aria-hidden>
          🔑
        </span>
      </button>

      <dialog
        ref={okno}
        className="modal"
        aria-label="Otwarcie lekcji za punkt"
        onClose={() => setPytanie(false)}
      >
        <form action={action} className="flex flex-col gap-4">
          <h2 className="card-title">Otworzyć tę lekcję?</h2>

          <input type="hidden" name="lesson_id" value={lessonId} />
          <input type="hidden" name="slug" value={slug} />

          {/* Po otwarciu pytanie jest nieprawdą: punkt już poszedł, a stan konta jest inny.
              Zostaje sam komunikat z bazy i wyjście — strona i tak odświeża się pod spodem. */}
          {!state.ok && (
            <>
              <p className="text-base">
                <strong>{title}</strong> otworzy się za jeden punkt odblokowania. Masz{" "}
                {plural(left, UNLOCKS)}.
              </p>
              <p className="text-base text-zinc-600 dark:text-zinc-400">
                Punkt zdobywasz za zrobienie lekcji na poziomie trudnym.
              </p>
            </>
          )}

          <Status state={state} />

          <div className="flex flex-wrap justify-end gap-3">
            {state.ok ? (
              <button type="button" className="btn-primary" onClick={() => setPytanie(false)}>
                Zamknij
              </button>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={() => setPytanie(false)}>
                  Nie teraz
                </button>
                <SubmitButton pendingLabel="Otwieram…">Tak, otwórz</SubmitButton>
              </>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
