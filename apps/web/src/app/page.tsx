import Link from "next/link";
import { Suspense } from "react";

import { signOut } from "@/app/auth-actions";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Home() {
  const { supabase, userId, isAdmin } = await requireUser("/");

  const [{ data: profile }, { data: courses, error }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.from("courses").select("id, slug, title, description, icon").order("sort_order"),
  ]);

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1>Cześć, {profile?.display_name ?? "uczniu"}!</h1>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link href="/admin/zaproszenia" className="btn-secondary px-4 py-2 text-base">
              Zaproszenia
            </Link>
          )}
          <form action={signOut}>
            <button type="submit" className="btn-secondary px-4 py-2 text-base">
              Wyloguj
            </button>
          </form>
        </div>
      </header>

      <h2>Twoje kursy</h2>
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      <ul className="flex flex-col gap-4">
        {(courses ?? []).map((course) => (
          <li key={course.id} className="card flex items-center gap-4 p-5">
            <span className="text-5xl" aria-hidden>
              {course.icon ?? "📘"}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="card-title">{course.title}</span>
              <span className="text-base text-zinc-600 dark:text-zinc-400">{course.description}</span>
            </div>
            <span className="chip ml-auto">wkrótce</span>
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
