"use client";

import { useActionState } from "react";

import { signIn } from "@/app/auth-actions";
import { Field, type FormState, Status, SubmitButton } from "@/components/forms";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});

  return (
    <form action={action} className="card flex flex-col gap-4 p-6">
      <input type="hidden" name="next" value={next} />
      <Field label="Twój e-mail" name="email" type="email" autoComplete="email" placeholder="zosia@dom.pl" />
      <Field label="Hasło" name="password" type="password" autoComplete="current-password" />
      <Status state={state} />
      <SubmitButton pendingLabel="Loguję…">Zaloguj się</SubmitButton>
    </form>
  );
}
