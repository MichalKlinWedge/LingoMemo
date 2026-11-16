"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Akcje edytora zadań.
 *
 * Zapis idzie zwykłym `update` — polityki `exercises_admin` w bazie i tak sprawdzają rolę przy
 * każdym wierszu, a treść zadania pilnuje więz `exercises_payload_valid`. Dzięki temu edytor nie
 * musi znać kształtu payloadu żadnego typu: wpisane JSON-y odrzuca baza, nie aplikacja.
 */

/** Kod błędu więzu CHECK. Postgres zwraca tu nazwę więzu, dla człowieka nic nieznaczącą. */
const CHECK_VIOLATION = "23514";

function errorFor(error: { code?: string; message: string }): string {
  if (error.code === CHECK_VIOLATION) {
    return "Treść zadania nie pasuje do jego typu — sprawdź pola wymagane dla tego rodzaju zadania.";
  }
  return dbErrorMessage(error, "Nie udało się zapisać zadania.");
}

export async function updateExerciseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin("/admin/kursy");

  const id = String(form.get("id") ?? "");
  const level = Number.parseInt(String(form.get("level") ?? ""), 10);
  const points = Number.parseInt(String(form.get("points") ?? ""), 10);
  const isActive = form.get("is_active") === "on";
  const raw = String(form.get("payload") ?? "").trim();

  if (!id) return { error: "Brakuje zadania." };
  if (![1, 2, 3].includes(level)) return { error: "Poziom to 1, 2 albo 3." };
  if (!Number.isFinite(points) || points < 0 || points > 1000) {
    return { error: "Punkty to liczba od 0 do 1000." };
  }

  // Treść jako tekst, a nie jako pola formularza: każdy typ zadania ma inny kształt, a jeden
  // edytor na dziewięć kształtów byłby albo niepełny, albo większy niż reszta panelu razem.
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { error: "Treść zadania nie jest poprawnym JSON-em." };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { error: "Treść zadania musi być obiektem JSON." };
  }

  const { error } = await supabase
    .from("exercises")
    .update({ level, points, is_active: isActive, payload: payload as never })
    .eq("id", id);

  if (error) return { error: errorFor(error) };

  refresh();
  return { ok: "Zadanie zapisane." };
}

/**
 * Kasowanie zadania. Próby dziecka zostają — `attempts.exercise_id` ma `on delete set null`,
 * więc historia nauki nie znika razem z zadaniem.
 */
export async function deleteExerciseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin("/admin/kursy");

  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Brakuje zadania." };
  if (form.get("confirm") !== "on") return { error: "Zaznacz potwierdzenie, żeby usunąć zadanie." };

  const { error } = await supabase.from("exercises").delete().eq("id", id);
  if (error) return { error: dbErrorMessage(error, "Nie udało się usunąć zadania.") };

  refresh();
  return { ok: "Zadanie usunięte." };
}
