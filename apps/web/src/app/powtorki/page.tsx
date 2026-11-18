import Link from "next/link";
import { Suspense } from "react";

import { DAYS, plural, WORDS } from "@lingomemo/core";

import { Flag } from "@/components/flag";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { Tile } from "@/components/stats-widgets";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

/** To, co `review_gate` mówi o jednym kursie. Kształt ten sam co na stronie kursu. */
type Bramka = {
  active: boolean;
  due: number;
  limit: number;
  lessonId: string | null;
  testOpen: boolean;
  testFrom: number;
};

/** Ile dni dzieli dwie daty zapisane jako `RRRR-MM-DD`. Ujemne znaczy „już było". */
function dni(od: string, do_: string) {
  return Math.round((Date.parse(`${do_}T00:00:00Z`) - Date.parse(`${od}T00:00:00Z`)) / 86_400_000);
}

/** Termin słówka słowami dziecka, nie datą: „dziś" czyta się szybciej niż „2026-11-18". */
function termin(roznica: number) {
  if (roznica < 0) return `zaległe od ${plural(-roznica, DAYS)}`;
  if (roznica === 0) return "dziś";
  if (roznica === 1) return "jutro";
  return `za ${plural(roznica, DAYS)}`;
}

/**
 * Powtórki w jednym miejscu: co jest do zrobienia teraz, ile słówek czeka i kiedy, oraz jak to
 * wygląda w liczbach.
 *
 * Dotąd powtórki były rozsypane po trzech ekranach: test powtórkowy pokazywał się na stronie
 * kursu, liczba zaległych słówek w pasku, a reszta tonęła wśród postępów. Dziecko, które
 * zobaczyło w pasku „🔁 49", nie miało gdzie kliknąć, żeby zobaczyć, czego te 49 dotyczy.
 */
async function Reviews() {
  const { supabase, userId } = await requireUser("/powtorki");

  const [{ data: courses, error }, { data: words }, { data: stats }, { data: dzis }] = await Promise.all([
    // Filtr po użytkowniku przy każdym widoku: polityki `*_read` puszczają rodzicowi wiersze
    // jego dzieci, a administratorowi wszystkie — bez `eq` strona pokazywałaby cudzą naukę.
    supabase
      .from("v_my_courses")
      .select("course_id, course_slug, course_title, course_icon, course_target_lang, words_due")
      .eq("user_id", userId)
      .order("course_title"),
    supabase
      .from("v_my_weak_words")
      .select("concept_id, due_on, lapses, source_text, target_text")
      .eq("user_id", userId)
      .order("due_on"),
    supabase.from("v_my_stats").select("words_due, words_mastered, words_seen").eq("user_id", userId).maybeSingle(),
    // Dzień liczony w strefie dziecka, a nie serwera: o 23:30 w Warszawie serwer w UTC ma już
    // jutro i wszystkie dzisiejsze powtórki wyglądałyby na zaległe.
    supabase.rpc("learner_today", { p_user: userId }),
  ]);

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  // Bramka każdego kursu osobnym zapytaniem — kursów jest kilka, a regułę (ile zaległych
  // słówek zamyka lekcje) i tak liczy baza. Tak samo robi strona główna.
  const bramki = new Map(
    await Promise.all(
      (courses ?? []).map(async (course) => {
        const { data } = await supabase.rpc("review_gate", { p_course: course.course_id ?? "" });
        return [course.course_id, data as unknown as Bramka | null] as const;
      }),
    ),
  );

  const dzien = typeof dzis === "string" ? dzis : new Date().toISOString().slice(0, 10);
  const slowka = (words ?? []).map((row) => ({
    ...row,
    za: row.due_on ? dni(dzien, row.due_on) : 0,
  }));

  const zalegle = slowka.filter((row) => row.za < 0).length;
  const naDzis = slowka.filter((row) => row.za === 0).length;
  const wTygodniu = slowka.filter((row) => row.za > 0 && row.za <= 7).length;

  // Kursy, w których jest co robić TERAZ. `testOpen` liczy baza: test powtórkowy otwiera się
  // od kilku zaległych słówek, żeby nie wysyłać dziecka na test po jednym pominiętym słowie.
  const doZrobienia = (courses ?? []).filter((course) => {
    const bramka = bramki.get(course.course_id);
    return bramka?.testOpen === true && bramka.lessonId !== null;
  });

  return (
    <>
      <PageHeader
        title="Powtórki"
        intro={
          slowka.length > 0
            ? `${plural(slowka.length, WORDS)} w powtórkach, w tym ${zalegle + naDzis} na dziś.`
            : "Nie masz jeszcze żadnych słówek w powtórkach. Pojawią się po pierwszej lekcji."
        }
      />

      {/* 1. Co zrobić teraz. Na górze, bo po to się tu wchodzi — reszta strony jest do oglądania. */}
      <section className="flex flex-col gap-3">
        <h2 className="card-title">Do zrobienia</h2>
        {doZrobienia.length === 0 ? (
          <p className="msg-ok">
            {zalegle + naDzis > 0
              ? "Nic do zrobienia w testach — zaległe słówka wracają same w zwykłych lekcjach."
              : "Nic nie czeka. Wracaj jutro albo ucz się dalej."}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {doZrobienia.map((course) => {
              const bramka = bramki.get(course.course_id);
              if (!bramka?.lessonId) return null;

              return (
                <li key={course.course_id} className="card flex flex-wrap items-center gap-4 p-5">
                  <Flag code={course.course_target_lang ?? ""} fallback={course.course_icon} size={32} />
                  <span className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
                    <span className="card-title">{course.course_title}</span>
                    <span className="text-base text-zinc-600 dark:text-zinc-400">
                      {/* Stojąca bramka to co innego niż zaproszenie: tam lekcje są zamknięte,
                          tu test jest dobrowolny. Dziecko musi widzieć, które z dwojga. */}
                      {bramka.active
                        ? `${plural(bramka.due, WORDS)} czeka — lekcje otworzą się po teście.`
                        : `${plural(bramka.due, WORDS)} czeka na powtórzenie.`}
                    </span>
                  </span>
                  <Link
                    href={`/lekcja/${bramka.lessonId}`}
                    className={bramka.active ? "btn-primary" : "btn-secondary"}
                  >
                    {bramka.active ? "Zrób test powtórkowy" : "Powtórz teraz"}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 2. Liczby. Te same kafelki co na ekranie postępów — jeden wygląd w całej aplikacji. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon="⏰" value={zalegle} label="zaległych słówek" />
        <Tile icon="🔁" value={naDzis} label="na dziś" />
        <Tile icon="📅" value={wTygodniu} label="w tym tygodniu" />
        <Tile icon="🧠" value={stats?.words_mastered ?? 0} label="umianych słówek" />
      </div>

      {/* 3. Co konkretnie czeka. Bez tej listy „49 do powtórki" to dla dziecka sama liczba;
          tu widzi swoje słówka i to, że większość wróci dopiero za kilka dni. */}
      {slowka.length > 0 && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="card-title">Słówka w powtórkach</h2>
          <ul className="flex flex-col gap-1">
            {slowka.slice(0, 60).map((row) => (
              <li
                key={row.concept_id}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0"
                style={{ borderColor: "var(--line)" }}
              >
                <span className="min-w-0">
                  <strong>{row.target_text ?? "—"}</strong>
                  <span className="text-zinc-600 dark:text-zinc-400"> — {row.source_text ?? "—"}</span>
                </span>
                <span className="flex items-center gap-2">
                  {/* Potknięcia pokazujemy tylko tam, gdzie były: zero przy każdym słowie to
                      kolumna zer, a dziecko ma zobaczyć te kilka słówek, które mu nie wchodzą. */}
                  {(row.lapses ?? 0) > 0 && (
                    <span className="chip" title={`pomyłki: ${row.lapses}`}>
                      💪 {row.lapses}
                    </span>
                  )}
                  <span className="chip">{termin(row.za)}</span>
                </span>
              </li>
            ))}
          </ul>
          {slowka.length > 60 && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              …i jeszcze {slowka.length - 60}. Pokazujemy pierwsze sześćdziesiąt, czyli te
              z najbliższym terminem.
            </p>
          )}
        </section>
      )}
    </>
  );
}

export default function ReviewsPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Reviews />
      </Suspense>
    </Shell>
  );
}
