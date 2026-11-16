import { redirect } from "next/navigation";

import { createClient } from "./supabase/server";

/**
 * Sesja, jeśli ktoś jest zalogowany — bez przekierowania. `getClaims` weryfikuje token, a nie
 * tylko czyta cookie — `getSession` na serwerze nie jest wiarygodne. Dla elementów wspólnych
 * (pasek u góry), które mają się pokazać zalogowanemu, a na logowaniu zniknąć bez przekierowań.
 */
export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;
  const app = data.claims.app_metadata as { is_admin?: boolean; is_parent?: boolean } | undefined;
  return {
    supabase,
    userId: data.claims.sub,
    email: data.claims.email as string | undefined,
    isAdmin: app?.is_admin === true,
    // Rodzic widzi na stronie głównej swoje dzieci, a pod nimi swoje kursy — uczy się na tych
    // samych zasadach co dziecko. Którego dziecka dotyczy strona, rozstrzyga i tak baza
    // (`my_child_ids`), nie ten claim.
    isParent: app?.is_parent === true,
  };
}

/**
 * Zalogowany użytkownik albo przekierowanie na logowanie (z powrotem pod `next`).
 * Sprawdzenie jest w każdej stronie i akcji, nie tylko w proxy (akcje omijają matcher).
 */
export async function requireUser(next = "/") {
  const session = await getUser();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session;
}

/** Strona panelu administratora. Claim w JWT bywa do godziny nieaktualny — operacje zapisu
 *  baza i tak weryfikuje funkcją `assert_admin`, to jest tylko bramka na interfejs. */
export async function requireAdmin(next = "/admin") {
  const session = await requireUser(next);
  if (!session.isAdmin) redirect("/");
  return session;
}
