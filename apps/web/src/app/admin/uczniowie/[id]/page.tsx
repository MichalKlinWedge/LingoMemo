import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DAYS, formatDuration, LESSONS, plural, POINTS, spellDuration, WORDS } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, Tile, WeekChart } from "@/components/stats-widgets";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

const CRUMB_STUDENTS = { href: "/admin/uczniowie", label: "Uczniowie" };

/**
 * Statystyki jednego dziecka oczami dorosłego. Te same widoki, co na ekranie dziecka —
 * `security_invoker` plus polityki `*_read` sprawiają, że administratorowi zwracają wiersz
 * wskazanego dziecka, a dziecku tylko jego własny. Osobnej funkcji nie trzeba.
 */
async function Student({ params }: { params: PageProps<"/admin/uczniowie/[id]">["params"] }) {
  const { id } = await params;
  const { supabase } = await requireAdmin(`/admin/uczniowie/${id}`);

  const { data: profile } = await supabase.from("profiles").select("id, display_name").eq("id", id).maybeSingle();
  if (!profile) notFound();

  const [{ data: stats, error }, { data: daily }, { data: courses }, { data: weak }] = await Promise.all([
    supabase.from("v_my_stats").select("*").eq("user_id", id).maybeSingle(),
    supabase.from("v_my_daily").select("day, answers, correct").eq("user_id", id),
    supabase.from("v_my_courses").select("*").eq("user_id", id).order("course_title"),
    supabase
      .from("v_my_weak_words")
      .select("*")
      .eq("user_id", id)
      .gt("lapses", 0)
      .order("lapses", { ascending: false })
      .limit(8),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const secondsTotal = stats?.seconds_total ?? 0;
  const sessions = stats?.sessions_done ?? 0;
  // Średnia z dokończonych podejść, nie z zaliczonych lekcji: lekcja powtarzana trzy razy
  // zajęła trzy razy tyle czasu i tak ma być liczona.
  const perLesson = sessions === 0 ? 0 : Math.round(secondsTotal / sessions);

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL, CRUMB_STUDENTS]}
        title={profile.display_name}
        intro={
          stats?.first_active_on
            ? `Uczy się od ${new Date(stats.first_active_on).toLocaleDateString("pl-PL")}.`
            : "Nie zaczął jeszcze żadnej lekcji."
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="📘" value={stats?.lessons_done ?? 0} label="zaliczonych lekcji" />
        <Tile icon="🗣️" value={stats?.words_seen ?? 0} label="poznanych słówek" />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="umianych słówek" />
        <Tile icon="⏱️" value={formatDuration(secondsTotal)} label="czasu nauki" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="📅" value={formatDuration(stats?.seconds_week ?? 0)} label="w tym tygodniu" />
        <Tile icon="⌛" value={formatDuration(perLesson)} label="średnio na lekcję" />
        <Tile icon="🎯" value={accuracy(stats?.answers_correct ?? 0, stats?.answers_total ?? 0)} label="trafionych odpowiedzi" />
        <Tile icon="🔥" value={stats?.streak_days ?? 0} label="dni z rzędu" />
      </div>

      <WeekChart daily={daily ?? []} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Kursy</h2>
        {(courses ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Dziecko nie jest zapisane na żaden kurs. Zapisuje się je na stronie kursu.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(courses ?? []).map((course) => (
              <li key={course.course_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="text-3xl" aria-hidden>
                    {course.course_icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{course.course_title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">
                      {plural(course.lessons_done ?? 0, LESSONS)} z {course.lessons_total} ·{" "}
                      {plural(course.words_seen ?? 0, WORDS)} · umianych: {course.words_mastered} · do powtórki:{" "}
                      {course.words_due}
                    </span>
                  </span>
                </span>
                <span className="chip">⏱️ {formatDuration(course.seconds_total ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Najczęstsze pomyłki</h2>
        {(weak ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nic się jeszcze nie pomyliło.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(weak ?? []).map((word) => (
              <li key={word.concept_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span>
                  <strong>{word.source_text}</strong> — {word.target_text}
                </span>
                <span className="flex items-center gap-2">
                  <span className="chip">{plural(word.lapses ?? 0, ["pomyłka", "pomyłki", "pomyłek"])}</span>
                  <span className="text-sm text-zinc-500">
                    powtórka {word.due_on ? new Date(word.due_on).toLocaleDateString("pl-PL") : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-base text-zinc-500">
        Odpowiedzi łącznie: {stats?.answers_total ?? 0} · dokończonych podejść do lekcji: {sessions} ·{" "}
        {plural(stats?.total_points ?? 0, POINTS)} · najdłuższa seria: {plural(stats?.best_streak ?? 0, DAYS)} · odznaki:{" "}
        {stats?.badges_earned ?? 0} · czas nauki: {spellDuration(secondsTotal)}
      </p>
    </>
  );
}

export default function StudentPage({ params }: PageProps<"/admin/uczniowie/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Student params={params} />
      </Suspense>
    </Shell>
  );
}
