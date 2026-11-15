"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Wygenerowanie zaproszenia. Token wraca z bazy raz i raz jest pokazywany — potem nie da się go
 * odczytać, bo w bazie leży tylko jego skrót. Uprawnienia sprawdza sama funkcja w bazie;
 * `requireAdmin` tylko pilnuje, żeby nie pokazywać panelu komu popadnie.
 */
export async function createInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const role = form.get("role") === "admin" ? "admin" : "student";
  const displayName = String(form.get("display_name") ?? "").trim() || undefined;
  const course = String(form.get("course") ?? "").trim() || undefined;
  const days = Number.parseInt(String(form.get("days") ?? "14"), 10);

  const { data, error } = await supabase.rpc("create_invite", {
    p_role: role,
    p_days: Number.isFinite(days) ? days : 14,
    p_max_uses: 1,
    p_course: course,
    p_display_name: displayName,
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się wygenerować zaproszenia.") };

  refresh();
  return { ok: "Zaproszenie gotowe. Skopiuj link — nie da się go później odczytać.", token: data as string };
}

export async function revokeInviteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Nie wiadomo, które zaproszenie cofnąć." };

  const { error } = await supabase.rpc("revoke_invite", { p_id: id });
  if (error) return { error: dbErrorMessage(error, "Nie udało się cofnąć zaproszenia.") };

  refresh();
  return { ok: "Zaproszenie cofnięte." };
}
