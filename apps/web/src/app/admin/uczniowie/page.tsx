import Link from "next/link";
import { Suspense } from "react";

import { formatDuration } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { PasswordForm } from "../konta/password-form";

/** Data po polsku albo „nigdy" — `last_sign_in_at` jest puste do pierwszego logowania. */
const data = (value: string | null): string => (value ? new Date(value).toLocaleDateString("pl-PL") : "nigdy");

/**
 * Jedna strona na wszystko, co dotyczy ludzi: postępy dziecka i jego konto.
 *
 * Wcześniej były dwie listy tych samych osób — „Uczniowie" (punkty, lekcje, czas)
 * i „Konta" (logowanie, hasło). Żeby zmienić dziecku hasło po zajrzeniu w jego wyniki,
 * trzeba było wrócić do panelu i wejść w drugi kafelek, a obie listy i tak czytały
 * te same wiersze z `profiles`.
 */
async function People() {
  const { supabase, userId } = await requireAdmin("/admin/uczniowie");

  // Trzy źródła, bo każde wie co innego: `list_students` postępy, `list_accounts` konto,
  // `v_my_stats` czas nauki. Widok ma `security_invoker`, a polityki `*_read` dopuszczają
  // administratora, więc to samo zapytanie, które dziecku zwraca jeden wiersz, tu zwraca wszystkie.
  const [{ data: students, error }, { data: accounts, error: accountsError }, { data: stats }] = await Promise.all([
    supabase.rpc("list_students"),
    supabase.rpc("list_accounts"),
    supabase.from("v_my_stats").select("user_id, seconds_total, seconds_week, words_mastered"),
  ]);

  const problem = error ?? accountsError;
  if (problem) return <p className="msg-error">{dbLoadError(problem)}</p>;
  if ((students ?? []).length === 0) return <p className="text-zinc-600 dark:text-zinc-400">Nie ma jeszcze kont.</p>;

  const accountOf = new Map((accounts ?? []).map((row) => [row.user_id, row]));
  const timeOf = new Map((stats ?? []).map((row) => [row.user_id, row]));

  return (
    <ul className="flex flex-col gap-3">
      {(students ?? []).map((student) => {
        const account = accountOf.get(student.user_id);
        const extra = timeOf.get(student.user_id);
        const self = student.user_id === userId;

        return (
          <li key={student.user_id} className="card flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                {/* Imię prowadzi do karty dziecka — tam jest wykres, słabe słówka i poziom. */}
                <Link href={`/admin/uczniowie/${student.user_id}`} className="font-semibold hover:text-brand">
                  {student.display_name}
                  {self && " · to Ty"}
                </Link>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{student.email}</span>
              </span>

              <span className="flex flex-wrap items-center gap-2 text-base">
                <span className="chip">{student.is_admin ? "administrator" : "uczeń"}</span>
                <span className="chip">⭐ {student.total_points}</span>
                <span className="chip">📘 {student.lessons_done}</span>
                <span className="chip">🧠 {student.words_seen}</span>
                <span className="chip">🔥 {student.streak_days}</span>
                <span className="chip">🎚️ poziom {student.level}</span>
                <span className="chip">⏱️ {formatDuration(extra?.seconds_total ?? 0)}</span>
              </span>
            </div>

            <p className="text-sm text-zinc-500">
              {student.last_active_on
                ? `ostatnio uczył się ${new Date(student.last_active_on).toLocaleDateString("pl-PL")}`
                : "jeszcze się nie uczył"}
              {" · "}konto od {data(account?.created_at ?? null)}
              {" · "}ostatnie logowanie {data(account?.last_sign_in_at ?? null)}
              {account?.password_changed_at && ` · hasło zmieniane ${data(account.password_changed_at)}`}
            </p>

            <PasswordForm userId={student.user_id} displayName={student.display_name} self={self} />
          </li>
        );
      })}
    </ul>
  );
}

export default function PeoplePage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Uczniowie i konta"
        intro="Postępy, czas nauki i dane konta. Hasła nie da się podejrzeć — można je tylko ustawić na nowo. Kliknij imię, żeby zobaczyć kartę dziecka."
      />
      <Suspense fallback={<Loading />}>
        <People />
      </Suspense>
    </Shell>
  );
}
