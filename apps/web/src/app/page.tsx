import Link from "next/link";
import { Suspense } from "react";

import { CourseRequest } from "@/app/course-request";
import { Flag } from "@/components/flag";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

/**
 * Strona główna rodzica: jego dzieci zamiast kursów.
 *
 * Rodzic nie robi lekcji, więc kafelek kursu prowadziłby go do mapy lekcji, której nie ma po co
 * otwierać. Identyfikatory dzieci wydaje `my_children` — tabela powiązań jest niewidoczna dla
 * PostgREST, a polityki i tak przepuszczą rodzicowi tylko te konta.
 */
async function ParentHome() {
  const { supabase } = await requireUser("/");

  const { data: children, error } = await supabase.rpc("my_children");
  const ids = (children ?? []).map((row) => row.user_id);

  const { data: stats } = await supabase
    .from("v_my_stats")
    .select("user_id, total_points, lessons_done, streak_days, words_due, last_active_on")
    .in("user_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);

  const statsOf = new Map((stats ?? []).map((row) => [row.user_id, row]));

  return (
    <>
      <PageHeader title="Twoje dzieci" intro="Kliknij imię, żeby zobaczyć postępy." />
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      {/* Prośba poszła sama przy logowaniu (`request_child_access`), więc nie każemy rodzicowi
          szukać innej drogi — mówimy, że już czeka. */}
      {(children ?? []).length === 0 && !error && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nie masz jeszcze przypisanego żadnego dziecka. Administrator dostał prośbę o dostęp —
          pokaże się tutaj, gdy ją zatwierdzi.
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {(children ?? []).map((child) => {
          const stat = statsOf.get(child.user_id);
          return (
            <li key={child.user_id}>
              <Link
                href={`/dziecko/${child.user_id}`}
                className="card flex flex-wrap items-center gap-4 p-5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="text-4xl" aria-hidden>
                  🧒
                </span>
                <span className="card-title">{child.display_name}</span>
                <span className="ml-auto flex flex-wrap items-center gap-2 text-base">
                  <span className="chip">⭐ {stat?.total_points ?? 0}</span>
                  <span className="chip">📘 {stat?.lessons_done ?? 0}</span>
                  <span className="chip">🔥 {stat?.streak_days ?? 0}</span>
                  {(stat?.words_due ?? 0) > 0 && <span className="chip">🔁 {stat?.words_due}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

async function Home() {
  // Imię, punkty i seria są w pasku u góry (`TopBar`) — tu zostaje sama lista kursów.
  const { supabase, userId, isParent, isAdmin } = await requireUser("/");

  // Rodzic-administrator (jedno konto obsługujące oba) dostaje panel i kursy jak dotąd;
  // rozdzielanie tego na dwa widoki komplikowałoby stronę dla jednego przypadku.
  if (isParent && !isAdmin) return <ParentHome />;

  const [{ data: courses, error }, { data: enrolled }, { data: asked }] = await Promise.all([
    supabase.from("courses").select("id, slug, title, description, icon, target_lang").order("sort_order"),
    // Filtr po użytkowniku mimo RLS: uczeń widzi w tej tabeli tylko swoje zapisy, ale
    // administrator widzi wszystkie — bez filtru miałby u siebie kursy cudzych dzieci.
    supabase.from("enrollments").select("course_id").eq("user_id", userId),
    supabase.rpc("my_course_requests"),
  ]);

  // Kurs bez zapisu jest zamknięty (`is_lesson_unlocked`), więc nie udajemy, że da się w niego
  // wejść: ląduje niżej, z przyciskiem prośby zamiast strzałki.
  const zapisane = new Set((enrolled ?? []).map((row) => row.course_id));
  const poproszone = new Set((asked ?? []).map((row) => row.course_id));
  const moje = (courses ?? []).filter((course) => zapisane.has(course.id));
  const inne = (courses ?? []).filter((course) => !zapisane.has(course.id));

  return (
    <>
      <PageHeader title="Twoje kursy" />
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      <ul className="flex flex-col gap-4">
        {moje.map((course) => (
          <li key={course.id}>
            <Link href={`/kurs/${course.slug}`} className="card flex items-center gap-4 p-5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Flag code={course.target_lang} fallback={course.icon ?? "📘"} size={56} />
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
      {moje.length === 0 && !error && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nie masz jeszcze żadnego kursu. Poproś o dostęp poniżej — administrator Cię dopisze.
        </p>
      )}

      {inne.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="card-title">Inne kursy</h2>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Tych jeszcze nie masz. Poproś o dostęp, a administrator Cię dopisze.
          </p>
          <ul className="flex flex-col gap-4">
            {inne.map((course) => (
              <li key={course.id} className="card flex flex-wrap items-center gap-4 p-5">
                <Flag code={course.target_lang} fallback={course.icon ?? "📘"} size={56} />
                <div className="flex min-w-0 flex-col">
                  <span className="card-title">{course.title}</span>
                  <span className="text-base text-zinc-600 dark:text-zinc-400">{course.description}</span>
                </div>
                <span className="ml-auto">
                  {/* Administrator nie prosi sam siebie — zapisuje się w panelu kursu. */}
                  {isAdmin ? (
                    <Link href={`/admin/kursy/${course.slug}`} className="chip">
                      zapisz się w panelu
                    </Link>
                  ) : (
                    <CourseRequest courseId={course.id} alreadyAsked={poproszone.has(course.id)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
