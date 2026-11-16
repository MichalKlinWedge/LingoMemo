import Link from "next/link";
import { Suspense } from "react";

import { ChildrenList } from "@/app/children-list";
import { CourseRequest } from "@/app/course-request";
import { Flag } from "@/components/flag";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function Home() {
  // Imię, punkty i seria są w pasku u góry (`TopBar`) — tu zostaje lista kursów, a rodzicowi
  // dodatkowo lista jego dzieci.
  const { supabase, userId, isParent, isAdmin } = await requireUser("/");

  const [{ data: courses, error }, { data: enrolled }, { data: asked }] = await Promise.all([
    supabase.from("courses").select("id, slug, title, description, icon, target_lang").order("sort_order"),
    // Filtr po użytkowniku mimo RLS: uczeń widzi w tej tabeli tylko swoje zapisy, ale
    // administrator widzi wszystkie, a rodzic także zapisy swoich dzieci — bez filtru miałby
    // u siebie kursy, których sam się nie uczy.
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
      {/* Rodzic uczy się jak dziecko — swoich kursów, na swoim koncie. Dlatego ma na stronie
          jedno i drugie: dzieci, po które tu przychodzi, i kursy, na które go zapisano.
          Rodzic-administrator (jedno konto obsługujące oba) widzi dokładnie to samo. */}
      <PageHeader title={isParent ? "Twoje dzieci i kursy" : "Twoje kursy"} />
      {isParent && (
        // Prośba poszła sama przy logowaniu (`request_child_access`), więc nie każemy rodzicowi
        // szukać innej drogi — mówimy w `empty`, że już czeka.
        <ChildrenList
          title="Twoje dzieci"
          empty={
            <p className="text-zinc-600 dark:text-zinc-400">
              Nie masz jeszcze przypisanego żadnego dziecka. Administrator dostał prośbę o dostęp —
              pokaże się tutaj, gdy ją zatwierdzi.
            </p>
          }
        />
      )}
      {error && <p className="msg-error">{dbLoadError(error)}</p>}
      {isParent && <h2 className="card-title">Twoje kursy</h2>}
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
