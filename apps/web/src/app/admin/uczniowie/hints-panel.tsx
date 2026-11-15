"use client";

import { useActionState } from "react";

import { resetHintsAction } from "@/app/admin/uczniowie/actions";
import { Form, Status, SubmitButton, type FormState } from "@/components/forms";

/**
 * Podpowiedzi dziecka na dziś. Pula odnawia się sama o północy w jego strefie czasowej, więc
 * przycisk jest na jeden przypadek: pula poszła nie z winy dziecka (zepsute zadanie, pomyłka
 * w treści) i szkoda czekać do jutra. Data doby jest wypisana wprost, bo dziecko może mieć
 * inną strefę niż dorosły, który na to patrzy.
 */
export function HintsPanel({
  userId,
  used,
  left,
  limit,
  today,
}: {
  userId: string;
  used: number;
  left: number;
  limit: number;
  today: string;
}) {
  const [state, action] = useActionState(resetHintsAction, {} as FormState);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <h2 className="card-title">Podpowiedzi</h2>

      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Podpowiedź zamienia trudne zadanie na łatwiejszą wersję tego samego słówka. Dziecko ma{" "}
        {limit} na dobę, a pula wraca o północy — {new Date(`${today}T12:00:00`).toLocaleDateString("pl-PL")} to
        doba liczona w jego strefie czasowej.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">💡 zostało: {left}</span>
        <span className="chip">zużyte dziś: {used}</span>
      </div>

      <Form action={action} state={state} className="flex flex-col gap-3">
        <input type="hidden" name="user_id" value={userId} />
        <Status state={state} />
        <SubmitButton pendingLabel="Oddaję…">Oddaj pulę na dziś</SubmitButton>
      </Form>
    </section>
  );
}
