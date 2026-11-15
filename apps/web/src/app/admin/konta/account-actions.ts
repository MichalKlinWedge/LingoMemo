"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Ustawienie hasła wskazanemu kontu. Samo hasło zapisuje baza — aplikacja nie ma i nie może mieć
 * klucza `service_role`, którego wymaga Admin API Supabase. Długość sprawdzamy tu i jeszcze raz
 * w bazie: formularz da się ominąć, funkcji `set_user_password` nie.
 *
 * Administrator potwierdza operację własnym hasłem. Sama otwarta sesja nie wystarcza: aplikacja
 * chodzi na wspólnym tablecie, więc „ktoś podniósł urządzenie” to realny scenariusz, a nie
 * teoretyczny.
 */
export async function setPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const userId = String(form.get("user_id") ?? "");
  const password = String(form.get("password") ?? "");
  const adminPassword = String(form.get("admin_password") ?? "");
  if (!userId) return { error: "Nie wiadomo, któremu kontu zmienić hasło." };
  if (password.length < 8) return { error: "Hasło musi mieć co najmniej 8 znaków." };
  if (adminPassword === "") return { error: "Podaj swoje hasło, żeby potwierdzić zmianę." };

  const { error } = await supabase.rpc("set_user_password", {
    p_user: userId,
    p_password: password,
    p_admin_password: adminPassword,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zmienić hasła.") };

  refresh();
  return { ok: "Hasło zmienione. Zapamiętaj je teraz — później nie da się go odczytać." };
}
