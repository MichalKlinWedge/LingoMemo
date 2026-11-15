import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Students() {
  const { supabase } = await requireAdmin("/admin/uczniowie");
  const { data: students, error } = await supabase.rpc("list_students");

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  return (
    <ul className="flex flex-col gap-3">
      {(students ?? []).map((student) => (
        <li key={student.user_id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-col">
            <span className="font-semibold">
              {student.display_name}
              {student.is_admin && " · administrator"}
            </span>
            <span className="text-base text-zinc-600 dark:text-zinc-400">{student.email}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-base">
            <span className="chip">⭐ {student.total_points}</span>
            <span className="chip">📘 {student.lessons_done}</span>
            <span className="chip">🧠 {student.words_seen}</span>
            <span className="chip">🔥 {student.streak_days}</span>
            <span className="text-sm text-zinc-500">
              {student.last_active_on
                ? `ostatnio ${new Date(student.last_active_on).toLocaleDateString("pl-PL")}`
                : "jeszcze się nie uczył"}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StudentsPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: "/admin", label: "Panel" }}
        title="Uczniowie"
        intro="Punkty, ukończone lekcje, przerobione słówka i seria dni."
      />
      <Suspense fallback={<Loading />}>
        <Students />
      </Suspense>
    </Shell>
  );
}
