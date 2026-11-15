import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Home() {
  // Imię, punkty i seria są w pasku u góry (`TopBar`) — tu zostaje sama lista kursów.
  const { supabase } = await requireUser("/");

  const { data: courses, error } = await supabase
    .from("courses")
    .select("id, slug, title, description, icon")
    .order("sort_order");

  return (
    <>
      <PageHeader title="Twoje kursy" />
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      <ul className="flex flex-col gap-4">
        {(courses ?? []).map((course) => (
          <li key={course.id}>
            <Link href={`/kurs/${course.slug}`} className="card flex items-center gap-4 p-5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <span className="text-5xl" aria-hidden>
                {course.icon ?? "📘"}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="card-title">{course.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{course.description}</span>
              </div>
              <span className="ml-auto text-3xl" aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {(courses ?? []).length === 0 && !error && (
        <p className="text-zinc-600 dark:text-zinc-400">Nie ma jeszcze żadnego kursu.</p>
      )}
    </>
  );
}

export default function HomePage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Home />
      </Suspense>
    </Shell>
  );
}
