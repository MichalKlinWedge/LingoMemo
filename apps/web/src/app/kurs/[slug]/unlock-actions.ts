"use server";

import { refresh } from "next/cache";

import { plural, UNLOCKS } from "@lingomemo/core";

import type { FormState } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Otwarcie zamkniętej lekcji za punkt odblokowania.
 *
 * Akcja przekazuje bazie sam identyfikator lekcji. To `unlock_lesson` sprawdza wszystko, na czym
 * zależy: czy lekcja jest zwykła i z działu, w którym dziecko już jest, czy nie stoi bramka
 * powtórek i czy punkt w ogóle jest. Przeglądarka nie decyduje tu o niczym — kłódka pokazana
 * jako klikalna to tylko zaproszenie, a nie zgoda.
 */
export async function unlockLessonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const slug = String(form.get("slug") ?? "").trim();
  const { supabase } = await requireUser(slug === "" ? "/" : `/kurs/${slug}`);

  const lessonId = String(form.get("lesson_id") ?? "").trim();
  if (lessonId === "") return { error: "Nie wiadomo, którą lekcję otworzyć." };

  const { data, error } = await supabase.rpc("unlock_lesson", { p_lesson: lessonId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się otworzyć lekcji.") };

  const left = (data as { left?: number } | null)?.left ?? 0;

  refresh();
  return { ok: `Lekcja otwarta. Zostało Ci ${plural(left, UNLOCKS)}.` };
}
