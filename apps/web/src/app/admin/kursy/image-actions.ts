"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Obrazek słówka: ścieżka z biblioteki „Obrazki". Puste pole kasuje przypisanie — sam plik
 * zostaje w bibliotece, bo może go używać jeszcze coś innego.
 *
 * Osobny plik akcji, nie `actions.ts` tej sekcji: tamten jest i tak duży, a to jest jedna
 * czynność o jednym parametrze.
 */
export async function setWordImageAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const concept = String(form.get("concept") ?? "");
  if (concept === "") return { error: "Nie wiadomo, któremu słówku ustawić obrazek." };

  const path = String(form.get("image_path") ?? "").trim();
  const { error } = await supabase.rpc("admin_set_concept_image", {
    p_concept: concept,
    p_path: path,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać obrazka.") };

  refresh();
  return { ok: path === "" ? "Obrazek odpięty od słówka." : "Obrazek zapisany." };
}
