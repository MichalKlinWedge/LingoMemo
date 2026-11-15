import Link from "next/link";

import { DAYS, plural, POINTS } from "@lingomemo/core";

import { signOut } from "@/app/auth-actions";
import { Logo } from "@/components/logo";
import { getUser } from "@/lib/auth";

/**
 * Pasek u góry każdej strony: imię, punkty, seria i wyjście. Dziecko widzi swój stan zawsze,
 * a nie tylko na stronie głównej — po to, żeby punkty zdobyte w lekcji od razu było widać.
 * Dla niezalogowanego (logowanie, zaproszenie) nie renderuje się nic.
 */
export async function TopBar() {
  const session = await getUser();
  if (!session) return null;

  const { supabase, userId, isAdmin } = session;

  const [{ data: profile }, { data: stats }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.from("v_my_stats").select("total_points, streak_days, words_due").eq("user_id", userId).maybeSingle(),
  ]);

  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        {/* Imię prowadzi na stronę główną — to jest „wyjście” z każdego miejsca aplikacji. */}
        <Link href="/" className="app-bar-name flex items-center gap-2">
          <Logo size={36} />
          Cześć, {profile?.display_name ?? "uczniu"}!
        </Link>

        <nav className="flex flex-wrap items-center gap-2">
          <Link href="/nagrody" className="chip">
            ⭐ {plural(stats?.total_points ?? 0, POINTS)}
          </Link>
          <Link href="/statystyki" className="chip">
            🔥 {plural(stats?.streak_days ?? 0, DAYS)}
          </Link>
          {(stats?.words_due ?? 0) > 0 && (
            <Link href="/statystyki" className="chip">
              🔁 {stats?.words_due} do powtórki
            </Link>
          )}
        </nav>

        <div className="app-bar-actions">
          {isAdmin && (
            <Link href="/admin" className="btn-secondary">
              Panel
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="btn-secondary">
              Wyloguj
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
