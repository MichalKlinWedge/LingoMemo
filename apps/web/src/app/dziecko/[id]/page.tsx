import { Suspense } from "react";

import { formatDuration, plural, WORDS } from "@lingomemo/core";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { accuracy, Tile, WeekChart } from "@/components/stats-widgets";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

const CRUMB_HOME = { href: "/", label: "Twoje dzieci" };

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

  const [{ data: profile, error }, { data: stats }, { data: daily }, { data: weak }] = await Promise.all([
    supabase.from("profiles").select("id, display_name").eq("id", id).maybeSingle(),
    supabase.from("v_my_stats").select("*").eq("user_id", id).maybeSingle(),
    supabase.from("v_my_daily").select("day, answers, correct").eq("user_id", id),
    supabase
      .from("v_my_weak_words")
      .select("concept_id, source_text, target_text, lapses, due_on")
      .eq("user_id", id)
      .order("lapses", { ascending: false })
      .limit(10),
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
