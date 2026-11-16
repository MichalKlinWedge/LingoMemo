"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";

import { BUCKET } from "./bucket";

/**
 * Skasowanie pliku z biblioteki. Uprawnienia pilnuje polityka na `storage.objects`
 * (zapis tylko dla administratora) — `requireAdmin` tylko nie pokazuje panelu komu popadnie.
 *
 * Plik używany przez słówko albo zadanie wymaga zaznaczenia zgody: skasowanie pliku nie rusza
 * wierszy, które go wskazują, więc dziecko zobaczyłoby pusty kafelek zamiast obrazka.
 */
export async function deleteMediaAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const path = String(form.get("path") ?? "").trim();
  if (path === "") return { error: "Nie wiadomo, który plik skasować." };

  const used = String(form.get("used") ?? "") === "1";
  if (used && form.get("confirm") === null) {
    return { error: "Ten plik jest w użyciu — zaznacz zgodę, żeby go skasować." };
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) return { error: `Nie udało się skasować: ${error.message}` };

  refresh();
  return { ok: `Skasowane: ${path}` };
}

/** Odświeżenie listy po wgraniu plików — wgrywarka działa w przeglądarce, z pominięciem serwera. */
export async function refreshMediaAction(): Promise<void> {
  await requireAdmin();
  refresh();
}
