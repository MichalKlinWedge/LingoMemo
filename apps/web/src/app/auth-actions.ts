"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";

/**
 * Dokąd wrócić po zalogowaniu. Przyjmujemy wyłącznie ścieżki w tej aplikacji — adres z zewnątrz
 * albo `//cudzy.serwer` zamieniłby link logowania w przekierowanie gdzie indziej.
 */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Podaj adres e-mail i hasło." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Jeden komunikat na wszystkie przypadki: nie podpowiadamy, czy taki adres w ogóle istnieje.
  if (error) return { error: "Nie udało się zalogować. Sprawdź adres i hasło." };

  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Rejestracja z zaproszenia. Token leci w metadanych rejestracji — sprawdza go i zużywa hook
 * `before_user_created` w bazie, więc aplikacja nie potrzebuje do tego żadnego klucza.
 */
export async function acceptInvite(_prev: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const repeat = String(form.get("repeat") ?? "");
  const displayName = String(form.get("display_name") ?? "").trim();

  if (!token) return { error: "Brakuje zaproszenia. Otwórz link jeszcze raz." };
  if (!displayName) return { error: "Wpisz swoje imię." };
  if (!email) return { error: "Podaj adres e-mail." };
  if (password.length < 8) return { error: "Hasło musi mieć co najmniej 8 znaków." };
  if (password !== repeat) return { error: "Hasła nie są takie same." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName, invite: token } },
  });

  if (error) {
    // Komunikat o nieważnym zaproszeniu układa hook w bazie — ma już właściwą treść.
    return { error: error.message };
  }

  // Token zrobił swoje. Z bazy nie da się go usunąć triggerem — Auth zapisuje metadane konta
  // jeszcze raz po nim i nadpisuje zmianę — więc czyścimy go stąd, już po założeniu konta.
  await supabase.auth.updateUser({ data: { invite: null } });

  redirect("/");
}
