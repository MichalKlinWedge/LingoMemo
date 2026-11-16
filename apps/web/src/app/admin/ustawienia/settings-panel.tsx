"use client";

import { useActionState } from "react";

import { Field, Form, type FormState, Status, SubmitButton } from "@/components/forms";

import { saveSettingsAction } from "./actions";

/**
 * Pokrętła całej aplikacji. Jedna sekcja na temat, nie jeden wielki formularz — przy drugim
 * i trzecim ustawieniu dorosły ma widzieć, czego dotyczy to, co zmienia.
 */
export function LessonSettings({ autoNextSeconds }: { autoNextSeconds: number }) {
  const [state, action] = useActionState<FormState, FormData>(saveSettingsAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Przebieg lekcji</h2>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Po dobrej odpowiedzi lekcja przechodzi do następnego zadania sama. Licznik przestawia się
        od nowa przy każdym dotknięciu ekranu, a po błędnej odpowiedzi nie rusza w ogóle — tam
        dziecko musi zdążyć przeczytać, jak było poprawnie.
      </p>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <Field
          label="Przejście do następnego zadania (sekundy)"
          name="auto_next_seconds"
          type="number"
          min="2"
          max="30"
          defaultValue={String(autoNextSeconds)}
        />
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz</SubmitButton>
      </Form>
    </section>
  );
}
