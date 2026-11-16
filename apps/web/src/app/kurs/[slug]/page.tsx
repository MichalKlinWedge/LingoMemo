import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LESSONS, plural, STARS, WORDS } from "@lingomemo/core";

import { Flag } from "@/components/flag";
import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

async function CourseMap({ params }: { params: PageProps<"/kurs/[slug]">["params"] }) {
  const { slug } = await params;
  const { supabase, userId } = await requireUser(`/kurs/${slug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, icon, target_lang")
    .eq("slug", slug)
    .maybeSingle();

  if (!course) notFound();

  const [
    { data: units, error: unitsError },
    { data: lessons, error: lessonsError },
    { data: levels, error: levelsError },
    { data: stages, error: stagesError },
  ] = await Promise.all([
    supabase.from("units").select("id, title, icon, sort_order").eq("course_id", course.id).order("sort_order"),
    // Widok dokłada do lekcji stan otwarcia i postęp tego ucznia — jedno zapytanie zamiast trzech.
    supabase.from("v_my_lessons").select("*").order("sort_order"),
    // Stan każdego poziomu każdej lekcji: kwadraciki średniego i trudnego pod kafelkiem.
    supabase.from("v_my_lesson_levels").select("*").order("level"),
    // Gwiazdki pojedynczych etapów — leżą w bazie od migracji z etapami, a pokazuje je dopiero
    // ten rząd kwadracików. Filtr po użytkowniku musi być tutaj, mimo RLS: uczeń widzi w tej
    // tabeli tylko swoje wiersze, ale administrator widzi wszystkie, więc bez filtru na jego
    // mapie zmieszałyby się podejścia różnych dzieci.
    supabase.from("lesson_stage_progress").select("lesson_id, stage_nr, stars").eq("user_id", userId),
  ]);

  // Błąd z zapytania o poziomy też musi być widoczny: po cichu znikają wtedy kwadraciki
  // średniego i trudnego, a strona wygląda na poprawną — tak właśnie wygląda brak migracji
  // w bazie, do której akurat celuje aplikacja. To samo dotyczy gwiazdek etapów.
  const error = unitsError ?? lessonsError ?? levelsError ?? stagesError;
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  const byUnit = (unitId: string) => (lessons ?? []).filter((lesson) => lesson.unit_id === unitId);
  // Średni i trudny. Łatwy ma swój kafelek, a poziom bez ani jednego zadania nie ma po co
  // stawiać kwadracika, który po kliknięciu pokaże pustą lekcję.
  const harderOf = (lessonId: string) =>
    (levels ?? []).filter(
      (row) => row.lesson_id === lessonId && (row.level ?? 1) > 1 && (row.exercise_count ?? 0) > 0,
    );
  // Gwiazdki etapów jednej lekcji, numer etapu -> liczba gwiazdek.
  const starsOf = (lessonId: string) =>
    new Map(
      (stages ?? [])
        .filter((row) => row.lesson_id === lessonId)
        .map((row) => [row.stage_nr, row.stars ?? 0] as const),
    );
  const done = (lessons ?? []).filter((lesson) => lesson.status === "completed").length;

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME]}
        title={
          <>
            <Flag code={course.target_lang} fallback={course.icon} size={36} /> {course.title}
          </>
        }
        intro={`Ukończone: ${plural(done, LESSONS)}`}
      />

      {(units ?? []).map((unit) => {
        // Dział zamknięty w całości, czyli czekający na test poprzedniego działu. Poznajemy
        // go po tym, że ani jedna jego lekcja nie jest otwarta — reguła siedzi w bazie
        // (`is_unit_unlocked`), a strona tylko nazywa to, co z niej wyszło.
        const unitLocked =
          byUnit(unit.id).length > 0 && byUnit(unit.id).every((lesson) => !lesson.is_unlocked);

        return (
        <section key={unit.id} className="flex flex-col gap-4">
          <h2>
            {/* Dział bez ikony nie dostaje nic — szablon z `${unit.icon}` wypisywał „null”. */}
            <span aria-hidden>{unitLocked ? "🔒 " : unit.icon ? `${unit.icon} ` : ""}</span>
            {unit.title}
          </h2>
          {unitLocked && (
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Ten dział otworzy się po zdanym teście poprzedniego działu.
            </p>
          )}
          <ul className="flex flex-wrap gap-4">
            {byUnit(unit.id).map((lesson) => {
              const state = lesson.status === "completed" ? "done" : lesson.is_unlocked ? "available" : "locked";
              const label = `${lesson.title}${state === "locked" ? " — zamknięta" : ""}`;

              // Etapy zostają na widoku także po zaliczeniu lekcji, wypełnione na kolor.
              // Znikające kwadraciki wyglądały jak usterka: rząd pod jedną lekcją był krótszy
              // od sąsiednich i kolumny przestawały się zgadzać. Zrobioną lekcję poznaje się
              // po zielonym kafelku i gwiazdkach, nie po braku kwadracików.
              const etapy = lesson.stage_count ?? 1;
              // Zaliczona lekcja ma z definicji wszystkie etapy za sobą — nie opieramy się tu
              // na liczniku, bo ten liczy postępy bieżącego podejścia.
              const etapyZrobione = state === "done" ? etapy : (lesson.stages_done ?? 0);

              const tile = (
                <>
                  <span aria-hidden>{state === "locked" ? "🔒" : (lesson.icon ?? "📘")}</span>
                  {state === "done" && (
                    <span className="text-base" aria-hidden>
                      {"⭐".repeat(lesson.stars ?? 0)}
                    </span>
                  )}
                </>
              );

              // Kolumna szersza niż kafelek (6 rem): na dole stoi rząd kwadracików — do trzech
              // etapów i dwa poziomy — a `.marks` się nie zawija, więc przy 7 rem wychodziły
              // poza kafelek i wchodziły sąsiadowi w gap. Etap jest szerszy od swojego
              // kwadracika, bo nad nim stoją trzy gwiazdki; stąd 11,5 rem, nie 9,5.
              return (
                <li key={lesson.id} className="card lesson-box">
                  {state === "locked" ? (
                    <div
                      className="tile"
                      data-state="locked"
                      aria-label={label}
                      // Zamek bez powodu to dla dziecka ślepa ściana. Powody są trzy i każdy
                      // prowadzi gdzie indziej: do poprzedniego działu, do reszty lekcji
                      // w tym dziale albo do lekcji obok.
                      title={
                        unitLocked
                          ? "Najpierw zdaj test poprzedniego działu"
                          : lesson.kind === "test"
                            ? "Najpierw skończ wszystkie lekcje działu"
                            : "Najpierw skończ poprzednią lekcję"
                      }
                    >
                      {tile}
                    </div>
                  ) : (
                    <Link href={`/lekcja/${lesson.id}`} className="tile" data-state={state} aria-label={label}>
                      {tile}
                    </Link>
                  )}
                  <span className="text-base leading-tight">{lesson.title}</span>
                  {/* Wszystko pod tytułem jedzie w jednym bloku przyklejonym do dołu kolumny
                      (`mt-auto`): tytuły mają różną liczbę wierszy, więc osobno liczba słówek
                      i sowa stały w każdej kolumnie na innej wysokości. */}
                  <span className="mt-auto flex flex-col items-center gap-2">
                    {/* Liczba słówek i sowa w jednym rzędzie. Sama liczba bez słowa „słówek":
                        pod kilkunastoma lekcjami to samo słowo jest szumem. Znaczenie zostaje
                        w `aria-label`, bo z samej cyfry czytnik ekranu niczego nie wyczyta.
                        Powtórka obejmuje wszystkie przerobione słówka działu, zaległe na
                        początku — więc liczba jest taka sama jak przy zwykłej lekcji. */}
                    <span className="lesson-meta">
                      <span className="word-count" aria-label={plural(lesson.word_count ?? 0, WORDS)}>
                        {lesson.word_count ?? 0}
                      </span>
                      {/* Sowa prowadzi na planszę ze słówkami lekcji: dziecko najpierw ich słucha,
                          potem wchodzi w lekcję. Przy zamkniętej lekcji sowy nie ma, bo polityki
                          bazy i tak nie wydadzą jej słówek, a przy powtórce — bo powtórka nie ma
                          własnych słówek, składa się z przerobionych. Miejsce po niej zostaje
                          puste, żeby rzędy zgadzały się w całym dziale. */}
                      <span className="owl-slot">
                        {state !== "locked" && lesson.kind !== "review" && (lesson.word_count ?? 0) > 0 && (
                          <Link
                            href={`/lekcja/${lesson.id}/nauka`}
                            className="owl"
                            aria-label={`${lesson.title} — posłuchaj słówek`}
                            title="Posłuchaj słówek"
                          >
                            <span aria-hidden>🦉</span>
                          </Link>
                        )}
                      </span>
                    </span>
                    {/* Jedna linia kwadracików na samym dole kafelka: etapy poziomu łatwego oraz
                        wejścia na średni i trudny. */}
                    <span className="marks">
                      {etapy > 1 && (
                        <Stages done={etapyZrobione} total={etapy} stars={starsOf(lesson.id)} />
                      )}
                      {harderOf(lesson.id).map((row) => (
                        <LevelBox key={row.level} lesson={lesson.id} title={lesson.title} row={row} />
                      ))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        );
      })}
    </>
  );
}

/** Nazwa poziomu dla czytnika ekranu i dymka. Łatwy ma kafelek, więc tu go nie ma. */
const LEVEL_NAME: Record<number, string> = { 2: "średni", 3: "trudny" };

/**
 * Kwadracik trudniejszego wejścia w lekcję. Kolor mówi, który to poziom, wypełnienie — że jest
 * przeszednięty, kłódka w dymku — że najpierw trzeba zrobić lekcję na łatwym.
 */
function LevelBox({
  lesson,
  title,
  row,
}: {
  lesson: string;
  title: string;
  row: { level: number | null; status: string | null; is_unlocked: boolean | null };
}) {
  const level = row.level ?? 2;
  const name = LEVEL_NAME[level] ?? "trudniejszy";
  // Trzy stany, nie dwa: zaczęte bez zaliczenia to pół kwadracika. Samo „puste albo pełne"
  // kazało myśleć, że przejście się nie zapisało, a różnica jest prawdziwa: zaliczenie wymaga
  // progu lekcji, nie samego dojścia do końca.
  const state = row.status === "completed" ? "done" : row.status === "in_progress" ? "tried" : "new";
  const done = state === "done";
  const label = `${title} — poziom ${name}`;

  if (!row.is_unlocked) {
    return (
      <span
        className="level-box"
        data-level={level}
        data-locked="true"
        role="img"
        aria-label={`${label} — zamknięty`}
        title="Najpierw przejdź tę lekcję na poziomie łatwym"
      />
    );
  }

  return (
    <Link
      href={`/lekcja/${lesson}?poziom=${level}`}
      className="level-box"
      data-level={level}
      data-state={state}
      aria-label={done ? `${label} — zrobiony` : state === "tried" ? `${label} — zaczęty` : label}
      title={state === "tried" ? `${label} — jeszcze nie zaliczony` : label}
    />
  );
}

/**
 * Postęp w etapach lekcji: jeden kwadracik na etap, zrobione wypełnione, a nad każdym
 * gwiazdki zdobyte właśnie w tym etapie.
 *
 * Gwiazdki etapu i gwiazdka przy kafelku mówią co innego i dlatego są obie: kafelek pokazuje
 * ocenę całej lekcji (średnia z najlepszych wyników wszystkich etapów, zapisana po zamknięciu
 * ostatniego), a te nad kwadracikami — który etap wypadł słabo i opłaca się go powtórzyć.
 * Bez nich dziecko widziało dwie gwiazdki przy lekcji i nie miało z czego wyczytać, gdzie
 * zgubiło trzecią.
 *
 * Dla czytnika ekranu to jeden obrazek z jednym podpisem, a nie seria pustych elementów —
 * dziesięć „kwadrat, kwadrat, kwadrat" nie niesie żadnej informacji. Dymek nad każdym etapem
 * powtarza to samo dla kogoś, kto patrzy na drobne gwiazdki i chce mieć pewność, ile ich jest.
 */
function Stages({ done, total, stars }: { done: number; total: number; stars: Map<number, number> }) {
  // Zabezpieczenie przed danymi z przyszłości: gdyby lekcja skróciła się po tym, jak dziecko
  // zrobiło etapy, `done` byłoby większe niż `total` i pętla rysowałaby za mało kwadracików.
  const zrobione = Math.min(Math.max(done, 0), total);
  const numery = Array.from({ length: total }, (_, index) => index + 1);
  const gwiazdkiEtapu = (nr: number) => Math.min(Math.max(stars.get(nr) ?? 0, 0), 3);
  const opis = numery.map((nr) => `etap ${nr} — ${plural(gwiazdkiEtapu(nr), STARS)}`).join(", ");

  return (
    <span
      className="flex gap-1"
      role="img"
      aria-label={`Zrobione etapy: ${zrobione} z ${total}; ${opis}`}
    >
      {numery.map((nr) => (
        <span key={nr} className="stage-col" title={`Etap ${nr} — ${plural(gwiazdkiEtapu(nr), STARS)}`}>
          <span className="stage-stars" aria-hidden>
            {Array.from({ length: gwiazdkiEtapu(nr) }, (_, index) => (
              <span key={index} className="stage-star">
                ★
              </span>
            ))}
          </span>
          <span className="stage" data-done={nr <= zrobione} aria-hidden />
        </span>
      ))}
    </span>
  );
}

export default function CoursePage({ params }: PageProps<"/kurs/[slug]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <CourseMap params={params} />
      </Suspense>
    </Shell>
  );
}
