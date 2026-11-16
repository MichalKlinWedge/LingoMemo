"use client";

import { useActionState } from "react";

import { EXERCISE_LABEL } from "@lingomemo/core";

import { deleteExerciseAction, updateExerciseAction } from "@/app/admin/zadania/actions";
import { Field, Form, Status, SubmitButton, type FormState } from "@/components/forms";

/** Co znaczy poziom. Ten sam opis co w karcie ucznia, żeby nie było dwóch słowników. */
const LEVELS = [
  { value: 1, label: "1 — klikanie" },
  { value: 2, label: "2 — pojedyncze słowa" },
  { value: 3, label: "3 — zdania" },
];

export type ExerciseRow = {
  id: string;
  type: string;
  level: number;
  points: number;
  isActive: boolean;
  sortOrder: number;
  /** Treść zadania razem z poprawną odpowiedzią — to jest panel dla dorosłego. */
  payload: string;
  /** Zadanie, którego to jest łatwiejszą wersją (dorobioną automatycznie). */
  easyFor: string | null;
};

/**
 * Jedno zadanie do obejrzenia i poprawienia.
 *
 * Treść jest polem tekstowym z JSON-em, a nie formularzem pól: każdy z dziewięciu typów zadań ma
 * inny kształt payloadu, a jeden edytor na wszystkie byłby albo niepełny, albo większy niż reszta
 * panelu. Poprawność i tak sprawdza baza (więz `exercises_payload_valid`), więc źle wypełniona
 * treść nie przejdzie — wróci komunikat zamiast zepsutego zadania w lekcji.
 */
export function ExercisePanel({ row }: { row: ExerciseRow }) {
  const [state, action] = useActionState(updateExerciseAction, {} as FormState);
  const [removeState, removeAction] = useActionState(deleteExerciseAction, {} as FormState);

  const label = EXERCISE_LABEL[row.type as keyof typeof EXERCISE_LABEL] ?? row.type;

  return (
    <details className="card p-5">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
        <span className="card-title">{label}</span>
        <span className="chip">poziom {row.level}</span>
        <span className="chip">{row.points} pkt</span>
        {!row.isActive && <span className="chip">ukryte</span>}
        {row.easyFor && <span className="chip">wersja łatwiejsza</span>}
        <span className="ml-auto text-base text-zinc-600 dark:text-zinc-400">Rozwiń</span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <Form action={action} state={state} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={row.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="font-semibold">Poziom</span>
              <select name="level" defaultValue={row.level} className="field">
                {LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Punkty" name="points" type="number" min="0" max="1000" defaultValue={String(row.points)} />
          </div>

          <label className="flex items-center gap-3">
            <input type="checkbox" name="is_active" defaultChecked={row.isActive} className="h-6 w-6" />
            <span className="font-semibold">Widoczne w lekcji</span>
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-semibold">Treść zadania (JSON)</span>
            <textarea name="payload" defaultValue={row.payload} rows={10} spellCheck={false} className="field font-mono" style={{ fontSize: "0.9375rem", lineHeight: 1.5 }} />
          </label>

          <p className="text-base text-zinc-600 dark:text-zinc-400">
            W treści siedzi też poprawna odpowiedź (<code>accepted</code>, <code>answer</code>,{" "}
            <code>solution</code>) — dziecko jej nie dostaje, baza wycina ją przy wydawaniu zadania.
          </p>

          <Status state={state} />
          <SubmitButton>Zapisz zadanie</SubmitButton>
        </Form>

        <Form action={removeAction} state={removeState} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={row.id} />
          <label className="flex items-center gap-3">
            <input type="checkbox" name="confirm" className="h-6 w-6" />
            <span>Tak, usuń to zadanie z lekcji</span>
          </label>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Odpowiedzi dziecka zostają w historii — znika samo zadanie.
          </p>
          <Status state={removeState} />
          <SubmitButton variant="danger">Usuń zadanie</SubmitButton>
        </Form>
      </div>
    </details>
  );
}
