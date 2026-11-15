import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DAYS, EXERCISE_LABEL, formatDuration, LESSONS, plural, POINTS, spellDuration, WORDS } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, Tile, WeekChart } from "@/components/stats-widgets";
import { LevelPanel } from "../level-panel";
import { ProfilePanel } from "../profile-panel";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

const CRUMB_STUDENTS = { href: "/admin/uczniowie", label: "Uczniowie i konta" };

/**
 * Co dziecko właściwie wysłało. `raw_answer` ma inny kształt dla każdego typu zadania,
 * a dorosły ma zobaczyć jedno zdanie, nie JSON-a.
 */
function givenAnswer(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "—";
  const answer = raw as Record<string, unknown>;
  if (answer.skipped === true) return "pominięte";
  if (typeof answer.text === "string") return answer.text === "" ? "—" : answer.text;
  if (typeof answer.choice === "string") return answer.choice;
  if (Array.isArray(answer.tokens)) {
    return answer.tokens.filter((token): token is string => typeof token === "string").join(" ");
  }
  if (Array.isArray(answer.pairs)) {
    return answer.pairs
      .map((pair) => {
        if (typeof pair !== "object" || pair === null) return "";
        const para = pair as Record<string, unknown>;
        return `${String(para.a)} — ${String(para.b)}`;
      })
      .filter((text) => text !== "")
      .join(", ");
  }
  return "—";
}

/**
 * Statystyki jednego dziecka oczami dorosłego. Te same widoki, co na ekranie dziecka —
 * `security_invoker` plus polityki `*_read` sprawiają, że administratorowi zwracają wiersz
 * wskazanego dziecka, a dziecku tylko jego własny. Osobnej funkcji nie trzeba.
 */
async function Student({ params }: { params: PageProps<"/admin/uczniowie/[id]">["params"] }) {
  const { id } = await params;
  const { supabase } = await requireAdmin(`/admin/uczniowie/${id}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, level, time_zone")
    .eq("id", id)
    .maybeSingle();
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

  // Historia: ostatnie podejścia do lekcji i ostatnie pomyłki. Polityki `*_read` puszczają
  // administratorowi cudze wiersze, więc wystarczą zwykłe zapytania.
  const [{ data: tries }, { data: misses }] = await Promise.all([
    supabase
      .from("lesson_sessions")
      .select("id, lesson_id, started_at, finished_at, score, correct_count, total_exercises, xp_awarded")
      .eq("user_id", id)
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("attempts")
      .select("id, created_at, exercise_id, concept_id, exercise_type, raw_answer")
      .eq("user_id", id)
      .eq("is_correct", false)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const lessonIds = [...new Set((tries ?? []).map((row) => row.lesson_id))];
  const conceptIds = [...new Set((misses ?? []).map((row) => row.concept_id).filter((x) => x !== null))];
  const exerciseIds = [...new Set((misses ?? []).map((row) => row.exercise_id).filter((x) => x !== null))];

  const [{ data: lessonRows }, { data: termRows }, { data: exerciseRows }] = await Promise.all([
    supabase.from("lessons").select("id, title").in("id", lessonIds),
    supabase.from("terms").select("concept_id, text, is_primary").in("concept_id", conceptIds),
    supabase.from("exercises").select("id, payload").in("id", exerciseIds),
  ]);

  const lessonTitle = (lesson: string) =>
    (lessonRows ?? []).find((row) => row.id === lesson)?.title ?? "lekcja usunięta";
  const wordOf = (concept: string | null) =>
    concept === null ? null : ((termRows ?? []).find((row) => row.concept_id === concept && row.is_primary)?.text ?? null);
  const answerOf = (exercise: string | null) => {
    const payload = (exerciseRows ?? []).find((row) => row.id === exercise)?.payload as Record<string, unknown> | undefined;
    if (!payload) return null;
    if (typeof payload.answer === "string") return payload.answer;
    if (Array.isArray(payload.accepted) && typeof payload.accepted[0] === "string") return payload.accepted[0];
    if (Array.isArray(payload.solution)) {
      return payload.solution.filter((token): token is string => typeof token === "string").join(" ");
    }
    return null;
  };

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

      <ProfilePanel userId={profile.id} displayName={profile.display_name} timeZone={profile.time_zone} />

      <LevelPanel userId={profile.id} level={profile.level} />

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

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Ostatnie podejścia</h2>
        {(tries ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Jeszcze żadnej rozpoczętej lekcji.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(tries ?? []).map((item) => (
              <li key={item.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{lessonTitle(item.lesson_id)}</span>
                  <span className="text-base text-zinc-600 dark:text-zinc-400">
                    {new Date(item.started_at).toLocaleString("pl-PL", {
                      day: "numeric",
                      month: "long",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {item.finished_at === null && " · przerwane"}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {item.correct_count}/{item.total_exercises}
                  </span>
                  {item.score !== null && <span className="chip">{Math.round(item.score * 100)}%</span>}
                  {item.xp_awarded > 0 && <span className="chip">+{item.xp_awarded} pkt</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Ostatnie pomyłki</h2>
        {(misses ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Żadnej błędnej odpowiedzi.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(misses ?? []).map((miss) => (
              <li key={miss.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    {wordOf(miss.concept_id) ?? EXERCISE_LABEL[miss.exercise_type] ?? miss.exercise_type}
                  </span>
                  <span className="text-base text-zinc-600 dark:text-zinc-400">
                    odpowiedź: <strong>{givenAnswer(miss.raw_answer)}</strong>
                    {answerOf(miss.exercise_id) !== null && (
                      <>
                        {" · poprawnie: "}
                        <strong>{answerOf(miss.exercise_id)}</strong>
                      </>
                    )}
                  </span>
                </span>
                <span className="text-sm text-zinc-500">{new Date(miss.created_at).toLocaleDateString("pl-PL")}</span>
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
