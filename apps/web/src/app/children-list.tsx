import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

/**
 * Dzieci rodzica z krótkim stanem każdego — wejście w kartę `/dziecko/[id]`.
 *
 * Ta sama lista stoi na stronie głównej i w „Twoich postępach": rodzic ma mieć jedno dojście
 * do dziecka niezależnie od tego, od której strony zacznie. Identyfikatory wydaje `my_children`
 * (tabela powiązań jest niewidoczna dla PostgREST), a i tak przepuszczą go tylko polityki.
 *
 * `empty` podaje strona: na głównej rodzic bez dziecka czyta, że prośba już poszła, a w
 * postępach nie ma po co wyświetlać pustej sekcji.
 */
export async function ChildrenList({ title, empty }: { title: string; empty?: ReactNode }) {
  const { supabase } = await requireUser("/");

  const { data: children, error } = await supabase.rpc("my_children");
  const ids = (children ?? []).map((row) => row.user_id);

  if (!error && ids.length === 0 && empty === undefined) return null;

  const { data: stats } = await supabase
    .from("v_my_stats")
    .select("user_id, total_points, lessons_done, streak_days, words_due, last_active_on")
    .in("user_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const statsOf = new Map((stats ?? []).map((row) => [row.user_id, row]));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="card-title">{title}</h2>
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      {ids.length === 0 && !error && empty}
      <ul className="flex flex-col gap-4">
        {(children ?? []).map((child) => {
          const stat = statsOf.get(child.user_id);
          return (
            <li key={child.user_id}>
              <Link
                href={`/dziecko/${child.user_id}`}
                className="card flex flex-wrap items-center gap-4 p-5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="text-4xl" aria-hidden>
                  🧒
                </span>
                <span className="card-title">{child.display_name}</span>
                <span className="ml-auto flex flex-wrap items-center gap-2 text-base">
                  <span className="chip">⭐ {stat?.total_points ?? 0}</span>
                  <span className="chip">📘 {stat?.lessons_done ?? 0}</span>
                  <span className="chip">🔥 {stat?.streak_days ?? 0}</span>
                  {(stat?.words_due ?? 0) > 0 && <span className="chip">🔁 {stat?.words_due}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
