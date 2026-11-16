"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Zapis ustawień aplikacji. Zakresy pilnuje `admin_set_setting` w bazie — tutaj są drugi raz,
 * po to, żeby dorosły dostał komunikat przy polu, zanim cokolwiek poleci do bazy.
 */
const settingsSchema = z.object({
  autoNextSeconds: z.coerce
    .number({ message: "Podaj liczbę sekund" })
    .int("Podaj pełne sekundy")
    .min(2, "Mniej niż 2 sekundy to za mało, żeby dziecko zobaczyło „Brawo!”")
    .max(30, "Więcej niż 30 sekund to już nie przejście, tylko zawieszony ekran"),
});

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const parsed = settingsSchema.safeParse({ autoNextSeconds: form.get("auto_next_seconds") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nie udało się zapisać ustawień." };
  }

  const { error } = await supabase.rpc("admin_set_setting", {
    p_key: "auto_next_seconds",
    p_value: parsed.data.autoNextSeconds,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać ustawień.") };

  refresh();
  return { ok: `Zapisane. Następne zadanie pojawi się po ${parsed.data.autoNextSeconds} s.` };
}
