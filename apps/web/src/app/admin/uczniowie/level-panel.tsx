"use client";

import { useActionState } from "react";

import { setLearnerLevelAction } from "@/app/admin/uczniowie/actions";
import { Form, Status, SubmitButton, type FormState } from "@/components/forms";

/** Co poziom właściwie zmienia dla dziecka. Opis jest dla dorosłego, więc bez żargonu. */
const LEVELS = [
  { value: 1, title: "1 — klikanie", text: "Wskazywanie obrazków, łączenie par, gotowe odpowiedzi do wyboru." },
  { value: 2, title: "2 — pojedyncze słowa", text: "Układanie zdania z kafelków i wpisywanie jednego słowa." },
  { value: 3, title: "3 — zdania", text: "Wpisywanie całych zdań i pisanie ze słuchu." },
];

/**
 * Poziom dziecka to SUFIT, a nie sztywne ustawienie: w jego granicach trudność rośnie słówko po
 * słówku. Świeżo poznane słowo zaczyna od klikania nawet na poziomie trzecim, a wpisywanie
 * włącza się, gdy dziecko już je rozpoznaje. Dlatego podniesienie poziomu nie zmienia jutrzejszej
 * lekcji z dnia na dzień i trzeba o tym napisać wprost — inaczej wygląda jak zepsuty przełącznik.
 */
export function LevelPanel({ userId, level }: { userId: string; level: number }) {
  const [state, action] = useActionState(setLearnerLevelAction, {} as FormState);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <h2 className="card-title">Poziom trudności</h2>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Najtrudniejszy rodzaj zadania, jaki dziecko może dostać. Nowe słówko i tak zaczyna od
        klikania — wpisywanie dochodzi dopiero wtedy, gdy dziecko je rozpoznaje.
      </p>

      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="user_id" value={userId} />

        <div className="flex flex-col gap-2">
          {LEVELS.map((option) => (
            <label key={option.value} className="flex items-start gap-3">
              <input
                type="radio"
                name="level"
                value={option.value}
                defaultChecked={option.value === level}
                className="mt-1 h-6 w-6"
              />
              <span className="flex flex-col">
                <span className="font-semibold">{option.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{option.text}</span>
              </span>
            </label>
          ))}
        </div>

        <Status state={state} />
        <SubmitButton>Zapisz poziom</SubmitButton>
      </Form>
    </section>
  );
}
