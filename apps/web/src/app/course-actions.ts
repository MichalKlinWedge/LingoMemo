"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Prośba ucznia o dostęp do kursu, na który nie jest zapisany.
 *
 * Akcja tylko przekazuje identyfikator kursu do bazy. To `request_course_access` sprawdza, czy
 * kurs istnieje, czy jest opublikowany i czy prośba ma jeszcze sens — przeglądarka nie decyduje
 * o niczym, bo i tak nie ona otwiera dostęp.
 */
export async function requestCourseAccessAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireUser("/");

  const courseId = String(form.get("course_id") ?? "").trim();
  if (courseId === "") return { error: "Nie wiadomo, o który kurs chodzi." };

  const { error } = await supabase.rpc("request_course_access", { p_course: courseId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się wysłać prośby.") };

  refresh();
  return { ok: "Prośba wysłana." };
}
