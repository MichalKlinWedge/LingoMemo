"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Poziom trudności dziecka. Zapis idzie przez `set_learner_level`, bo kolumny `profiles.level`
 * nie ma w `grant update` — inaczej dziecko ustawiłoby sobie najłatwiejszy poziom samo.
 */
export async function setLearnerLevelAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin("/admin/uczniowie");

  const user = String(form.get("user_id") ?? "");
  const level = Number.parseInt(String(form.get("level") ?? ""), 10);

  if (!user) return { error: "Brakuje ucznia." };
  if (![1, 2, 3].includes(level)) return { error: "Poziom to 1, 2 albo 3." };

  const { error } = await supabase.rpc("set_learner_level", { p_user: user, p_level: level });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zmienić poziomu.") };

  refresh();
  return { ok: "Poziom zapisany." };
}
