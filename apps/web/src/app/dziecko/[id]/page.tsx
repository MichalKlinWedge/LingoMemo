import { Suspense } from "react";

import { formatDuration, LESSONS, plural, WORDS } from "@lingomemo/core";

import { Flag } from "@/components/flag";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, Tile, WeekChart } from "@/components/stats-widgets";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

const CRUMB_HOME = { href: "/", label: "Twoje dzieci" };

/**
 * Stan jednej lekcji jednym znakiem i jednym słowem. Zamknięta idzie przed resztą: lekcja
 * nietknięta, do której dziecko jeszcze nie może wejść, to co innego niż taka, którą po prostu
 * omija — a bez tego rozróżnienia rodzic pyta „czemu tego nie zrobił".
 */
function lessonMark(lesson: { is_unlocked: boolean; status: string }): { icon: string; label: string } {
  if (lesson.status === "completed") return { icon: "✅", label: "zaliczona" };
  if (lesson.status === "in_progress") return { icon: "▶️", label: "zaczęta" };
  if (!lesson.is_unlocked) return { icon: "🔒", label: "jeszcze zamknięta" };
  return { icon: "◻️", label: "do zrobienia" };
}

/**
 * Postępy jednego dziecka, oglądane przez rodzica.
 *
 * O dostępie nie decyduje ta strona, tylko polityki RLS: rodzic dostaje wiersze wyłącznie tych
 * kont, które administrator mu przypisał. Wejście pod adres cudzego dziecka kończy się pustym
 * profilem i komunikatem, a nie podejrzeniem czyichś danych — dlatego nie ma tu osobnego
 * sprawdzania uprawnień, które mogłoby się rozjechać z regułą w bazie.
 *
 * Czego tu nie ma: poprawnych odpowiedzi do zadań. Rodzic widzi, co dziecko wpisało i przy
 * którym słówku, ale tabela `exercises` zostaje zamknięta — leżą w niej klucze odpowiedzi
 * do całego kursu.
 */
async function Child({ params }: { params: PageProps<"/dziecko/[id]">["params"] }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/dziecko/${id}`);

  const [
    { data: profile, error },
    { data: stats },
    { data: daily },
    { data: weak },
    { data: courses },
    { data: tries },
    { data: lessons },
    { data: units },
  ] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", id).maybeSingle(),
    supabase.from("v_my_stats").select("*").eq("user_id", id).maybeSingle(),
    supabase.from("v_my_daily").select("day, answers, correct").eq("user_id", id),
    supabase
      .from("v_my_weak_words")
      .select("concept_id, source_text, target_text, lapses, due_on")
      .eq("user_id", id)
      .order("lapses", { ascending: false })
      .limit(10),
    // Kursy i podejścia do lekcji wychodzą tą samą drogą co reszta: widoki są
    // `security_invoker`, a polityki `*_read` puszczają rodzicowi wiersze przypisanych dzieci.
    supabase.from("v_my_courses").select("*").eq("user_id", id).order("course_title"),
    supabase
      .from("lesson_sessions")
      .select("id, lesson_id, started_at, finished_at, score, correct_count, total_exercises")
      .eq("user_id", id)
      .order("started_at", { ascending: false })
      .limit(10),
    // Wszystkie lekcje dziecka, także nietknięte. Widok `v_my_lessons` liczyłby je dla
    // zalogowanego, czyli dla rodzica — stąd funkcja z parametrem.
    supabase.rpc("child_lessons", { p_child: id }),
    supabase.from("units").select("id, course_id, title, icon, sort_order").order("sort_order"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;
  if (!profile) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Nie widzisz tego konta. Dostęp do postępów dziecka nadaje administrator.
      </p>
    );
  }

  const sessions = stats?.sessions_done ?? 0;
  const secondsTotal = stats?.seconds_total ?? 0;

  // Tytuły lekcji dociągamy osobno: `lesson_sessions` trzyma samo id, a złączenie po stronie
  // PostgREST wymagałoby polityki na `lessons` dopasowanej do tego zapytania.
  const { data: lessonRows } = await supabase
    .from("lessons")
    .select("id, title")
    .in("id", [...new Set((tries ?? []).map((row) => row.lesson_id))]);

  // Lekcja schowana albo skasowana po podejściu nie ma tytułu do pokazania — mówimy to wprost,
  // zamiast zostawiać puste miejsce w wierszu.
  const lessonTitle = (lesson: string) =>
    (lessonRows ?? []).find((row) => row.id === lesson)?.title ?? "lekcja już niedostępna";

  // Działy kursu razem z lekcjami, w kolejności nauki. Dział bez ani jednej widocznej lekcji
  // pomijamy — sam nagłówek nic rodzicowi nie mówi.
  const dzialyKursu = (course: string) =>
    (units ?? [])
      .filter((unit) => unit.course_id === course)
      .map((unit) => ({ unit, lekcje: (lessons ?? []).filter((row) => row.unit_id === unit.id) }))
      .filter((grupa) => grupa.lekcje.length > 0);

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME]}
        title={profile.display_name}
        intro={
          stats?.first_active_on
            ? `Uczy się od ${new Date(stats.first_active_on).toLocaleDateString("pl-PL")}.`
            : "Jeszcze nie zaczął nauki."
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Tile icon="⭐" value={stats?.total_points ?? 0} label="punktów" />
        <Tile icon="📘" value={stats?.lessons_done ?? 0} label="zaliczonych lekcji" />
        <Tile icon="🗣️" value={stats?.words_seen ?? 0} label="poznanych słówek" />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="słówek opanowanych" />
        <Tile icon="🔥" value={stats?.streak_days ?? 0} label="dni z rzędu" />
        <Tile icon="⏱️" value={formatDuration(secondsTotal)} label="nauki w sumie" />
        <Tile icon="📅" value={formatDuration(stats?.seconds_week ?? 0)} label="nauki w tym tygodniu" />
        <Tile
          icon="🎯"
          value={accuracy(stats?.answers_correct ?? 0, stats?.answers_total ?? 0)}
          label="trafionych odpowiedzi"
        />
      </div>

      <WeekChart daily={daily ?? []} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Kursy</h2>
        {(courses ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Dziecko nie jest jeszcze zapisane na żaden kurs. Zapisuje je administrator.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(courses ?? []).map((course) => {
              const dzialy = dzialyKursu(course.course_id);
              const ile = dzialy.reduce((suma, grupa) => suma + grupa.lekcje.length, 0);

              return (
                <li key={course.course_id} className="card flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <Flag code={course.course_target_lang} fallback={course.course_icon} size={32} />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold">{course.course_title}</span>
                        <span className="text-base text-zinc-600 dark:text-zinc-400">
                          {plural(course.lessons_done ?? 0, LESSONS)} z {course.lessons_total} ·{" "}
                          {plural(course.words_seen ?? 0, WORDS)} · umie: {course.words_mastered} · do powtórki:{" "}
                          {course.words_due}
                        </span>
                      </span>
                    </span>
                    <span className="chip">⏱️ {formatDuration(course.seconds_total ?? 0)}</span>
                  </div>

                  {/* Rozwijane, bo kurs potrafi mieć kilkadziesiąt lekcji, a dwa kursy rozłożone
                      naraz zepchnęłyby wykres tygodnia i pomyłki poza ekran. */}
                  {ile > 0 && (
                    <details>
                      <summary className="btn-row cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        Wszystkie lekcje ({ile})
                      </summary>
                      <div className="mt-3 flex flex-col gap-4">
                        {dzialy.map(({ unit, lekcje }) => (
                          <div key={unit.id} className="flex flex-col gap-1">
                            <p className="text-sm font-semibold tracking-wide text-zinc-500 uppercase">
                              {unit.icon && <span aria-hidden>{unit.icon} </span>}
                              {unit.title}
                            </p>
                            <ul className="flex flex-col">
                              {lekcje.map((lekcja) => (
                                <li
                                  key={lekcja.lesson_id}
                                  className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[var(--line)] py-2"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span aria-hidden>{lessonMark(lekcja).icon}</span>
                                    <span className={lekcja.is_unlocked ? "" : "text-zinc-500"}>{lekcja.title}</span>
                                  </span>
                                  <span className="flex flex-wrap items-center gap-2 text-base">
                                    <span className="text-zinc-600 dark:text-zinc-400">{lessonMark(lekcja).label}</span>
                                    {lekcja.stars > 0 && <span aria-hidden>{"⭐".repeat(lekcja.stars)}</span>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Co dziecko ostatnio robiło, lekcja po lekcji. Tabele statystyk mówią „ile", a to jest
          jedyne miejsce, w którym widać „co" — i czy wczorajsze podejście zostało dokończone. */}
      <section className="flex flex-col gap-3">
        <h2 className="card-title">Ostatnie lekcje</h2>
        {(tries ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Jeszcze żadnej rozpoczętej lekcji.</p>
        ) : (
          <ul className="flex flex-col gap-2">
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
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Do poćwiczenia</h2>
        {(weak ?? []).length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Na razie nic się nie myli. {plural(stats?.words_seen ?? 0, WORDS)} za nim.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(weak ?? []).map((word) => (
              <li key={word.concept_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="font-semibold">
                  {word.source_text} → {word.target_text}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-base">
                  <span className="chip">pomyłek: {word.lapses}</span>
                  <span className="text-sm text-zinc-500">
                    powtórka {new Date(word.due_on).toLocaleDateString("pl-PL")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-base text-zinc-600 dark:text-zinc-400">
        {sessions === 0
          ? "Nie ma jeszcze ani jednego podejścia do lekcji."
          : `Podejść do lekcji: ${sessions}, średnio po ${formatDuration(Math.round(secondsTotal / sessions))}.`}
      </p>
    </>
  );
}

export default function ChildPage({ params }: PageProps<"/dziecko/[id]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Child params={params} />
      </Suspense>
    </Shell>
  );
}
