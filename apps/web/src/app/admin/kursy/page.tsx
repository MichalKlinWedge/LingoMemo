import Link from "next/link";
import { Suspense } from "react";

import { Flag } from "@/components/flag";
import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { NewCourse } from "./panels";

async function Courses() {
  const { supabase } = await requireAdmin("/admin/kursy");

  const [{ data: courses, error }, { data: languages }] = await Promise.all([
    supabase
      .from("courses")
      .select("id, slug, title, description, icon, target_lang, sort_order, is_published")
      .order("sort_order"),
    supabase.from("languages").select("code, name_pl").eq("is_active", true).order("code"),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="card-title">Kursy</h2>
        {(courses ?? []).length === 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">Jeszcze żadnego kursu. Zacznij od formularza poniżej.</p>
        )}
        <ul className="flex flex-col gap-3">
          {(courses ?? []).map((course) => (
            <li key={course.id}>
              <Link href={`/admin/kursy/${course.slug}`} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 items-center gap-3">
                  <Flag code={course.target_lang} fallback={course.icon} size={36} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{course.title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">{course.slug}</span>
                  </span>
                </span>
                <span className="chip">{course.is_published ? "widoczny" : "ukryty"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <NewCourse languages={languages ?? []} />
    </>
  );
}

export default function CoursesPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Kursy"
        intro="Kurs → działy → lekcje → słówka. Ukryte treści widzi tylko administrator."
      />
      <Suspense fallback={<Loading />}>
        <Courses />
      </Suspense>
    </Shell>
  );
}
