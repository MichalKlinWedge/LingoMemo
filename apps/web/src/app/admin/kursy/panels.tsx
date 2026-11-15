"use client";

import Link from "next/link";
import { Fragment, useActionState, useState } from "react";

import {
  addWordAction,
  createCourseAction,
  createLessonAction,
  createUnitAction,
  deleteCourseAction,
  deleteLessonAction,
  deleteUnitAction,
  removeWordAction,
  setEnrollmentAction,
  updateCourseAction,
  updateLessonAction,
  updateUnitAction,
  updateWordAction,
} from "@/app/admin/kursy/actions";
import { Flag } from "@/components/flag";
import { Field, Form, Status, SubmitButton, TitleAndSlug, type FormState } from "@/components/forms";

/** Pole wyboru „opublikowane". Treść nieopublikowana jest widoczna tylko dla administratora. */
function Published({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-3">
      <input type="checkbox" name="is_published" defaultChecked={defaultChecked} className="h-6 w-6" />
      <span className="font-semibold">Widoczne dla dzieci</span>
    </label>
  );
}

/**
 * Formularz edycji jako zwykła sekcja, nie rozwijanka. Schowany pod strzałką ginął — wyglądał
 * na podpis listy, a nie na miejsce, w którym zmienia się dane.
 */
/**
 * Formularz edycji pod przyciskiem. Nagłówek „Dane działu" wyglądał jak zwykły tytuł sekcji —
 * nie było po nim widać, że to miejsce, w którym się coś zmienia. Teraz jest przycisk z czasownikiem
 * i ołówkiem, a po kliknięciu rozwija się formularz.
 */
function Editor({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="card p-6">
      <summary className="btn-secondary w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden>✏️</span> {summary}
      </summary>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </details>
  );
}

/**
 * Samo kasowanie, bez obudowy. Osobno od `Danger`, bo w tabeli kursów rozwijaniem jest już
 * przycisk w wierszu i druga rozwijanka w środku byłaby rozwijanką w rozwijance.
 */
function DangerForm({
  action,
  warning,
  slug,
  hidden,
  label,
  className = "mt-4 flex flex-col gap-4",
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  warning: string;
  slug: string;
  hidden: Record<string, string>;
  label: string;
  className?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <Form action={formAction} state={state} className={className}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="msg-error">{warning}</p>
      <Field label={`Przepisz „${slug}", żeby potwierdzić`} name="confirm" autoComplete="off" placeholder={slug} />
      <Status state={state} />
      <SubmitButton variant="danger" pendingLabel="Usuwam…">
        {label}
      </SubmitButton>
    </Form>
  );
}

/**
 * Kasowanie. Zostaje pod rozwijaniem i z osobnym potwierdzeniem: tego jednego w całym panelu
 * nie da się cofnąć, a przepisanie nazwy z adresu wymaga spojrzenia na to, co znika.
 */
function Danger({
  action,
  heading,
  warning,
  slug,
  hidden,
  label,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  heading: string;
  warning: string;
  slug: string;
  hidden: Record<string, string>;
  label: string;
}) {
  return (
    <details className="card p-6">
      {/* Tak samo jak w `Editor`: po samym nagłówku nie widać, że to coś robi. */}
      <summary className="btn-danger w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden>🗑️</span> {heading}
      </summary>
      <DangerForm action={action} warning={warning} slug={slug} hidden={hidden} label={label} />
    </details>
  );
}

/**
 * Języki kursu. Zmienić je można tylko w kursie bez słówek: `terms` wiszą na kodzie języka,
 * a treść zadań jest kopią słowa, więc w kursie z materiałem podmiana zostawiłaby słówka
 * w starym języku. W takim kursie pokazujemy je więc jako tekst i wysyłamy bez zmian.
 */
function Languages({
  languages,
  source,
  target,
  editable,
}: {
  languages: { code: string; name_pl: string }[];
  source: string;
  target: string;
  editable: boolean;
}) {
  const nameOf = (code: string) => languages.find((lang) => lang.code === code)?.name_pl ?? code;

  if (!editable) {
    return (
      <div className="flex flex-col gap-2">
        <input type="hidden" name="source_lang" value={source} />
        <input type="hidden" name="target_lang" value={target} />
        <span className="font-semibold">Języki</span>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          {nameOf(source)} → {nameOf(target)}. Kurs ma już słówka, więc języków nie da się zmienić — zmiana
          zostawiłaby je w starym języku. Na inną parę języków zakłada się osobny kurs.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Język dziecka</span>
        <select name="source_lang" className="field" defaultValue={source}>
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name_pl}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Język uczony</span>
        <select name="target_lang" className="field" defaultValue={target}>
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name_pl}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

type Lang = { code: string; name_pl: string };

/** Ile w kursie jest zawartości. Rozstrzyga, czy wolno zmienić języki i co zniknie przy kasowaniu. */
export type CourseCounts = { units: number; lessons: number; words: number; students: number };

export type CourseRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  source_lang: string;
  target_lang: string;
  sort_order: number;
  is_published: boolean;
  counts: CourseCounts;
};

/**
 * Pola kursu — te same w dodawaniu i w poprawianiu. Wspólny komponent, bo dwa osobne formularze
 * zaczynają się rozjeżdżać przy pierwszej dołożonej kolumnie: w jednym pole jest, w drugim nie,
 * i zapis z tego drugiego po cichu nadpisuje wartość pustą.
 */
function CourseFields({ languages, course }: { languages: Lang[]; course?: CourseRow }) {
  return (
    <>
      <TitleAndSlug
        titlePlaceholder="Angielski od zera"
        slugPlaceholder="pl-en-starter"
        defaultTitle={course?.title ?? ""}
        defaultSlug={course?.slug ?? ""}
        // Nowy kurs dostaje adres z nazwy i nikt go nie ogląda. Poprawiać da się go na stronie kursu.
        slugHidden={course === undefined}
      />
      <Field
        label="Opis"
        name="description"
        required={false}
        placeholder="Pierwsze słówka i zwroty."
        defaultValue={course?.description ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ikona" name="icon" required={false} placeholder="🇬🇧" defaultValue={course?.icon ?? ""} />
        <Field
          label="Kolejność"
          name="sort_order"
          type="number"
          min="0"
          defaultValue={String(course?.sort_order ?? 0)}
        />
      </div>
      <Languages
        languages={languages}
        source={course?.source_lang ?? "pl"}
        target={course?.target_lang ?? "en"}
        // Nowy kurs nie ma jeszcze słówek, więc języki są do wyboru.
        editable={(course?.counts.words ?? 0) === 0}
      />
      <Published defaultChecked={course?.is_published ?? true} />
    </>
  );
}

function NewCourse({ languages }: { languages: Lang[] }) {
  const [state, action] = useActionState<FormState, FormData>(createCourseAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h3 className="card-title">Nowy kurs</h3>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <CourseFields languages={languages} />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj kurs</SubmitButton>
      </Form>
    </section>
  );
}

/**
 * Poprawianie kursu bez opuszczania listy. Nie podajemy `current_slug` — to on włącza w akcji
 * przerzucenie na stronę kursu po zmianie sluga, a tutaj adres strony się nie zmienia i wyrzucenie
 * z listy w środku poprawiania byłoby zaskoczeniem.
 */
function CourseEditor({ course, languages }: { course: CourseRow; languages: Lang[] }) {
  const [state, action] = useActionState<FormState, FormData>(updateCourseAction, {});

  return (
    <Form action={action} state={state} className="flex flex-col gap-4 py-4">
      <input type="hidden" name="id" value={course.id} />
      <CourseFields languages={languages} course={course} />
      <Status state={state} />
      <SubmitButton pendingLabel="Zapisuję…">Zapisz kurs</SubmitButton>
    </Form>
  );
}

/** Co zniknie razem z kursem. To samo zdanie na liście i na stronie kursu. */
function deleteWarning(counts: CourseCounts): string {
  return (
    `Znikną: działy (${counts.units}), lekcje (${counts.lessons}), słówka (${counts.words}) ` +
    `oraz postępy i powtórki dzieci zapisanych na kurs (${counts.students}). Tego się nie cofnie. ` +
    `Jeśli chodzi tylko o to, żeby dzieci tego nie widziały, odznacz „Widoczne dla dzieci".`
  );
}

/**
 * Kursy jako tabela.
 *
 * Wcześniej każdy kurs był kartą na całą szerokość, a pod listą stał na stałe rozłożony formularz
 * „Nowy kurs" — przy czterech kursach formularz zajmował więcej miejsca niż one wszystkie razem
 * i to on przyciągał wzrok. Teraz formularz wychodzi spod przycisku, a kursy są wierszami:
 * widać naraz wszystkie, ich języki i ile mają zawartości.
 *
 * Poprawianie i kasowanie dzieje się tutaj, w wierszu — na stronę kursu wchodzi się po działy
 * i po zapisane dzieci, a nie po to, żeby zmienić nazwę. Otwarty jest najwyżej jeden wiersz:
 * każdy formularz ma wartości wzięte przy wejściu na stronę, więc kilka naraz kusi, żeby wpisać
 * coś w dwóch, a zapisać jeden.
 */
export function CourseTable({ courses, languages }: { courses: CourseRow[]; languages: Lang[] }) {
  const [nowy, setNowy] = useState(false);
  const [otwarte, setOtwarte] = useState<{ id: string; co: "edycja" | "usuwanie" } | null>(null);

  const nameOf = (code: string) => languages.find((lang) => lang.code === code)?.name_pl ?? code;
  const przelacz = (id: string, co: "edycja" | "usuwanie") =>
    setOtwarte(otwarte?.id === id && otwarte.co === co ? null : { id, co });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">Kursy</h2>
        <button type="button" className="btn-secondary px-5" aria-expanded={nowy} onClick={() => setNowy(!nowy)}>
          {nowy ? (
            "Zwiń"
          ) : (
            <>
              <span aria-hidden>➕</span> Dodaj kurs
            </>
          )}
        </button>
      </div>

      {nowy && <NewCourse languages={languages} />}

      {courses.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Jeszcze żadnego kursu. Zacznij od przycisku „Dodaj kurs”.
        </p>
      ) : (
        <div className="card px-3 py-2">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kurs</th>
                <th>Języki</th>
                <th className="hidden text-right sm:table-cell">Lekcje</th>
                <th className="hidden text-right sm:table-cell">Słówka</th>
                <th className="hidden sm:table-cell">Widoczny</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => {
                const edycja = otwarte?.id === course.id && otwarte.co === "edycja";
                const usuwanie = otwarte?.id === course.id && otwarte.co === "usuwanie";
                return (
                  <Fragment key={course.id}>
                    <tr>
                      {/* `wrap-anywhere`: w wąskim oknie długa nazwa łamie się zamiast rozpychać
                          tabelę poza kartę — kolumna z nazwą jest tą, która ma ustąpić. */}
                      <td className="wrap-anywhere">
                        <Link href={`/admin/kursy/${course.slug}`} className="block font-semibold">
                          {course.title}
                        </Link>
                        {/* Na telefonie nie ma kolumny „Widoczny", a to jedyny stan wart zauważenia. */}
                        {!course.is_published && <span className="chip mt-1 sm:hidden">ukryty</span>}
                      </td>
                      <td>
                        <span
                          className="flex items-center gap-2"
                          title={`${nameOf(course.source_lang)} → ${nameOf(course.target_lang)}`}
                        >
                          <Flag code={course.source_lang} size={24} />
                          <span aria-hidden>→</span>
                          <Flag code={course.target_lang} fallback={course.icon} size={24} />
                          {/* Flagi to obrazki bez tekstu — czytnik ekranu dostaje nazwy języków. */}
                          <span className="sr-only">
                            {nameOf(course.source_lang)} → {nameOf(course.target_lang)}
                          </span>
                        </span>
                      </td>
                      <td className="hidden text-right tabular-nums sm:table-cell">{course.counts.lessons}</td>
                      <td className="hidden text-right tabular-nums sm:table-cell">{course.counts.words}</td>
                      <td className="hidden sm:table-cell">
                        <span className="chip">{course.is_published ? "widoczny" : "ukryty"}</span>
                      </td>
                      <td className="text-right">
                        {/* Same ikony: nazwy akcji przy ośmiu kolumnach rozpychały tabelę poza kartę,
                            a wtedy połowa przycisku „Usuń" była za krawędzią. */}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="btn-row"
                            aria-expanded={edycja}
                            aria-label={edycja ? "Zwiń edycję kursu" : "Edytuj kurs"}
                            title={edycja ? "Zwiń" : "Edytuj"}
                            onClick={() => przelacz(course.id, "edycja")}
                          >
                            <span aria-hidden>{edycja ? "✖️" : "✏️"}</span>
                          </button>
                          <button
                            type="button"
                            className="btn-row"
                            aria-expanded={usuwanie}
                            aria-label={usuwanie ? "Zwiń usuwanie kursu" : "Usuń kurs"}
                            title={usuwanie ? "Zwiń" : "Usuń"}
                            onClick={() => przelacz(course.id, "usuwanie")}
                          >
                            <span aria-hidden>{usuwanie ? "✖️" : "🗑️"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {(edycja || usuwanie) && (
                      <tr>
                        <td colSpan={6}>
                          {edycja ? (
                            <CourseEditor course={course} languages={languages} />
                          ) : (
                            <DangerForm
                              action={deleteCourseAction}
                              slug={course.slug}
                              hidden={{ id: course.id, current_slug: course.slug }}
                              warning={deleteWarning(course.counts)}
                              label="Usuń kurs z całą zawartością"
                              className="flex flex-col gap-4 py-4"
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CourseSettings({
  course,
  languages,
  counts,
}: {
  course: Omit<CourseRow, "counts">;
  languages: Lang[];
  counts: CourseCounts;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateCourseAction, {});

  return (
    <>
      <Editor summary="Edytuj kurs">
        <Form action={action} state={state} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={course.id} />
          {/* Po czym poznać, że slug się zmienił — akcja przerzuca wtedy na nowy adres. */}
          <input type="hidden" name="current_slug" value={course.slug} />
          <CourseFields languages={languages} course={{ ...course, counts }} />
          <Status state={state} />
          <SubmitButton pendingLabel="Zapisuję…">Zapisz kurs</SubmitButton>
        </Form>
      </Editor>

      <Danger
        action={deleteCourseAction}
        heading="Usuń kurs"
        slug={course.slug}
        hidden={{ id: course.id, current_slug: course.slug }}
        warning={deleteWarning(counts)}
        label="Usuń kurs z całą zawartością"
      />
    </>
  );
}

export function NewUnit({ courseId, nextOrder }: { courseId: string; nextOrder: number }) {
  const [state, action] = useActionState<FormState, FormData>(createUnitAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowy dział</h2>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="course_id" value={courseId} />
        <TitleAndSlug titlePlaceholder="Jedzenie" slugPlaceholder="jedzenie" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ikona" name="icon" required={false} placeholder="🍎" />
          <Field label="Kolor" name="color" required={false} placeholder="#f97316" />
          <Field label="Kolejność" name="sort_order" type="number" min="0" defaultValue={String(nextOrder)} />
        </div>
        <Published defaultChecked />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj dział</SubmitButton>
      </Form>
    </section>
  );
}

export function UnitSettings({
  unit,
  courseSlug,
  lessons,
}: {
  unit: {
    id: string;
    slug: string;
    title: string;
    icon: string | null;
    color: string | null;
    sort_order: number;
    is_published: boolean;
  };
  courseSlug: string;
  lessons: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateUnitAction, {});

  return (
    <>
      <Editor summary="Edytuj dział">
        <Form action={action} state={state} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={unit.id} />
          <input type="hidden" name="current_slug" value={unit.slug} />
          <input type="hidden" name="course_slug" value={courseSlug} />
          <TitleAndSlug defaultTitle={unit.title} defaultSlug={unit.slug} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Ikona" name="icon" required={false} defaultValue={unit.icon ?? ""} />
            <Field label="Kolor" name="color" required={false} defaultValue={unit.color ?? ""} />
            <Field label="Kolejność" name="sort_order" type="number" min="0" defaultValue={String(unit.sort_order)} />
          </div>
          <Published defaultChecked={unit.is_published} />
          <Status state={state} />
          <SubmitButton pendingLabel="Zapisuję…">Zapisz dział</SubmitButton>
        </Form>
      </Editor>

      <Danger
        action={deleteUnitAction}
        heading="Usuń dział"
        slug={unit.slug}
        hidden={{ id: unit.id, current_slug: unit.slug, course_slug: courseSlug }}
        warning={
          `Znikną lekcje działu (${lessons}) razem z ich zadaniami i postępami dzieci. ` +
          `Słówka zostają przy kursie — wisi na nich stan powtórek, więc dziecko ich nie traci. ` +
          `Tego się nie cofnie; żeby tylko schować dział, odznacz „Widoczne dla dzieci".`
        }
        label="Usuń dział z lekcjami"
      />
    </>
  );
}

/**
 * Lekcja do wyboru jako warunek wstępny. `unit` jest tu dlatego, że warunek wolno postawić na
 * lekcji z dowolnego działu kursu — import tak robi (zapis „dzial/lekcja"). Gdy lista zawierała
 * tylko lekcje tego samego działu, warunek z innego działu nie miał swojej opcji, pole pokazywało
 * „od razu dostępna", a zapis formularza po cichu kasował warunek.
 */
type LessonOption = { id: string; title: string; unit: string };

/** Wspólne pola lekcji dla dodawania i edycji — żeby nie rozjechały się między formularzami. */
function LessonFields({
  lesson,
  others,
}: {
  lesson?: { title: string; icon: string | null; kind: string; sort_order: number; xp_reward: number; pass_threshold: number; prerequisite_lesson_id: string | null; is_published: boolean };
  others: LessonOption[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Ikona" name="icon" required={false} defaultValue={lesson?.icon ?? ""} placeholder="🍏" />
        <Field label="Kolejność" name="sort_order" type="number" min="0" defaultValue={String(lesson?.sort_order ?? 1)} />
        <Field label="Punkty za ukończenie" name="xp_reward" type="number" min="0" step="5" defaultValue={String(lesson?.xp_reward ?? 50)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Rodzaj</span>
          <select name="kind" className="field" defaultValue={lesson?.kind ?? "standard"}>
            <option value="standard">zwykła</option>
            <option value="review">powtórka działu</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-semibold">Otwiera się po lekcji</span>
          <select name="prerequisite_lesson_id" className="field" defaultValue={lesson?.prerequisite_lesson_id ?? ""}>
            <option value="">od razu dostępna</option>
            {[...new Set(others.map((item) => item.unit))].map((unitTitle) => (
              <optgroup key={unitTitle} label={unitTitle}>
                {others
                  .filter((item) => item.unit === unitTitle)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      <Field
        label="Próg zaliczenia (0–1)"
        name="pass_threshold"
        type="number"
        min="0"
        max="1"
        step="0.05"
        defaultValue={String(lesson?.pass_threshold ?? 0.8)}
      />
      <Published defaultChecked={lesson?.is_published ?? true} />
    </>
  );
}

export function NewLesson({ unitId, nextOrder, others }: { unitId: string; nextOrder: number; others: LessonOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(createLessonAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowa lekcja</h2>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="unit_id" value={unitId} />
        <TitleAndSlug titlePlaceholder="Owoce" slugPlaceholder="owoce" />
        <LessonFields others={others} lesson={{ title: "", icon: null, kind: "standard", sort_order: nextOrder, xp_reward: 50, pass_threshold: 0.8, prerequisite_lesson_id: null, is_published: true }} />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj lekcję</SubmitButton>
      </Form>
    </section>
  );
}

export function LessonSettings({
  lesson,
  unitId,
  others,
  courseSlug,
  unitSlug,
  counts,
}: {
  lesson: { id: string; slug: string; title: string; icon: string | null; kind: string; sort_order: number; xp_reward: number; pass_threshold: number; prerequisite_lesson_id: string | null; is_published: boolean };
  unitId: string;
  others: LessonOption[];
  courseSlug: string;
  unitSlug: string;
  counts: { exercises: number; children: number; opened: number };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateLessonAction, {});

  return (
    <>
      <Editor summary="Edytuj lekcję">
        <Form action={action} state={state} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={lesson.id} />
          <input type="hidden" name="unit_id" value={unitId} />
          <Field label="Nazwa" name="title" defaultValue={lesson.title} />
          <LessonFields lesson={lesson} others={others} />
          <Status state={state} />
          <SubmitButton pendingLabel="Zapisuję…">Zapisz lekcję</SubmitButton>
        </Form>
      </Editor>

      <Danger
        action={deleteLessonAction}
        heading="Usuń lekcję"
        slug={lesson.slug}
        hidden={{ id: lesson.id, current_slug: lesson.slug, course_slug: courseSlug, unit_slug: unitSlug }}
        warning={
          `Znikną zadania lekcji (${counts.exercises}) oraz postępy dzieci z tej lekcji ` +
          `(${counts.children}). Słówka zostają przy kursie razem ze stanem powtórek dziecka. ` +
          (counts.opened > 0
            ? `Lekcje otwierane po tej (${counts.opened}) staną się dostępne od razu. `
            : "") +
          `Tego się nie cofnie; żeby tylko schować lekcję, odznacz „Widoczne dla dzieci".`
        }
        label="Usuń lekcję z zadaniami"
      />
    </>
  );
}

/**
 * Dodanie słówka. Z jednej pary słów powstają trzy zadania, więc dziecko ma czego się uczyć
 * od razu — klucz techniczny układa się sam, chyba że administrator poda własny.
 */
export function AddWord({
  lessonId,
  sourceLabel,
  targetLabel,
}: {
  lessonId: string;
  sourceLabel: string;
  targetLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(addWordAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowe słówko</h2>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="lesson_id" value={lessonId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Po ${sourceLabel}`} name="source" placeholder="ziemniak, kartofel" />
          <Field label={`Po ${targetLabel}`} name="target" placeholder="potato" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Klucz (opcjonalnie)" name="key" required={false} placeholder="food.apple" />
          <Field label="Emoji (opcjonalnie)" name="tags" required={false} placeholder="🍎" />
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Powstaną trzy zadania: tłumaczenie w obie strony i ze słuchu. Kilka dobrych odpowiedzi
          wpisz po przecinku — pierwsza jest główna i to ją dziecko zobaczy w poleceniu, reszta
          liczy się przy sprawdzaniu. Ogonków dziecko pisać nie musi.
        </p>
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj słówko</SubmitButton>
      </Form>
    </section>
  );
}

/**
 * Poprawienie słówka. Zmiana przepisuje też treść zadań wygenerowanych z pary słów — inaczej
 * literówka poprawiona w słówku zostawałaby w zadaniu, które dziecko widzi na ekranie.
 */
/** Jeden wiersz tabeli słówek — dokładnie to, co strona musi przekazać do przeglądarki. */
export type WordRow = {
  conceptId: string;
  emoji: string;
  /** Słowo główne: to widać w wierszu. */
  source: string;
  target: string;
  /** Wszystkie poprawne odpowiedzi po przecinku: to wchodzi do formularza edycji. */
  sourceAll: string;
  targetAll: string;
  conceptKey: string;
  tasks: number;
};

/** Formularze jednego słówka, rozwijane pod jego wierszem. */
function WordForm({
  row,
  lessonId,
  sourceLabel,
  targetLabel,
}: {
  row: WordRow;
  lessonId: string;
  sourceLabel: string;
  targetLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateWordAction, {});
  const [removeState, removeAction] = useActionState<FormState, FormData>(removeWordAction, {});

  return (
    <div className="flex flex-col gap-4 py-3">
      <Form action={action} state={state} className="flex flex-col gap-3">
        <input type="hidden" name="concept_id" value={row.conceptId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Po ${sourceLabel}`} name="source" defaultValue={row.sourceAll} />
          <Field label={`Po ${targetLabel}`} name="target" defaultValue={row.targetAll} />
        </div>
        <Field label="Emoji" name="tags" required={false} defaultValue={row.emoji} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Klucz <code>{row.conceptKey}</code> zostaje — po nim import rozpoznaje to słówko. Kilka
          dobrych odpowiedzi wpisz po przecinku; pierwsza jest główna.
        </p>
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz słówko</SubmitButton>
      </Form>

      {/* Osobny formularz, nie przycisk w tamtym: to inna akcja, z własnym komunikatem.
          Bez przepisywania nazwy — zdjęcie słówka z lekcji odwraca się jednym dodaniem,
          a stan powtórek dziecka i tak zostaje. */}
      <Form action={removeAction} state={removeState} className="flex flex-col gap-2">
        <input type="hidden" name="lesson_id" value={lessonId} />
        <input type="hidden" name="concept_id" value={row.conceptId} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Zdjęcie z lekcji kasuje też jej zadania z tym słówkiem. Słówko nietknięte przez żadne
          dziecko i nieużywane gdzie indziej znika z kursu.
        </p>
        <Status state={removeState} />
        <SubmitButton variant="danger" pendingLabel="Usuwam…">
          Usuń słówko z lekcji
        </SubmitButton>
      </Form>
    </div>
  );
}

/**
 * Słówka lekcji jako tabela.
 *
 * Wcześniej każde słówko było kartą z przyciskiem „Edytuj słówko" na całą szerokość — przy
 * osiemnastu słówkach strona miała kilka ekranów i nie dało się przebiec wzrokiem, czego
 * w lekcji brakuje. To jest widok dla dorosłego: jeden wiersz na słówko, a formularz rozwija
 * się dopiero pod tym, które się poprawia.
 *
 * Otwarty jest najwyżej jeden wiersz. Nie z oszczędności miejsca, tylko dlatego, że każdy
 * formularz ma własne pola z wartościami wziętymi przy wejściu na stronę — kilka otwartych
 * naraz kusi, żeby wpisać coś w dwóch i zapisać jeden.
 */
export function WordTable({
  rows,
  lessonId,
  sourceLabel,
  targetLabel,
}: {
  rows: WordRow[];
  lessonId: string;
  sourceLabel: string;
  targetLabel: string;
}) {
  const [otwarte, setOtwarte] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        Lekcja jest pusta — dla dziecka nie ma w niej jeszcze nic do zrobienia.
      </p>
    );
  }

  return (
    <div className="card overflow-x-auto px-3 py-2">
      <table className="admin-table">
        <thead>
          <tr>
            {/* Kolumna z emoji nie ma nagłówka do przeczytania — obrazek jest ozdobą wiersza. */}
            <th />
            <th>{sourceLabel}</th>
            <th>{targetLabel}</th>
            <th className="hidden md:table-cell">Klucz</th>
            <th className="text-right">Zadań</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = otwarte === row.conceptId;
            return (
              <Fragment key={row.conceptId}>
                <tr>
                  <td className="w-8 text-2xl" aria-hidden>
                    {row.emoji}
                  </td>
                  <td className="font-semibold">{row.source}</td>
                  <td className="font-semibold">{row.target}</td>
                  <td className="hidden font-mono text-sm text-zinc-500 md:table-cell">{row.conceptKey}</td>
                  <td className="text-right tabular-nums">{row.tasks}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-row"
                      aria-expanded={open}
                      onClick={() => setOtwarte(open ? null : row.conceptId)}
                    >
                      {open ? "Zwiń" : <><span aria-hidden>✏️</span> Edytuj</>}
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6}>
                      <WordForm
                        row={row}
                        lessonId={lessonId}
                        sourceLabel={sourceLabel}
                        targetLabel={targetLabel}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Zapisanie albo wypisanie jednego dziecka. Wypisanie nie kasuje jego postępów. */
export function EnrollmentButton({
  userId,
  courseId,
  enrolled,
}: {
  userId: string;
  courseId: string;
  enrolled: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(setEnrollmentAction, {});

  return (
    <Form action={action} state={state} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="enrolled" value={enrolled ? "true" : "false"} />
      <button type="submit" className="btn-secondary px-4 py-1 text-base" style={{ minHeight: "2.5rem" }}>
        {enrolled ? "Wypisz" : "Zapisz"}
      </button>
      {state.error && <span className="text-base text-red-700">{state.error}</span>}
    </Form>
  );
}
