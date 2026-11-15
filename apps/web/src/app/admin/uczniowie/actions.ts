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

/**
 * Imię i strefa czasowa dziecka. Przez `admin_update_profile`, a nie zwykłym `update`: polityka
 * `profiles_update_own` puszcza tylko własny wiersz, a rozszerzanie jej o administratora otworzyłoby
 * mu od razu wszystkie kolumny z `grant update` na tabeli.
 */
export async function updateStudentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin("/admin/uczniowie");

  const user = String(form.get("user_id") ?? "");
  const name = String(form.get("display_name") ?? "").trim();
  const zone = String(form.get("time_zone") ?? "").trim();

  if (!user) return { error: "Brakuje ucznia." };
  if (name === "") return { error: "Podaj imię dziecka." };
  if (name.length > 40) return { error: "Imię może mieć najwyżej 40 znaków." };

  const { error } = await supabase.rpc("admin_update_profile", {
    p_user: user,
    p_display_name: name,
    // Pominięte pole, a nie `null`: w typach z bazy argument jest opcjonalny, a funkcja i tak
    // czyta puste jako „zostaw strefę, jaka była".
    p_time_zone: zone === "" ? undefined : zone,
  });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać danych dziecka.") };

  refresh();
  return { ok: "Zapisane." };
}
