import { Suspense } from "react";

import { DAYS, EXERCISE_LABEL, formatDuration, LESSONS, plural, WORDS } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, BarList, type BarRow, DaysChart, Tile } from "@/components/stats-widgets";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

/**
 * Statystyki całej aplikacji. Wszystkie liczby liczy baza (widoki `v_stats_*`) — strona
 * tylko układa je w kafelki i słupki.
 *
 * Widoki mają `security_invoker`, więc to, ile widać, zależy od tego, kto pyta. Tę stronę
 * otwiera wyłącznie administrator, czyli w praktyce widać tu całość.
 */
async function Stats() {
  const { supabase } = await requireAdmin("/admin/statystyki");

  const [
    { data: summary, error: summaryError },
    { data: daily },
    { data: courses },
    { data: types },
    { data: hard },
    { data: students },
  ] = await Promise.all([
    supabase.from("v_stats_summary").select("*").maybeSingle(),
    supabase.from("v_stats_daily").select("*").order("day"),
    supabase.from("v_stats_courses").select("*").order("course_title"),
    supabase.from("v_stats_exercise_types").select("*"),
    supabase.from("v_stats_hard_words").select("*").order("lapses", { ascending: false }).limit(10),
    supabase.rpc("list_students"),
  ]);

  if (summaryError) return <p className="msg-error">{dbLoadError(summaryError)}</p>;

  const answers = summary?.answers ?? 0;
  const correct = summary?.answers_correct ?? 0;

  // Dzieci, nie konta: administrator ogląda tu naukę, a nie listę użytkowników.
  const uczniowie = (students ?? []).filter((row) => !row.is_admin);

  const kursy: BarRow[] = (courses ?? []).map((course) => ({
    key: course.course_id ?? course.course_title ?? "",
    label: course.course_title ?? "—",
    // Słupek pokazuje, jaka część lekcji kursu jest zaliczona przez wszystkie dzieci razem —
    // kurs z dwójką dzieci po połowie stoi tak samo jak jeden po całości. To jest miara
    // przerobionego materiału, nie postępu pojedynczego dziecka.
    value: course.lessons_done ?? 0,
    display: `${plural(course.lessons_done ?? 0, LESSONS)} zaliczone`,
    note: `${plural(course.learners ?? 0, ["dziecko", "dzieci", "dzieci"])} · ${plural(course.words ?? 0, WORDS)} · umiane: ${course.words_mastered ?? 0}`,
  }));

  const dzieci: BarRow[] = uczniowie
    .map((student) => ({
      key: student.user_id,
      label: student.display_name ?? "bez imienia",
      value: student.total_points ?? 0,
      display: `${student.total_points ?? 0} pkt`,
      note: `${plural(student.lessons_done ?? 0, LESSONS)} · ${plural(student.words_seen ?? 0, WORDS)} · seria ${plural(student.streak_days ?? 0, DAYS)}`,
    }))
    .sort((a, b) => b.value - a.value);

  // Celność po typie zadania. Sortujemy od najgorszej: ten koniec listy jest tym, po co
  // się tu zagląda — typ z celnością 30% zwykle znaczy błąd w treści, a nie trudne słówka.
  const typy: BarRow[] = (types ?? [])
    .filter((row) => (row.answers ?? 0) > 0)
    .map((row) => ({
      key: row.exercise_type ?? "",
      label: EXERCISE_LABEL[row.exercise_type as keyof typeof EXERCISE_LABEL] ?? row.exercise_type ?? "—",
      value: Math.round(((row.correct ?? 0) / (row.answers ?? 1)) * 100),
      display: accuracy(row.correct ?? 0, row.answers ?? 0),
      note: plural(row.answers ?? 0, ["odpowiedź", "odpowiedzi", "odpowiedzi"]),
    }))
    .sort((a, b) => a.value - b.value);

  const trudne: BarRow[] = (hard ?? []).map((word) => ({
    key: word.concept_id ?? "",
    label: `${word.source_text ?? "—"} — ${word.target_text ?? "—"}`,
    value: word.lapses ?? 0,
    display: plural(word.lapses ?? 0, ["pomyłka", "pomyłki", "pomyłek"]),
    note: `${word.course_title ?? ""} · ${plural(word.learners ?? 0, ["dziecko", "dzieci", "dzieci"])}`,
  }));

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Statystyki"
        intro="Cała aplikacja naraz: ile się dzieje, który kurs idzie, komu i na czym się nie udaje."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="🧒" value={summary?.learners ?? 0} label="dzieci na kursach" />
        <Tile icon="🔥" value={summary?.learners_7d ?? 0} label="uczyło się w tym tygodniu" />
        <Tile icon="✍️" value={answers} label="odpowiedzi" />
        <Tile icon="🎯" value={accuracy(correct, answers)} label="trafionych odpowiedzi" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="📘" value={summary?.lessons_done ?? 0} label="zaliczonych lekcji" />
        <Tile icon="🗣️" value={summary?.words_seen ?? 0} label="poznanych słówek" />
        <Tile icon="🧠" value={summary?.words_mastered ?? 0} label="umianych słówek" />
        <Tile icon="⏱️" value={formatDuration(summary?.seconds_total ?? 0)} label="czasu nauki" />
      </div>

      <DaysChart daily={daily ?? []} />

      <BarList
        title="Kursy"
        intro="Słupek to lekcje zaliczone przez wszystkie dzieci razem — ile materiału kursu już poszło w ruch."
        rows={kursy}
        empty="Nie ma jeszcze żadnego kursu."
      />

      <BarList
        title="Dzieci"
        intro="Po punktach, od najpilniejszego."
        rows={dzieci}
        empty="Nikt się jeszcze nie zapisał."
      />

      <BarList
        title="Celność w typach zadań"
        intro="Od najtrudniejszego. Typ, w którym dzieci trafiają rzadko, bywa zepsutą treścią, a nie trudnym materiałem."
        rows={typy}
        empty="Jeszcze nikt nie odpowiadał."
      />

      <BarList
        title="Najtrudniejsze słówka"
        intro="Suma pomyłek wszystkich dzieci. Dziesięć pierwszych."
        rows={trudne}
        empty="Na razie nic się nie myli."
      />
    </>
  );
}

export default function AdminStatsPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Stats />
      </Suspense>
    </Shell>
  );
}
