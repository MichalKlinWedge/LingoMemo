"use client";

import { useActionState } from "react";

import { requestCourseAccessAction } from "@/app/course-actions";
import { type FormState, Status, SubmitButton } from "@/components/forms";

/**
 * Przycisk „Poproś o dostęp" przy kursie, na który dziecko nie jest zapisane.
 *
 * Gdy prośba już poszła, przycisku nie ma — zostaje sam napis. Dziecko nie ma co klikać
 * drugi raz, a i tak nic by to nie zmieniło: baza odświeża wtedy tylko datę.
 */
export function CourseRequest({ courseId, alreadyAsked }: { courseId: string; alreadyAsked: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(requestCourseAccessAction, {});

  if (alreadyAsked && !state.ok) {
    return (
      <span className="chip" title="Administrator zobaczy prośbę przy Twoim imieniu">
        ✋ prośba wysłana
      </span>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="course_id" value={courseId} />
      {state.ok ? <Status state={state} /> : <SubmitButton pendingLabel="Wysyłam…">Poproś o dostęp</SubmitButton>}
      {state.error && <Status state={state} />}
    </form>
  );
}
