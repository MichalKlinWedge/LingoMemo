"use server";

import { refresh } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";
import type { FormState } from "@/components/forms";

/**
 * Nadanie i odebranie roli rodzica oraz przypisywanie dzieci.
 *
 * Uprawnienia pilnuje baza (`assert_admin` w obu funkcjach) — `requireAdmin` jest tu tylko po to,
 * żeby nie pokazywać panelu komu popadnie. Odebranie roli kasuje w bazie także powiązania,
 * więc nie trzeba ich sprzątać stąd.
 */
export async function setParentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const userId = String(form.get("user_id") ?? "");
  const isParent = form.get("is_parent") === "true";
  if (!userId) return { error: "Brak konta do zmiany." };

  const { error } = await supabase.rpc("admin_set_parent", { p_user: userId, p_is_parent: isParent });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zmienić roli.") };

  refresh();
  return { ok: isParent ? "Konto jest teraz rodzicem." : "Rola rodzica odebrana." };
}

export async function setChildAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const parent = String(form.get("parent_id") ?? "");
  const child = String(form.get("child_id") ?? "");
  const linked = form.get("linked") === "true";
  if (!parent || !child) return { error: "Brak konta do przypisania." };

  const { error } = await supabase.rpc("admin_set_child", {
    p_parent: parent,
    p_child: child,
    p_linked: linked,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zmienić przypisania.") };

  refresh();
  return { ok: linked ? "Dziecko przypisane." : "Dziecko odpięte." };
}
