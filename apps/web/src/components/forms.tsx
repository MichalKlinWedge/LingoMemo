"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Wspólny kontrakt akcji serwera. Każda zwraca albo błąd do pokazania, albo potwierdzenie —
 * nigdy nie rzuca wyjątkiem w stronę dziecka.
 */
export type FormState = { error?: string; ok?: string; token?: string };

export function Status({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="msg-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="msg-ok" role="status">
        {state.ok}
      </p>
    );
  }
  return null;
}

/** Przycisk, który sam pilnuje, żeby nie dało się kliknąć dwa razy. */
export function SubmitButton({ children, pendingLabel = "Chwileczkę…" }: { children: ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  autoComplete,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-semibold">{label}</span>
      <input
        className="field"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
      />
    </label>
  );
}
