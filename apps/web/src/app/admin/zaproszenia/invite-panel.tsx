"use client";

import { useActionState } from "react";

import { createInviteAction, revokeInviteAction } from "@/app/admin/invite-actions";
import { Field, type FormState, Status, SubmitButton } from "@/components/forms";

export function NewInvite({ courses, siteUrl }: { courses: { id: string; title: string }[]; siteUrl: string }) {
  const [state, action] = useActionState<FormState, FormData>(createInviteAction, {});
  const link = state.token ? `${siteUrl}/zaproszenie/${state.token}` : null;

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowe zaproszenie</h2>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Dla kogo (imię)" name="display_name" required={false} placeholder="Zosia" />

        <label className="flex flex-col gap-2">
          <span className="font-semibold">Kurs</span>
          <select name="course" className="field" defaultValue={courses[0]?.id ?? ""}>
            <option value="">bez zapisu na kurs</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="font-semibold">Rola</span>
            <select name="role" className="field" defaultValue="student">
              <option value="student">uczeń</option>
              <option value="admin">administrator</option>
            </select>
          </label>
          <Field label="Ważne (dni)" name="days" type="number" defaultValue="14" />
        </div>

        <Status state={state} />
        <SubmitButton pendingLabel="Generuję…">Wygeneruj link</SubmitButton>
      </form>

      {link && (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed p-4" style={{ borderColor: "var(--line)" }}>
          <span className="font-semibold">Link do wysłania</span>
          {/* Pole tekstowe, a nie sam napis: link trzeba zaznaczyć i skopiować, a drugi raz
              nie da się go odtworzyć. */}
          <input className="field font-mono text-base" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </section>
  );
}

export function RevokeButton({ id }: { id: string }) {
  const [state, action] = useActionState<FormState, FormData>(revokeInviteAction, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn-secondary px-4 py-1 text-base" style={{ minHeight: "2.5rem" }}>
        Cofnij
      </button>
      {state.error && <span className="text-base text-red-700">{state.error}</span>}
    </form>
  );
}
