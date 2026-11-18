import { Suspense } from "react";

import { plural, POINTS } from "@lingomemo/core";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Rewards() {
  const { supabase, userId } = await requireUser("/nagrody");

  const [{ data: badges, error }, { data: mine }, { data: stats }, { data: progress }] = await Promise.all([
    supabase.from("badges").select("code, title, description, icon, rule").eq("is_active", true).order("sort_order"),
    // Filtr po użytkowniku: polityka `user_badges_read` puszcza rodzicowi odznaki jego dzieci,
    // a administratorowi wszystkie — bez tego cudza odznaka zapalałaby się tu jako zdobyta.
    supabase.from("user_badges").select("badge_code, awarded_at").eq("user_id", userId),
    supabase.from("v_my_stats").select("total_points, badges_earned").eq("user_id", userId).maybeSingle(),
    // Ile brakuje do każdej odznaki. Liczy baza, nie ta strona: progi i sposób liczenia stoją
    // w `badges.rule` i w `badge_values()`, a tu wystarczy „7 z 10”.
    supabase.rpc("my_badge_progress"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const earned = new Map((mine ?? []).map((row) => [row.badge_code, row.awarded_at]));
  const postep = new Map((progress ?? []).map((row) => [row.code, row]));

  return (
    <>
      <PageHeader
        title="Nagrody"
        intro={`Masz ${plural(stats?.total_points ?? 0, POINTS)} i ${stats?.badges_earned ?? 0} z ${(badges ?? []).length} odznak.`}
      />

      <ul className="grid gap-4 sm:grid-cols-2">
        {(badges ?? []).map((badge) => {
          const when = earned.get(badge.code);
          const got = when !== undefined;
          const ile = postep.get(badge.code);
          // Udział w progu, od zera do jedynki. Wartość z bazy jest już przycięta do progu.
          const udzial = ile !== undefined && ile.target > 0 ? ile.value / ile.target : 0;

          return (
            <li key={badge.code} className="card flex items-center gap-4 p-5">
              {/* Przygaszamy samą ikonę, nie całą kartę: pasek postępu i opis mają zostać
                  czytelne, bo to one mówią, co trzeba zrobić, żeby odznakę zdobyć. */}
              <span className="text-5xl" aria-hidden style={got ? undefined : { opacity: 0.5 }}>
                {got ? (badge.icon ?? "🏅") : "🔒"}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="card-title">{badge.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{badge.description}</span>
                {got ? (
                  <span className="text-sm text-zinc-500">
                    zdobyta {new Date(when).toLocaleDateString("pl-PL")}
                  </span>
                ) : (
                  ile !== undefined && (
                    <span className="mt-2 flex flex-col gap-1">
                      <span className="text-sm text-zinc-500">
                        {ile.value} z {ile.target}
                      </span>
                      <span className="badge-bar">
                        <span style={{ width: `${Math.round(udzial * 100)}%` }} />
                      </span>
                    </span>
                  )
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
