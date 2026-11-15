import { Suspense } from "react";

import { DAYS, plural, POINTS, WORDS } from "@lingomemo/core";

import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

/** Siedem ostatnich dni, także tych bez nauki — przerwa w nauce też jest informacją. */
function lastSevenDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - back);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

const WEEKDAY = ["N", "P", "W", "Ś", "C", "P", "S"];

/** Najwyższy słupek tygodnia. */
const BAR_MAX_PX = 112;

function Tile({ value, label, icon }: { value: string | number; label: string; icon: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 p-4 text-center">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <span style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "var(--font-display)" }}>{value}</span>
      <span className="text-base text-zinc-600 dark:text-zinc-400">{label}</span>
    </div>
  );
}

async function Stats() {
  const { supabase, userId } = await requireUser("/statystyki");

  const [{ data: stats, error }, { data: daily }, { data: weak }] = await Promise.all([
    supabase.from("v_my_stats").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("v_my_daily").select("day, answers, correct"),
    supabase.from("v_my_weak_words").select("*").gt("lapses", 0).order("lapses", { ascending: false }).limit(5),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const days = lastSevenDays();
  const byDay = new Map((daily ?? []).map((row) => [row.day, row]));
  const peak = Math.max(1, ...days.map((day) => byDay.get(day)?.answers ?? 0));
  const weekTotal = days.reduce((sum, day) => sum + (byDay.get(day)?.answers ?? 0), 0);

  return (
    <>
      <PageHeader crumbs={[CRUMB_HOME]} title="Twoje postępy" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="⭐" value={stats?.total_points ?? 0} label="punktów" />
        <Tile icon="🔥" value={stats?.streak_days ?? 0} label={plural(stats?.streak_days ?? 0, DAYS).split(" ")[1] ?? "dni"} />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="umianych słówek" />
        <Tile icon="🔁" value={stats?.words_due ?? 0} label="do powtórki" />
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title">Ostatni tydzień</h2>
          <span className="text-base text-zinc-600 dark:text-zinc-400">{plural(weekTotal, ["odpowiedź", "odpowiedzi", "odpowiedzi"])}</span>
        </div>

        {/* Jedna seria, więc bez legendy — tytuł mówi, co to jest. Liczba tylko nad najlepszym
            dniem: podpisywanie każdego słupka zamienia wykres w tabelę. */}
        {/* Wysokości w pikselach, nie w procentach: procent liczy się od wysokości rodzica,
            a ta w elastycznym kontenerze bywa nieokreślona i słupki znikają. */}
        <ol className="flex items-end gap-2">
          {days.map((day) => {
            const row = byDay.get(day);
            const answers = row?.answers ?? 0;
            const height = answers === 0 ? 4 : Math.max(6, Math.round((answers / peak) * BAR_MAX_PX));
            const date = new Date(`${day}T12:00:00`);
            const isPeak = answers === peak && answers > 0;

            return (
              <li key={day} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-sm font-semibold" style={{ height: "1.25rem" }}>
                  {isPeak ? answers : ""}
                </span>
                <div className="flex w-full items-end" style={{ height: `${BAR_MAX_PX}px` }}>
                  <div
                    style={{
                      width: "100%",
                      height: `${height}px`,
                      borderRadius: "4px 4px 0 0",
                      background: answers === 0 ? "var(--line)" : "var(--color-brand)",
                    }}
                    title={`${date.toLocaleDateString("pl-PL")}: ${answers} odpowiedzi, ${row?.correct ?? 0} trafionych`}
                    aria-hidden
                  />
                </div>
                <span className="text-sm text-zinc-500" aria-hidden>
                  {WEEKDAY[date.getDay()]}
                </span>
                <span className="sr-only">
                  {date.toLocaleDateString("pl-PL")}: {answers} odpowiedzi, {row?.correct ?? 0} trafionych
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Do poćwiczenia</h2>
        {(weak ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Na razie nic się nie myli. {plural(stats?.words_seen ?? 0, WORDS)} za tobą.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(weak ?? []).map((word) => (
              <li key={word.concept_id} className="card flex items-center justify-between gap-3 p-4">
                <span>
                  <strong>{word.source_text}</strong> — {word.target_text}
                </span>
                <span className="chip">
                  {plural(word.lapses ?? 0, ["pomyłka", "pomyłki", "pomyłek"])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-base text-zinc-500">
        Razem przerobionych słówek: {plural(stats?.words_seen ?? 0, WORDS)} · zdobytych odznak:{" "}
        {stats?.badges_earned ?? 0} · najdłuższa seria: {plural(stats?.best_streak ?? 0, DAYS)} ·{" "}
        {plural(stats?.total_points ?? 0, POINTS)}
      </p>
    </>
  );
}

export default function StatsPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Stats />
      </Suspense>
    </Shell>
  );
}
