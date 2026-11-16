import Link from "next/link";
import type { ReactNode } from "react";

import { plural, POINTS } from "@lingomemo/core";

import { requireUser } from "@/lib/auth";

/**
 * Zdobyte odznaki — sekcja używana trzy razy: w „Twoich postępach", na karcie dziecka dla
 * rodzica i na tej samej karcie dla dziecka.
 *
 * Bez `user` dotyczy zalogowanego: dochodzi wtedy licznik punktów i odnośnik do „Nagród",
 * bo to jego własna strona. Z `user` (dziecko) zostają same odznaki z datami — punkty dziecka
 * stoją wyżej na karcie, a „Nagrody" pokazałyby rodzicowi jego własne.
 *
 * O dostępie decyduje RLS, nie ten komponent: `user_badges` wydaje rodzicowi wiersze tylko
 * tych dzieci, które administrator mu przypisał.
 *
 * Kolejność z `badges.sort_order`, a nie z kolejności zdobywania — na stronie „Nagrody" stoją
 * tak samo, więc ta sama odznaka jest w tym samym miejscu listy.
 */
export async function BadgeList({
  title,
  note,
  user,
}: {
  title: string;
  note?: ReactNode;
  user?: string;
}) {
  const { supabase, userId } = await requireUser("/");
  const czyje = user ?? userId;
  const wlasne = user === undefined;

  const [{ data: badges }, { data: mine }, { data: stats }] = await Promise.all([
    supabase.from("badges").select("code, title, icon").eq("is_active", true).order("sort_order"),
    supabase.from("user_badges").select("badge_code, awarded_at").eq("user_id", czyje),
    wlasne
      ? supabase.from("v_my_stats").select("total_points").eq("user_id", czyje).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const kiedy = new Map((mine ?? []).map((row) => [row.badge_code, row.awarded_at]));
  const zdobyte = (badges ?? []).filter((badge) => kiedy.has(badge.code));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="card-title">{title}</h2>
      {note}
      {zdobyte.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Jeszcze żadnej — pierwsza jest za ukończoną lekcję.
          {wlasne && (
            <>
              {" "}
              <Link href="/nagrody" className="back-link">
                Zobacz, co można zdobyć
              </Link>
              .
            </>
          )}
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
        {wlasne ? (
          <>
            Masz {plural(stats?.total_points ?? 0, POINTS)} i {zdobyte.length} z {(badges ?? []).length} odznak.{" "}
            <Link href="/nagrody" className="back-link">
              Wszystkie nagrody
            </Link>
            .
          </>
        ) : (
          <>
            Zdobyte: {zdobyte.length} z {(badges ?? []).length}.
          </>
        )}
      </p>
    </section>
  );
}
