import Link from "next/link";
import type { ReactNode } from "react";

import { plural, POINTS } from "@lingomemo/core";

import { requireUser } from "@/lib/auth";

/**
 * Zdobyte odznaki i punkty PYTAJĄCEGO — ta sama sekcja w „Twoich postępach" i na karcie dziecka.
 *
 * Rodzic uczy się razem z dzieckiem, więc ogląda swoje nagrody i tam, gdzie ogląda jego naukę.
 * Zawsze dotyczy zalogowanego konta, nigdy oglądanego dziecka: stąd brak parametru z kim, a
 * `note` do wytłumaczenia tego na stronie, która cała jest o kimś innym.
 *
 * Kolejność z `badges.sort_order`, a nie z kolejności zdobywania — na stronie „Nagrody" stoją
 * tak samo, więc ta sama odznaka jest w tym samym miejscu listy.
 */
export async function BadgeList({ title, note }: { title: string; note?: ReactNode }) {
  const { supabase, userId } = await requireUser("/");

  const [{ data: badges }, { data: mine }, { data: stats }] = await Promise.all([
    supabase.from("badges").select("code, title, icon").eq("is_active", true).order("sort_order"),
    supabase.from("user_badges").select("badge_code, awarded_at").eq("user_id", userId),
    supabase.from("v_my_stats").select("total_points").eq("user_id", userId).maybeSingle(),
  ]);

  const kiedy = new Map((mine ?? []).map((row) => [row.badge_code, row.awarded_at]));
  const zdobyte = (badges ?? []).filter((badge) => kiedy.has(badge.code));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="card-title">{title}</h2>
      {note}
      {zdobyte.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Jeszcze żadnej — pierwsza jest za ukończoną lekcję.{" "}
          <Link href="/nagrody" className="back-link">
            Zobacz, co można zdobyć
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {zdobyte.map((badge) => (
            <li key={badge.code} className="chip">
              <span aria-hidden>{badge.icon ?? "🏅"}</span> {badge.title}
              <span className="text-zinc-500">
                {" "}
                · {new Date(kiedy.get(badge.code) as string).toLocaleDateString("pl-PL")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Masz {plural(stats?.total_points ?? 0, POINTS)} i {zdobyte.length} z {(badges ?? []).length} odznak.{" "}
        <Link href="/nagrody" className="back-link">
          Wszystkie nagrody
        </Link>
        .
      </p>
    </section>
  );
}
