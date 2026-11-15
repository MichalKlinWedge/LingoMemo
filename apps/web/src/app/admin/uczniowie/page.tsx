import Link from "next/link";
import { Suspense } from "react";

import { formatDuration } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Students() {
  const { supabase } = await requireAdmin("/admin/uczniowie");

  // `v_my_stats` ma `security_invoker`, a polityki `*_read` dopuszczają administratora, więc
  // to samo zapytanie, które dziecku zwraca jeden wiersz, tutaj zwraca wiersz każdego dziecka.
  const [{ data: students, error }, { data: stats }] = await Promise.all([
    supabase.rpc("list_students"),
    supabase.from("v_my_stats").select("user_id, seconds_total, seconds_week, words_mastered"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const timeOf = new Map((stats ?? []).map((row) => [row.user_id, row]));

  return (
    <ul className="flex flex-col gap-3">
      {(students ?? []).map((student) => {
        const extra = timeOf.get(student.user_id);
        return (
          <li key={student.user_id}>
            <Link
              href={`/admin/uczniowie/${student.user_id}`}
              className="card flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {student.display_name}
                  {student.is_admin && " · administrator"}
                </span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{student.email}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-base">
                <span className="chip">⭐ {student.total_points}</span>
                <span className="chip">📘 {student.lessons_done}</span>
                <span className="chip">🧠 {student.words_seen}</span>
                <span className="chip">🔥 {student.streak_days}</span>
                <span className="chip">🎚️ poziom {student.level}</span>
                <span className="chip">⏱️ {formatDuration(extra?.seconds_total ?? 0)}</span>
                <span className="text-sm text-zinc-500">
                  {student.last_active_on
                    ? `ostatnio ${new Date(student.last_active_on).toLocaleDateString("pl-PL")}`
                    : "jeszcze się nie uczył"}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function StudentsPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Uczniowie"
        intro="Punkty, ukończone lekcje, przerobione słówka, seria dni i czas nauki. Kliknij dziecko, żeby zobaczyć wszystko."
      />
      <Suspense fallback={<Loading />}>
        <Students />
      </Suspense>
    </Shell>
  );
}
