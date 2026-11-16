import { Suspense } from "react";

import { plural, POINTS } from "@lingomemo/core";

import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Rewards() {
  const { supabase, userId } = await requireUser("/nagrody");

  const [{ data: badges, error }, { data: mine }, { data: stats }] = await Promise.all([
    supabase.from("badges").select("code, title, description, icon, rule").eq("is_active", true).order("sort_order"),
    // Filtr po użytkowniku: polityka `user_badges_read` puszcza rodzicowi odznaki jego dzieci,
    // a administratorowi wszystkie — bez tego cudza odznaka zapalałaby się tu jako zdobyta.
    supabase.from("user_badges").select("badge_code, awarded_at").eq("user_id", userId),
    supabase.from("v_my_stats").select("total_points, badges_earned").eq("user_id", userId).maybeSingle(),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const earned = new Map((mine ?? []).map((row) => [row.badge_code, row.awarded_at]));

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME]}
        title="Nagrody"
        intro={`Masz ${plural(stats?.total_points ?? 0, POINTS)} i ${stats?.badges_earned ?? 0} z ${(badges ?? []).length} odznak.`}
      />

      <ul className="grid gap-4 sm:grid-cols-2">
        {(badges ?? []).map((badge) => {
          const when = earned.get(badge.code);
          const got = when !== undefined;

          return (
            <li
              key={badge.code}
              className="card flex items-center gap-4 p-5"
              style={got ? undefined : { opacity: 0.55, filter: "grayscale(1)" }}
            >
              <span className="text-5xl" aria-hidden>
                {got ? (badge.icon ?? "🏅") : "🔒"}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="card-title">{badge.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{badge.description}</span>
                {got && (
                  <span className="text-sm text-zinc-500">
                    zdobyta {new Date(when).toLocaleDateString("pl-PL")}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export default function RewardsPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Rewards />
      </Suspense>
    </Shell>
  );
}
