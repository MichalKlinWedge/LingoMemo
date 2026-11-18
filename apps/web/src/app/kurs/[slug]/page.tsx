import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LESSONS, plural, STARS, UNLOCKS, WORDS } from "@lingomemo/core";

import { CourseRequest } from "@/app/course-request";
import { Flag } from "@/components/flag";
import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireUser } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { UnlockLesson } from "./unlock-lesson";

async function CourseScreen({ params }: { params: PageProps<"/kurs/[slug]">["params"] }) {
  const { slug } = await params;
  const { supabase, userId, isAdmin } = await requireUser(`/kurs/${slug}`);

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, icon, target_lang")
    .eq("slug", slug)
    .maybeSingle();

  if (!course) notFound();

  // Bez zapisu kurs jest zamknięty w bazie (`is_lesson_unlocked`), więc ekran pokazałby same
  // kłódki i dziecko nie dowiedziałoby się, dlaczego. Zamiast niego — jedno zdanie i prośba.
  const [{ data: enrollment }, { data: asked }] = await Promise.all([
    supabase.from("enrollments").select("course_id").eq("user_id", userId).eq("course_id", course.id).maybeSingle(),
    supabase.rpc("my_course_requests"),
  ]);

  if (!enrollment) {
    return (
      <>
        <PageHeader
          crumbs={[CRUMB_HOME]}
          title={
            <>
              <Flag code={course.target_lang} fallback={course.icon ?? "📘"} size={32} /> {course.title}
            </>
          }
          intro="Tego kursu jeszcze nie masz."
        />
        <div className="card flex flex-wrap items-center gap-4 p-5">
          <span className="text-4xl" aria-hidden>
            🔒
          </span>
          <p className="min-w-0 flex-1 text-base text-zinc-600 dark:text-zinc-400">
            {course.description}
          </p>
          {isAdmin ? (
            <Link href={`/admin/kursy/${slug}`} className="chip">
              zapisz się w panelu
            </Link>
          ) : (
            <CourseRequest
              courseId={course.id}
              alreadyAsked={(asked ?? []).some((row) => row.course_id === course.id)}
            />
          )}
        </div>
      </>
    );
  }

  const [
    { data: units, error: unitsError },
    { data: lessons, error: lessonsError },
    { data: levels, error: levelsError },
    { data: stages, error: stagesError },
    { data: gate },
    { data: punktyRow },
  ] = await Promise.all([
    supabase.from("units").select("id, title, icon, sort_order").eq("course_id", course.id).order("sort_order"),
    // Widok dokłada do lekcji stan otwarcia i postęp tego ucznia — jedno zapytanie zamiast trzech.
    supabase.from("v_my_lessons").select("*").order("sort_order"),
    // Stan każdego poziomu każdej lekcji: kwadraciki średniego i trudnego pod kafelkiem.
    supabase.from("v_my_lesson_levels").select("*").order("level"),
    // Gwiazdki pojedynczych etapów — leżą w bazie od migracji z etapami, a pokazuje je dopiero
    // ten rząd kwadracików. Filtr po użytkowniku musi być tutaj, mimo RLS: uczeń widzi w tej
    // tabeli tylko swoje wiersze, ale administrator widzi wszystkie, więc bez filtru na jego
    // ekranie zmieszałyby się podejścia różnych dzieci.
    supabase.from("lesson_stage_progress").select("lesson_id, stage_nr, stars").eq("user_id", userId),
    // Bramka zaległych powtórek: przy dziesięciu zaległych słówkach kurs jest zamknięty do
    // zdanego testu powtórkowego. Regułę liczy baza — strona tylko nazywa to, co z niej wyszło.
    supabase.rpc("review_gate", { p_course: course.id }),
    // Punkty odblokowania: za jeden z nich dziecko otwiera kłódkę w dziale, w którym już jest.
    supabase.rpc("unlock_status", { p_user: userId }),
  ]);

  const bramka = gate as {
    active: boolean;
    due: number;
    limit: number;
    lessonId: string | null;
    passedToday: boolean;
    triedToday: boolean;
  } | null;

  const punkty = (punktyRow as { left?: number } | null)?.left ?? 0;

  // Błąd z zapytania o poziomy też musi być widoczny: po cichu znikają wtedy kwadraciki
  // średniego i trudnego, a strona wygląda na poprawną — tak właśnie wygląda brak migracji
  // w bazie, do której akurat celuje aplikacja. To samo dotyczy gwiazdek etapów.
  const error = unitsError ?? lessonsError ?? levelsError ?? stagesError;
  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;

  // Test powtórkowy dotyczy całego kursu, a nie działu, w którym technicznie wisi — więc nie
  // stoi między kafelkami działu, tylko osobno nad działami.
  const testPowtorkowy = bramka?.lessonId ?? null;
  const byUnit = (unitId: string) =>
    (lessons ?? []).filter((lesson) => lesson.unit_id === unitId && lesson.id !== testPowtorkowy);
  // Średni i trudny. Łatwy ma swój kafelek, a poziom bez ani jednego zadania nie ma po co
  // stawiać kwadracika, który po kliknięciu pokaże pustą lekcję.
  /**
   * Dokańd prowadzi kafelek lekcji. Dziecko klika w obrazek, żeby „robić tę lekcję dalej", a nie
   * żeby wybierać poziom — więc po zaliczeniu łatwego kafelek musi otwierać średni, potem trudny.
   * Kwadraciki zostają do wybierania poziomu wprost, także do powtarzania zrobionych.
   */
  /** Co otworzy kafelek — dla dymka, żeby dziecko nie zgadywało, na jaki poziom wchodzi. */
  const nextName = (lessonId: string, done: boolean) => {
    if (!done) return "Poziom łatwy";
    const next = harderOf(lessonId).find((row) => row.is_unlocked && row.status !== "completed");
    if (!next) return "Zrobione — możesz powtórzyć poziom łatwy";
    return next.level === 2 ? "Poziom średni" : "Poziom trudny";
  };

  const nextHref = (lessonId: string, done: boolean) => {
    const base = `/lekcja/${lessonId}`;
    if (!done) return base;
    const next = harderOf(lessonId).find((row) => row.is_unlocked && row.status !== "completed");
    return next ? `${base}?poziom=${next.level}` : base;
  };

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
  // Ukończone lekcje TEGO kursu: widok wydaje lekcje wszystkich kursów, a test powtórkowy
  // lekcją do ukończenia nie jest — zdany podnosiłby licznik przy każdym wejściu na ekran.
  const dzialyKursu = new Set((units ?? []).map((unit) => unit.id));
  const done = (lessons ?? []).filter(
    (lesson) =>
      lesson.status === "completed" &&
      lesson.id !== testPowtorkowy &&
      lesson.unit_id !== null &&
      dzialyKursu.has(lesson.unit_id),
  ).length;

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

      {/* Zamknięty kurs: jedno wejście, od razu na wierzchu. Kafelków lekcji nie ukrywamy —
          dziecko ma widzieć, co się otworzy, gdy zda test. */}
      {bramka?.active && bramka.lessonId && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="card-title">
            <span aria-hidden>🔁 </span>Test powtórkowy
          </h2>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            {bramka.triedToday
              ? `Ten test jeszcze nie jest zdany — spróbuj jeszcze raz. ${plural(bramka.due, WORDS)} czeka na powtórzenie.`
              : `Uzbierało się ${plural(bramka.due, WORDS)} do powtórzenia, więc lekcje chwilę poczekają. Przypomnij sobie te słówka, a potem uczysz się dalej.`}
          </p>
          <Link href={`/lekcja/${bramka.lessonId}`} className="btn-primary self-start">
            Zrób test powtórkowy
          </Link>
        </section>
      )}

      {/* Zaległe powtórki tego kursu, póki bramka jeszcze nie stoi. Pasek na górze sumuje
          wszystkie kursy, a blokada liczy każdy kurs osobno — stąd własny licznik. Wejście
          jest tu dobrowolne: dziecko z długą kolejką zbija ją od razu, zamiast czekać, aż
          jutro zamknie mu lekcje. Przy stojącej bramce tego nie pokazujemy — mówi to jej karta. */}
      {bramka && !bramka.active && bramka.due > 0 && bramka.lessonId && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="card-title">
            <span aria-hidden>🔁 </span>Powtórki
          </h2>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            {plural(bramka.due, WORDS)} czeka na powtórzenie. Przy {bramka.limit} lekcje poczekają,
            aż zrobisz test.
          </p>
          <Link href={`/lekcja/${bramka.lessonId}`} className="btn-secondary self-start">
            Powtórz teraz
          </Link>
        </section>
      )}

      {/* Stan konta punktów odblokowania. Bez tego dziecko nie wie, że kłódka z kluczykiem jest
          dla niego — punkt zdobyło kilka lekcji wcześniej, na poziomie trudnym. */}
      {punkty > 0 && (
        <p className="chip self-start">
          🔑 {plural(punkty, UNLOCKS)} — kliknij kłódkę z kluczykiem, żeby otworzyć lekcję
        </p>
      )}

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
              {bramka?.active
                ? "Ten dział otworzy się po zdanym teście powtórkowym."
                : "Ten dział otworzy się po zdanym teście poprzedniego działu."}
            </p>
          )}
          <ul className="flex flex-wrap gap-4">
            {byUnit(unit.id).map((lesson) => {
              const state = lesson.status === "completed" ? "done" : lesson.is_unlocked ? "available" : "locked";
              const label = `${lesson.title}${state === "locked" ? " — zamknięta" : ""}`;

              // Zamek bez powodu to dla dziecka ślepa ściana. Powody są cztery i każdy prowadzi
              // gdzie indziej: do testu powtórkowego, do poprzedniego działu, do reszty lekcji
              // w tym dziale albo do lekcji obok. Bramka powtórek zamyka cały kurs, więc stoi
              // przed pozostałymi powodami. Piąte wyjście — punkt odblokowania — dopisujemy
              // tylko tam, gdzie naprawdę jest do wzięcia (`is_unlockable` liczy to w bazie).
              const powod = bramka?.active
                ? "Najpierw zdaj test powtórkowy"
                : unitLocked
                  ? "Najpierw zdaj test poprzedniego działu"
                  : lesson.kind === "test"
                    ? "Najpierw skończ wszystkie lekcje działu"
                    : lesson.is_unlockable
                      ? "Najpierw skończ poprzednią lekcję albo zdobądź punkt odblokowania na poziomie trudnym"
                      : "Najpierw skończ poprzednią lekcję";

              // Etapy zostają na widoku także po zaliczeniu lekcji, wypełnione na kolor.
              // Znikające kwadraciki wyglądały jak usterka: rząd pod jedną lekcją był krótszy
              // od sąsiednich i kolumny przestawały się zgadzać. Zrobioną lekcję poznaje się
              // po zielonym kafelku i gwiazdkach, nie po braku kwadracików.
              // Zamknięta lekcja szarzeje w całości: kafelek sam w sobie zostawiał w kolorze
              // gwiazdki, liczbę słówek i kwadraciki etapów, więc przy stojącej bramce powtórek
              // (zamknięty cały kurs) ekran dalej wyglądał na otwarty. Kłódki do otwarcia
              // punktem to nie dotyczy — tam lekcja jest w zasięgu i szary by kłamał.
              const szara = state === "locked" && !(lesson.is_unlockable && punkty > 0);

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
              // kwadracika, bo nad każdym stoją trzy gwiazdki; stąd 12 rem, nie 9,5.
              return (
                <li key={lesson.id} className={`card lesson-box${szara ? " locked-gray" : ""}`}>
                  {state === "locked" ? (
                    // Kłódka do otwarcia punktem jest przyciskiem, a nie martwym kwadratem —
                    // ale tylko wtedy, gdy punkt jest. Bez punktu zostaje zwykły zamek, którego
                    // dymek mówi, skąd punkt wziąć; klikalna kłódka bez pokrycia obiecywałaby
                    // dziecku coś, czego baza i tak nie zrobi.
                    lesson.is_unlockable && punkty > 0 ? (
                      <UnlockLesson
                        lessonId={lesson.id}
                        slug={slug}
                        title={lesson.title}
                        label={label}
                        left={punkty}
                      />
                    ) : (
                      <div className="tile" data-state="locked" aria-label={label} title={powod}>
                        {tile}
                      </div>
                    )
                  ) : (
                    <Link
                      href={nextHref(lesson.id, state === "done")}
                      className="tile"
                      data-state={state}
                      aria-label={label}
                      title={nextName(lesson.id, state === "done")}
                    >
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
                        wejścia na średni i trudny. Kwadracik staje także przy JEDNYM etapie:
                        bez niego rząd zaczynał się od średniego i łatwego nie było widać wcale,
                        a krótka lekcja ma na łatwym jeden etap — czyli dotyczyło to każdego
                        kursu o kilkunastu słówkach w lekcji. */}
                    <span className="marks">
                      <Stages
                        lesson={lesson.id}
                        title={lesson.title}
                        locked={state === "locked"}
                        done={etapyZrobione}
                        total={etapy}
                        stars={starsOf(lesson.id)}
                      />
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
  row: { level: number | null; status: string | null; is_unlocked: boolean | null; stars: number | null };
}) {
  const level = row.level ?? 2;
  const name = LEVEL_NAME[level] ?? "trudniejszy";
  // Gwiazdki także przy wejściu zaczętym, a niezaliczonym: baza zapisuje je z każdego podejścia
  // (najlepsze z dotychczasowych), więc „dwie gwiazdki, a kwadracik zaczęty" to prawda o tym
  // wejściu, nie sprzeczność.
  const gwiazdki = row.stars ?? 0;
  // Trzy stany, nie dwa: zaczęte bez zaliczenia to kwadracik z kropką. Samo „puste albo pełne"
  // kazało myśleć, że przejście się nie zapisało, a różnica jest prawdziwa: zaliczenie wymaga
  // progu lekcji, nie samego dojścia do końca.
  //
  // Zrobione wymaga gwiazdki, nie samego statusu: wiersze sprzed migracji `…_level_chain.sql`
  // mogły dostać „completed" przy obniżonym progu lekcji i zerze gwiazdek. Zamalowany kwadracik
  // przy zamkniętym następnym poziomie byłby wtedy sprzecznością na jednym ekranie.
  const state =
    row.status === "completed" && gwiazdki >= 1
      ? "done"
      : row.status === "completed" || row.status === "in_progress"
        ? "tried"
        : "new";
  const done = state === "done";
  const label = `${title} — poziom ${name}`;

  if (!row.is_unlocked) {
    return (
      <span
        className="mark-col"
        role="img"
        aria-label={`${label} — zamknięty`}
        title={
          level === 2
            ? "Najpierw przejdź tę lekcję na poziomie łatwym"
            : "Najpierw zalicz poziom średni — potrzebna co najmniej jedna gwiazdka"
        }
      >
        <MarkStars count={0} />
        <span className="level-box" data-level={level} data-locked="true" aria-hidden />
      </span>
    );
  }

  const opis = done
    ? `${label} — zrobiony, ${plural(gwiazdki, STARS)}`
    : state === "tried"
      ? `${label} — zaczęty, jeszcze nie zaliczony, ${plural(gwiazdki, STARS)}`
      : label;

  return (
    <Link
      href={`/lekcja/${lesson}?poziom=${level}`}
      className="mark-col"
      aria-label={opis}
      title={state === "new" ? label : `${label} — ${plural(gwiazdki, STARS)}`}
    >
      <MarkStars count={gwiazdki} />
      <span className="level-box" data-level={level} data-state={state} aria-hidden />
    </Link>
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
 * Każdy etap jest odnośnikiem do siebie samego (`?etap=N`) — tak samo jak kwadraciki poziomów
 * obok. Po to właśnie są tu gwiazdki: dziecko widzi, który etap wypadł słabo, i ma go wejść
 * powtórzyć jednym kliknięciem, a nie przez lekcję od początku. Bazie kolejność etapów nie
 * przeszkadza (`start_lesson_session` pilnuje tylko zakresu 1..liczba etapów), a lekcję
 * i tak zamyka dopiero komplet zaliczonych etapów.
 *
 * Przy zamkniętej lekcji nie ma dokąd prowadzić, więc rząd jest wtedy jednym obrazkiem
 * z jednym podpisem — dziesięć „kwadrat, kwadrat, kwadrat" nie niesie żadnej informacji.
 * Odnośniki niosą swoje podpisy same, bo w `role="img"` czytnik ekranu nie zobaczyłby ich wcale.
 */
function Stages({
  lesson,
  title,
  locked,
  done,
  total,
  stars,
}: {
  lesson: string;
  title: string;
  locked: boolean;
  done: number;
  total: number;
  stars: Map<number, number>;
}) {
  // Zabezpieczenie przed danymi z przyszłości: gdyby lekcja skróciła się po tym, jak dziecko
  // zrobiło etapy, `done` byłoby większe niż `total` i pętla rysowałaby za mało kwadracików.
  const zrobione = Math.min(Math.max(done, 0), total);
  const numery = Array.from({ length: total }, (_, index) => index + 1);
  const gwiazdkiEtapu = (nr: number) => Math.min(Math.max(stars.get(nr) ?? 0, 0), 3);
  // Jeden etap to cała lekcja na łatwym, więc „Etap 1 z 1" niczego nie mówi — kwadracik nazywa
  // się wtedy poziomem, bo tym właśnie jest w rzędzie obok średniego i trudnego.
  const opisEtapu = (nr: number) =>
    total === 1
      ? `Poziom łatwy — ${plural(gwiazdkiEtapu(nr), STARS)}`
      : `Etap ${nr} z ${total} — ${plural(gwiazdkiEtapu(nr), STARS)}`;

  if (locked) {
    return (
      <span
        className="stages"
        role="img"
        aria-label={
          total === 1
            ? opisEtapu(1)
            : `Zrobione etapy: ${zrobione} z ${total}; ${numery
                .map((nr) => `etap ${nr} — ${plural(gwiazdkiEtapu(nr), STARS)}`)
                .join(", ")}`
        }
      >
        {numery.map((nr) => (
          <span key={nr} className="mark-col">
            <MarkStars count={gwiazdkiEtapu(nr)} />
            <span className="stage" data-done={nr <= zrobione} aria-hidden />
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className="stages">
      {numery.map((nr) => (
        <Link
          key={nr}
          href={`/lekcja/${lesson}?etap=${nr}`}
          className="mark-col"
          title={opisEtapu(nr)}
          aria-label={`${title} — ${opisEtapu(nr)}`}
        >
          <MarkStars count={gwiazdkiEtapu(nr)} />
          <span className="stage" data-done={nr <= zrobione} aria-hidden />
        </Link>
      ))}
    </span>
  );
}

/** Gwiazdki nad kwadracikiem — etapu albo poziomu. Zawsze `aria-hidden`: podpis dla czytnika
 *  ekranu siedzi na tym, co je obejmuje (odnośniku albo całym rzędzie). */
function MarkStars({ count }: { count: number }) {
  return (
    <span className="mark-stars" aria-hidden>
      {Array.from({ length: Math.min(Math.max(count, 0), 3) }, (_, index) => (
        <span key={index} className="mark-star">
          ★
        </span>
      ))}
    </span>
  );
}

export default function CoursePage({ params }: PageProps<"/kurs/[slug]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <CourseScreen params={params} />
      </Suspense>
    </Shell>
  );
}
