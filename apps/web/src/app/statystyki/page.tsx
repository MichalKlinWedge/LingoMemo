import { Suspense } from "react";

import { DAYS, formatDuration, plural, POINTS, spellDuration, WORDS } from "@lingomemo/core";

import { CRUMB_HOME } from "@/components/breadcrumbs";
import { Flag } from "@/components/flag";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, Tile, WeekChart } from "@/components/stats-widgets";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Stats() {
  const { supabase, userId } = await requireUser("/statystyki");

  const [{ data: stats, error }, { data: daily }, { data: weak }, { data: courses }] = await Promise.all([
    supabase.from("v_my_stats").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("v_my_daily").select("day, answers, correct"),
    supabase.from("v_my_weak_words").select("*").gt("lapses", 0).order("lapses", { ascending: false }).limit(5),
    supabase.from("v_my_courses").select("*").eq("user_id", userId).order("course_title"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const secondsWeek = stats?.seconds_week ?? 0;
  const secondsTotal = stats?.seconds_total ?? 0;

  return (
    <>
      <PageHeader crumbs={[CRUMB_HOME]} title="Twoje postępy" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="⭐" value={stats?.total_points ?? 0} label="punktów" />
        <Tile icon="🔥" value={stats?.streak_days ?? 0} label={plural(stats?.streak_days ?? 0, DAYS).split(" ")[1] ?? "dni"} />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="umianych słówek" />
        <Tile icon="🔁" value={stats?.words_due ?? 0} label="do powtórki" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="📘" value={stats?.lessons_done ?? 0} label="zaliczonych lekcji" />
        <Tile icon="🗣️" value={stats?.words_seen ?? 0} label="poznanych słówek" />
        <Tile icon="⏱️" value={formatDuration(secondsWeek)} label="nauki w tym tygodniu" />
        <Tile icon="🎯" value={accuracy(stats?.answers_correct ?? 0, stats?.answers_total ?? 0)} label="trafionych odpowiedzi" />
      </div>

      <WeekChart daily={daily ?? []} />

      {(courses ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="card-title">Twoje kursy</h2>
          <ul className="flex flex-col gap-2">
            {(courses ?? []).map((course) => (
              <li key={course.course_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 items-center gap-3">
                  <Flag code={course.course_target_lang} fallback={course.course_icon} size={36} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{course.course_title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">
                      lekcje: {course.lessons_done} z {course.lessons_total} · {plural(course.words_seen ?? 0, WORDS)}
                    </span>
                  </span>
                </span>
                <span className="chip">⏱️ {formatDuration(course.seconds_total ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        {plural(stats?.total_points ?? 0, POINTS)} · czas nauki od początku: {spellDuration(secondsTotal)}
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
