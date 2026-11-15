"use client";

import { useActionState } from "react";

import { acceptInvite } from "@/app/auth-actions";
import { Field, type FormState, Status, SubmitButton } from "@/components/forms";

export function InviteForm({
  token,
  displayName,
  email,
}: {
  token: string;
  displayName: string | null;
  email: string | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(acceptInvite, {});

  return (
    <form action={action} className="card flex flex-col gap-4 p-6">
      <input type="hidden" name="token" value={token} />
      <Field label="Jak masz na imię?" name="display_name" defaultValue={displayName ?? ""} placeholder="Zosia" />
      <Field
        label="E-mail do logowania"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={email ?? ""}
        placeholder="zosia@dom.pl"
      />
      <Field label="Wymyśl hasło" name="password" type="password" autoComplete="new-password" />
      <Field label="Powtórz hasło" name="repeat" type="password" autoComplete="new-password" />
      <Status state={state} />
      <SubmitButton pendingLabel="Zakładam konto…">Zaczynamy!</SubmitButton>
    </form>
  );
}
