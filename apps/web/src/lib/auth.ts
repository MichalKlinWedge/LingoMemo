import { redirect } from "next/navigation";

import { createClient } from "./supabase/server";

/**
 * Zalogowany użytkownik albo przekierowanie na logowanie (z powrotem pod `next`). `getClaims`
 * weryfikuje token, a nie tylko czyta cookie — `getSession` na serwerze nie jest wiarygodne.
 * Sprawdzenie jest w każdej stronie i akcji, nie tylko w proxy (akcje omijają matcher).
 */
export async function requireUser(next = "/") {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect(`/login?next=${encodeURIComponent(next)}`);
  const app = data.claims.app_metadata as { is_admin?: boolean } | undefined;
  return {
    supabase,
    userId: data.claims.sub,
    email: data.claims.email as string | undefined,
    isAdmin: app?.is_admin === true,
  };
}

/** Strona panelu administratora. Claim w JWT bywa do godziny nieaktualny — operacje zapisu
 *  baza i tak weryfikuje funkcją `assert_admin`, to jest tylko bramka na interfejs. */
export async function requireAdmin(next = "/admin") {
  const session = await requireUser(next);
  if (!session.isAdmin) redirect("/");
  return session;
}
