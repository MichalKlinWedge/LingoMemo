"use client";

import { useActionState, useId, useState } from "react";

import { setPasswordAction } from "@/app/admin/konta/account-actions";
import { type FormState, Status, SubmitButton } from "@/components/forms";

/**
 * Proste słowa bez polskich znaków: hasło ma być do podyktowania dziecku i do wpisania
 * na tablecie. Dwa słowa i liczba to ponad milion kombinacji, a zapamiętać da się za pierwszym
 * razem.
 */
const SLOWA = [
  "kotek", "piesek", "slonce", "rower", "balon", "ryba", "jablko", "zielony",
  "burza", "lampa", "mapa", "banan", "tygrys", "chmura", "ogorek", "statek",
];

function losoweHaslo(): string {
  const liczby = crypto.getRandomValues(new Uint32Array(3));
  const slowo = (n: number) => SLOWA[n % SLOWA.length];
  return `${slowo(liczby[0]!)}-${slowo(liczby[1]!)}-${(liczby[2]! % 90) + 10}`;
}

/**
 * Hasło jest widoczne, a nie zakryte kropkami: administrator musi je przeczytać dziecku,
 * a nikt go już potem nie odzyska — w bazie leży tylko skrót.
 */
export function PasswordForm({ userId, displayName, self }: { userId: string; displayName: string; self: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setPasswordAction, {});
  const [haslo, setHaslo] = useState("");
  const pole = useId();

  return (
    <details className="w-full">
      <summary className="back-link cursor-pointer list-none font-semibold">Zmień hasło</summary>
      <form action={action} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="user_id" value={userId} />
        <label className="flex flex-col gap-2" htmlFor={pole}>
          <span className="font-semibold">
            Nowe hasło dla: {displayName}
            {self && " (to Twoje konto — zostaniesz wylogowany)"}
          </span>
          <input
            id={pole}
            className="field font-mono"
            name="password"
            type="text"
            required
            minLength={8}
            autoComplete="off"
            spellCheck={false}
            value={haslo}
            onChange={(e) => setHaslo(e.target.value)}
            placeholder="co najmniej 8 znaków"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Zmieniam…">Ustaw hasło</SubmitButton>
          <button type="button" className="btn-secondary" onClick={() => setHaslo(losoweHaslo())}>
            Wymyśl hasło
          </button>
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Zmiana wylogowuje to konto ze wszystkich urządzeń.
        </p>
        <Status state={state} />
      </form>
    </details>
  );
}
