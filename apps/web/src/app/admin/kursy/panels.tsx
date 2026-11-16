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
  reorderLessonsAction,
  reorderUnitsAction,
  setEnrollmentAction,
  updateCourseAction,
  updateLessonAction,
  updateUnitAction,
  updateWordAction,
} from "@/app/admin/kursy/actions";
import { Flag } from "@/components/flag";
import { Field, Form, Status, SubmitButton, TitleAndSlug, type FormState } from "@/components/forms";

import { SortableTable, type SortableTableRow } from "./sortable-rows";

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
 * Kasowanie w rozwiniętym wierszu tabeli.
 *
 * Potwierdza się je przepisaniem nazwy z adresu: okienko „na pewno?" klika się odruchowo,
 * a tu znikają też postępy dziecka — przepisanie nazwy wymaga spojrzenia na to, co się kasuje.
 * Sam formularz, bez własnego rozwijania: rozwinięciem jest już kosz w wierszu.
 */
function DangerForm({
  action,
  warning,
  slug,
  hidden,
  label,
  className = "mt-4 flex flex-col gap-4",
  pendingLabel = "Usuwam…",
  tone = "error",
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  warning: string;
  /**
   * Slug do przepisania. Pominięty znaczy „bez przepisywania": tę ceremonię zakłada się tam,
   * gdzie czegoś nie da się cofnąć. Ukrycie kursu cofa się jednym odznaczeniem w edycji, więc
   * kazać przepisywać adres znaczyłoby tylko tyle, że nikt tego nie przeczyta.
   */
  slug?: string;
  hidden: Record<string, string>;
  label: string;
  className?: string;
  pendingLabel?: string;
  /** „warn" dla rzeczy odwracalnych — czerwień jest zarezerwowana na to, czego nie będzie. */
  tone?: "error" | "warn";
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <Form action={formAction} state={state} className={className}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className={tone === "warn" ? "msg-warn" : "msg-error"}>{warning}</p>
      {slug !== undefined && (
        <Field label={`Przepisz „${slug}", żeby potwierdzić`} name="confirm" autoComplete="off" placeholder={slug} />
      )}
      <Status state={state} />
      <SubmitButton variant="danger" pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
    </Form>
  );
}

/** Co jest rozwinięte pod wierszem tabeli. Najwyżej jedno naraz i najwyżej w jednym wierszu. */
type RowState = { id: string; co: "edycja" | "usuwanie" } | null;

/**
 * Ołówek i kosz w wierszu tabeli.
 *
 * Same ikony bez napisów: nazwy akcji przy sześciu kolumnach rozpychały tabelę poza kartę,
 * a wtedy połowa przycisku „Usuń" zostawała za krawędzią. Nazwa jest w `aria-label` i w dymku,
 * więc czytnik ekranu i mysz dowiadują się, co robi przycisk.
 */
function RowActions({
  what,
  whatOf,
  open,
  onToggle,
  removeName,
  removeTitle = "Usuń",
}: {
  /** Biernik: „kurs", „dział", „lekcję" — do „Edytuj …" i „Usuń …". */
  what: string;
  /** Dopełniacz: „kursu", „działu", „lekcji" — do „Zwiń edycję …". */
  whatOf: string;
  open: "edycja" | "usuwanie" | null;
  onToggle: (co: "edycja" | "usuwanie") => void;
  /**
   * Inna nazwa kosza, gdy przycisk nie kasuje. Kurs, z którego ktoś się już uczył, zostaje
   * ukryty, a nie skasowany — dymek „Usuń" obiecywałby wtedy co innego, niż się stanie.
   */
  removeName?: string;
  removeTitle?: string;
}) {
  const przyciski = [
    { co: "edycja" as const, ikona: "✏️", nazwa: `Edytuj ${what}`, zwin: `Zwiń edycję ${whatOf}`, tytul: "Edytuj" },
    {
      co: "usuwanie" as const,
      ikona: "🗑️",
      nazwa: removeName ?? `Usuń ${what}`,
      zwin: `Zwiń usuwanie ${whatOf}`,
      tytul: removeTitle,
    },
  ];

  return (
    <div className="flex items-center justify-end gap-2">
      {przyciski.map((przycisk) => {
        const otwarty = open === przycisk.co;
        return (
          <button
            key={przycisk.co}
            type="button"
            className="btn-row"
            aria-expanded={otwarty}
            aria-label={otwarty ? przycisk.zwin : przycisk.nazwa}
            title={otwarty ? "Zwiń" : przycisk.tytul}
            onClick={() => onToggle(przycisk.co)}
          >
            <span aria-hidden>{otwarty ? "✖️" : przycisk.ikona}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Przycisk „Dodaj …" nad tabelą, który rozwija formularz zamiast trzymać go rozłożonego na stałe. */
export function AddButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="btn-secondary px-5" aria-expanded={open} onClick={onToggle}>
      {open ? (
        "Zwiń"
      ) : (
        <>
          <span aria-hidden>➕</span> {label}
        </>
      )}
    </button>
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
  /**
   * Czy w kursie jest ślad nauki dziecka. Rozstrzyga, czy „Usuń" kasuje, czy tylko ukrywa —
   * decyduje o tym baza (`course_started`), a tutaj mamy to tylko po to, żeby napisać
   * administratorowi, co się stanie, ZANIM kliknie.
   */
  started: boolean;
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

/**
 * Co się właściwie stanie po kliknięciu kosza. Decyduje o tym baza — kurs, z którego ktoś się
 * już uczył, `admin_delete_course` tylko ukrywa. Tutaj składamy zdanie, które ma to powiedzieć
 * administratorowi PRZED kliknięciem, bo inaczej „Usuń" kłamie w jedną albo w drugą stronę.
 *
 * To samo na liście kursów i na stronie kursu.
 */
function deleteDanger(course: { slug: string; started: boolean; counts: CourseCounts }) {
  const { counts } = course;

  if (course.started) {
    return {
      tone: "warn" as const,
      // Bez przepisywania adresu: ukrycie cofa się jednym odznaczeniem w edycji.
      slug: undefined,
      warning:
        `Ktoś już się uczył z tego kursu, więc nie zostanie skasowany — zniknie dzieciom z listy. ` +
        `Działy (${counts.units}), lekcje (${counts.lessons}), słówka (${counts.words}) oraz postępy ` +
        `i powtórki zostają nietknięte. Żeby kurs wrócił, zaznacz „Widoczne dla dzieci" w edycji.`,
      label: "Ukryj kurs przed dziećmi",
      pendingLabel: "Ukrywam…",
    };
  }

  return {
    tone: "error" as const,
    slug: course.slug,
    warning:
      `Nikt jeszcze nie zaczął tego kursu, więc zniknie naprawdę: działy (${counts.units}), ` +
      `lekcje (${counts.lessons}) i słówka (${counts.words}). Zapisane dzieci (${counts.students}) ` +
      `stracą go z listy, ale nic w nim nie przerobiły. Tego się nie cofnie.`,
    label: "Usuń kurs z całą zawartością",
    pendingLabel: "Usuwam…",
  };
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
  const [otwarte, setOtwarte] = useState<RowState>(null);

  const nameOf = (code: string) => languages.find((lang) => lang.code === code)?.name_pl ?? code;
  const przelacz = (id: string, co: "edycja" | "usuwanie") =>
    setOtwarte(otwarte?.id === id && otwarte.co === co ? null : { id, co });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">Kursy</h2>
        <AddButton label="Dodaj kurs" open={nowy} onToggle={() => setNowy(!nowy)} />
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
                        <RowActions
                          what="kurs"
                          whatOf="kursu"
                          open={otwarte?.id === course.id ? otwarte.co : null}
                          onToggle={(co) => przelacz(course.id, co)}
                          removeName={course.started ? "Ukryj kurs przed dziećmi" : undefined}
                          removeTitle={course.started ? "Ukryj" : undefined}
                        />
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
                              hidden={{ id: course.id, current_slug: course.slug }}
                              className="flex flex-col gap-4 py-4"
                              {...deleteDanger(course)}
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

/* Strona kursu nie ma już „Edytuj kurs" ani „Usuń kurs": jedno i drugie dzieje się w wierszu
   na liście kursów, a te same dwa przyciski jeszcze raz pod tytułem tylko zabierały miejsce
   działom. Z nimi zniknął powód, dla którego `updateCourseAction` dostawał `current_slug` —
   akcja obsługuje go dalej, bo działom i lekcjom przerzucenie na nowy adres jest potrzebne. */

/** Ile w dziale jest zawartości. Po tym widać, czy dział żyje, i co zniknie przy kasowaniu. */
export type UnitCounts = { lessons: number; words: number };

export type UnitRow = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  is_published: boolean;
  counts: UnitCounts;
};

/**
 * Pola działu — te same w dodawaniu i w poprawianiu, z tego samego powodu co w kursie:
 * dwa osobne formularze rozjeżdżają się przy pierwszej dołożonej kolumnie.
 *
 * Nie ma tu pola „Kolejność". Kolejność zmienia się przeciągnięciem wiersza, a liczba w formularzu
 * mówiła to samo drugim głosem — po przestawieniu listy pokazywała wartość z chwili wejścia
 * na stronę i zapis formularza cofał przeciągnięcie. Numer jedzie ukrytym polem.
 */
function UnitFields({ unit }: { unit?: Omit<UnitRow, "counts"> }) {
  return (
    <>
      <TitleAndSlug
        titlePlaceholder="Jedzenie"
        slugPlaceholder="jedzenie"
        defaultTitle={unit?.title ?? ""}
        defaultSlug={unit?.slug ?? ""}
        // Nowy dział dostaje adres z nazwy i nikt go nie ogląda. Poprawia się go w edycji.
        slugHidden={unit === undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ikona" name="icon" required={false} placeholder="🍎" defaultValue={unit?.icon ?? ""} />
        <Field label="Kolor" name="color" required={false} placeholder="#f97316" defaultValue={unit?.color ?? ""} />
      </div>
      <Published defaultChecked={unit?.is_published ?? true} />
    </>
  );
}

function NewUnit({ courseId, nextOrder }: { courseId: string; nextOrder: number }) {
  const [state, action] = useActionState<FormState, FormData>(createUnitAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h3 className="card-title">Nowy dział</h3>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="course_id" value={courseId} />
        {/* Nowy dział ląduje na końcu listy — stamtąd przestawia się go przeciągnięciem. */}
        <input type="hidden" name="sort_order" value={String(nextOrder)} />
        <UnitFields />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj dział</SubmitButton>
      </Form>
    </section>
  );
}

/**
 * Poprawianie działu bez opuszczania listy. Bez `current_slug` — to on włącza w akcji przerzucenie
 * na stronę działu po zmianie sluga, a tutaj adres strony się nie zmienia i wyrzucenie z listy
 * kursu w środku poprawiania byłoby zaskoczeniem.
 */
function UnitEditor({ unit }: { unit: UnitRow }) {
  const [state, action] = useActionState<FormState, FormData>(updateUnitAction, {});

  return (
    <Form action={action} state={state} className="flex flex-col gap-4 py-4">
      <input type="hidden" name="id" value={unit.id} />
      <input type="hidden" name="sort_order" value={String(unit.sort_order)} />
      <UnitFields unit={unit} />
      <Status state={state} />
      <SubmitButton pendingLabel="Zapisuję…">Zapisz dział</SubmitButton>
    </Form>
  );
}

/** Co zniknie razem z działem. To samo zdanie na liście kursu i na stronie działu. */
function unitDeleteWarning(lessons: number): string {
  return (
    `Znikną lekcje działu (${lessons}) razem z ich zadaniami i postępami dzieci. ` +
    `Słówka zostają przy kursie — wisi na nich stan powtórek, więc dziecko ich nie traci. ` +
    `Tego się nie cofnie; żeby tylko schować dział, odznacz „Widoczne dla dzieci".`
  );
}

/**
 * Działy kursu jako tabela — to samo, co kursy dostały piętro wyżej.
 *
 * Każdy dział był kartą na całą szerokość, a pod listą stał rozłożony na stałe formularz
 * „Nowy dział": przy trzech działach to on zajmował pół ekranu i on przyciągał wzrok.
 * Teraz formularz wychodzi spod przycisku, a działy są wierszami — widać naraz wszystkie,
 * ile mają lekcji i słówek, i czy dziecko je widzi.
 *
 * Poprawianie i kasowanie dzieje się w wierszu; na stronę działu wchodzi się po lekcje,
 * a nie po to, żeby zmienić nazwę. Otwarty jest najwyżej jeden wiersz: każdy formularz ma
 * wartości wzięte przy wejściu na stronę, więc kilka naraz kusi, żeby wpisać coś w dwóch,
 * a zapisać jeden.
 */
export function UnitTable({
  courseId,
  courseSlug,
  units,
}: {
  courseId: string;
  courseSlug: string;
  units: UnitRow[];
}) {
  const [nowy, setNowy] = useState(false);
  const [otwarte, setOtwarte] = useState<RowState>(null);

  const nextOrder = Math.max(0, ...units.map((unit) => unit.sort_order)) + 1;
  const przelacz = (id: string, co: "edycja" | "usuwanie") =>
    setOtwarte(otwarte?.id === id && otwarte.co === co ? null : { id, co });

  const rows: SortableTableRow[] = units.map((unit) => {
    const otwarty = otwarte?.id === unit.id ? otwarte.co : null;
    return {
      id: unit.id,
      label: unit.title,
      cells: (
        <>
          {/* `wrap-anywhere`: w wąskim oknie długa nazwa łamie się zamiast rozpychać tabelę
              poza kartę — kolumna z nazwą jest tą, która ma ustąpić. */}
          <td className="wrap-anywhere">
            <Link href={`/admin/kursy/${courseSlug}/${unit.slug}`} className="flex items-center gap-2 font-semibold">
              <span className="text-2xl" aria-hidden>
                {unit.icon}
              </span>
              {unit.title}
            </Link>
            {/* Na telefonie nie ma kolumny „Widoczny", a to jedyny stan wart zauważenia. */}
            {!unit.is_published && <span className="chip mt-1 sm:hidden">ukryty</span>}
          </td>
          <td className="hidden text-right tabular-nums sm:table-cell">{unit.counts.lessons}</td>
          <td className="hidden text-right tabular-nums sm:table-cell">{unit.counts.words}</td>
          <td className="hidden sm:table-cell">
            <span className="chip">{unit.is_published ? "widoczny" : "ukryty"}</span>
          </td>
          <td className="text-right">
            <RowActions what="dział" whatOf="działu" open={otwarty} onToggle={(co) => przelacz(unit.id, co)} />
          </td>
        </>
      ),
      expanded:
        otwarty === "edycja" ? (
          <UnitEditor unit={unit} />
        ) : otwarty === "usuwanie" ? (
          <DangerForm
            action={deleteUnitAction}
            slug={unit.slug}
            hidden={{ id: unit.id, current_slug: unit.slug, course_slug: courseSlug }}
            warning={unitDeleteWarning(unit.counts.lessons)}
            label="Usuń dział z lekcjami"
            className="flex flex-col gap-4 py-4"
          />
        ) : undefined,
    };
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">Działy</h2>
        <AddButton label="Dodaj dział" open={nowy} onToggle={() => setNowy(!nowy)} />
      </div>

      {nowy && <NewUnit courseId={courseId} nextOrder={nextOrder} />}

      {units.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Kurs nie ma jeszcze działów. Zacznij od przycisku „Dodaj dział”.
        </p>
      ) : (
        <>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Kolejność zmienia się przeciągnięciem za uchwyt ⠿ albo strzałkami góra i dół.
          </p>
          <SortableTable
            parentId={courseId}
            action={reorderUnitsAction}
            noun="dział"
            columns={6}
            head={
              <>
                <th>Dział</th>
                <th className="hidden text-right sm:table-cell">Lekcje</th>
                <th className="hidden text-right sm:table-cell">Słówka</th>
                <th className="hidden sm:table-cell">Widoczny</th>
                <th />
              </>
            }
            rows={rows}
          />
        </>
      )}
    </section>
  );
}

/**
 * Lekcja do wyboru jako warunek wstępny. `unit` jest tu dlatego, że warunek wolno postawić na
 * lekcji z dowolnego działu kursu — import tak robi (zapis „dzial/lekcja"). Gdy lista zawierała
 * tylko lekcje tego samego działu, warunek z innego działu nie miał swojej opcji, pole pokazywało
 * „od razu dostępna", a zapis formularza po cichu kasował warunek.
 */
type LessonOption = { id: string; title: string; unit: string };

/**
 * Wspólne pola lekcji dla dodawania i edycji — żeby nie rozjechały się między formularzami.
 *
 * Bez pola „Kolejność": tak samo jak w dziale, numer zmienia się przeciągnięciem wiersza,
 * a formularz pokazywał wartość z chwili wejścia na stronę i zapisem cofał przestawienie.
 * Numer jedzie ukrytym polem, które dokłada formularz.
 */
function LessonFields({
  lesson,
  others,
}: {
  lesson?: { title: string; icon: string | null; kind: string; sort_order: number; xp_reward: number; pass_threshold: number; prerequisite_lesson_id: string | null; is_published: boolean };
  others: LessonOption[];
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ikona" name="icon" required={false} defaultValue={lesson?.icon ?? ""} placeholder="🍏" />
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

function NewLesson({ unitId, nextOrder, others }: { unitId: string; nextOrder: number; others: LessonOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(createLessonAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h3 className="card-title">Nowa lekcja</h3>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="unit_id" value={unitId} />
        {/* Nowa lekcja ląduje na końcu działu — stamtąd przestawia się ją przeciągnięciem. */}
        <input type="hidden" name="sort_order" value={String(nextOrder)} />
        {/* Adres lekcji składa się z nazwy: w nowej nie ma czego w nim poprawiać. */}
        <TitleAndSlug titlePlaceholder="Owoce" slugPlaceholder="owoce" slugHidden />
        <LessonFields others={others} />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj lekcję</SubmitButton>
      </Form>
    </section>
  );
}

/** Ile w lekcji jest zawartości i co po niej wisi — po tym widać, co zniknie przy kasowaniu. */
export type LessonCounts = { words: number; exercises: number; children: number; opened: number };

export type LessonRow = {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  kind: string;
  sort_order: number;
  xp_reward: number;
  pass_threshold: number;
  prerequisite_lesson_id: string | null;
  is_published: boolean;
  counts: LessonCounts;
};

/** Poprawianie lekcji w wierszu listy. Nazwa w adresie zostaje — jej akcja i tak nie zmienia. */
function LessonEditor({ lesson, unitId, others }: { lesson: LessonRow; unitId: string; others: LessonOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(updateLessonAction, {});

  return (
    <Form action={action} state={state} className="flex flex-col gap-4 py-4">
      <input type="hidden" name="id" value={lesson.id} />
      <input type="hidden" name="unit_id" value={unitId} />
      <input type="hidden" name="sort_order" value={String(lesson.sort_order)} />
      <Field label="Nazwa" name="title" defaultValue={lesson.title} />
      <LessonFields lesson={lesson} others={others.filter((item) => item.id !== lesson.id)} />
      <Status state={state} />
      <SubmitButton pendingLabel="Zapisuję…">Zapisz lekcję</SubmitButton>
    </Form>
  );
}

/** Co zniknie razem z lekcją. To samo zdanie na liście działu i na stronie lekcji. */
function lessonDeleteWarning(counts: Omit<LessonCounts, "words">): string {
  return (
    `Znikną zadania lekcji (${counts.exercises}) oraz postępy dzieci z tej lekcji ` +
    `(${counts.children}). Słówka zostają przy kursie razem ze stanem powtórek dziecka. ` +
    (counts.opened > 0 ? `Lekcje otwierane po tej (${counts.opened}) staną się dostępne od razu. ` : "") +
    `Tego się nie cofnie; żeby tylko schować lekcję, odznacz „Widoczne dla dzieci".`
  );
}

/**
 * Lekcje działu jako tabela — to samo, co dostały kursy i działy.
 *
 * Wcześniej każda lekcja była kartą, a pod listą stał rozłożony na stałe formularz „Nowa lekcja"
 * z ośmioma polami: przy czterech lekcjach formularz zajmował więcej miejsca niż one wszystkie
 * razem. Teraz lekcje są wierszami — widać naraz, ile która ma słówek i czy dziecko ją widzi —
 * a formularz wychodzi spod przycisku.
 */
export function LessonTable({
  unitId,
  courseSlug,
  unitSlug,
  lessons,
  others,
}: {
  unitId: string;
  courseSlug: string;
  unitSlug: string;
  lessons: LessonRow[];
  others: LessonOption[];
}) {
  const [nowa, setNowa] = useState(false);
  const [otwarte, setOtwarte] = useState<RowState>(null);

  const nextOrder = Math.max(0, ...lessons.map((lesson) => lesson.sort_order)) + 1;
  const przelacz = (id: string, co: "edycja" | "usuwanie") =>
    setOtwarte(otwarte?.id === id && otwarte.co === co ? null : { id, co });

  const rows: SortableTableRow[] = lessons.map((lesson) => {
    const otwarty = otwarte?.id === lesson.id ? otwarte.co : null;
    return {
      id: lesson.id,
      label: lesson.title,
      cells: (
        <>
          <td className="wrap-anywhere">
            <Link
              href={`/admin/kursy/${courseSlug}/${unitSlug}/${lesson.slug}`}
              className="flex items-center gap-2 font-semibold"
            >
              <span className="text-2xl" aria-hidden>
                {lesson.icon}
              </span>
              {lesson.title}
            </Link>
            <span className="flex flex-wrap gap-2">
              {lesson.kind === "review" && <span className="chip mt-1">powtórka</span>}
              {/* Na telefonie nie ma kolumny „Widoczna", a to jedyny stan wart zauważenia. */}
              {!lesson.is_published && <span className="chip mt-1 sm:hidden">ukryta</span>}
            </span>
          </td>
          <td className="hidden text-right tabular-nums sm:table-cell">{lesson.counts.words}</td>
          <td className="hidden text-right tabular-nums sm:table-cell">{lesson.counts.exercises}</td>
          <td className="hidden sm:table-cell">
            <span className="chip">{lesson.is_published ? "widoczna" : "ukryta"}</span>
          </td>
          <td className="text-right">
            <RowActions what="lekcję" whatOf="lekcji" open={otwarty} onToggle={(co) => przelacz(lesson.id, co)} />
          </td>
        </>
      ),
      expanded:
        otwarty === "edycja" ? (
          <LessonEditor lesson={lesson} unitId={unitId} others={others} />
        ) : otwarty === "usuwanie" ? (
          <DangerForm
            action={deleteLessonAction}
            slug={lesson.slug}
            hidden={{
              id: lesson.id,
              current_slug: lesson.slug,
              course_slug: courseSlug,
              unit_slug: unitSlug,
            }}
            warning={lessonDeleteWarning(lesson.counts)}
            label="Usuń lekcję z zadaniami"
            className="flex flex-col gap-4 py-4"
          />
        ) : undefined,
    };
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">Lekcje</h2>
        <AddButton label="Dodaj lekcję" open={nowa} onToggle={() => setNowa(!nowa)} />
      </div>

      {nowa && <NewLesson unitId={unitId} nextOrder={nextOrder} others={others} />}

      {lessons.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Dział nie ma jeszcze lekcji. Zacznij od przycisku „Dodaj lekcję”.
        </p>
      ) : (
        <>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            Kolejność zmienia się przeciągnięciem za uchwyt ⠿ albo strzałkami góra i dół. To ona
            decyduje o tym, co dziecko widzi na mapie kursu.
          </p>
          <SortableTable
            parentId={unitId}
            action={reorderLessonsAction}
            noun="lekcję"
            columns={6}
            head={
              <>
                <th>Lekcja</th>
                <th className="hidden text-right sm:table-cell">Słówka</th>
                <th className="hidden text-right sm:table-cell">Zadania</th>
                <th className="hidden sm:table-cell">Widoczna</th>
                <th />
              </>
            }
            rows={rows}
          />
        </>
      )}
    </section>
  );
}

/**
 * Dodanie słówka. Z jednej pary słów powstają trzy zadania, więc dziecko ma czego się uczyć
 * od razu — klucz techniczny układa się sam, chyba że administrator poda własny.
 */
function AddWord({
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
      <h3 className="card-title">Nowe słówko</h3>
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
 * Słówka lekcji jako tabela, razem z dodawaniem.
 *
 * Wcześniej każde słówko było kartą z przyciskiem „Edytuj słówko" na całą szerokość — przy
 * osiemnastu słówkach strona miała kilka ekranów i nie dało się przebiec wzrokiem, czego
 * w lekcji brakuje. To jest widok dla dorosłego: jeden wiersz na słówko, a formularz rozwija
 * się dopiero pod tym, które się poprawia.
 *
 * Formularz „Nowe słówko" wychodzi spod przycisku nad tabelą, nie stoi rozłożony pod listą —
 * tak samo jak w kursach, działach i lekcjach.
 *
 * Otwarty jest najwyżej jeden wiersz. Nie z oszczędności miejsca, tylko dlatego, że każdy
 * formularz ma własne pola z wartościami wziętymi przy wejściu na stronę — kilka otwartych
 * naraz kusi, żeby wpisać coś w dwóch i zapisać jeden.
 */
export function WordSection({
  rows,
  lessonId,
  sourceLabel,
  targetLabel,
  children,
}: {
  rows: WordRow[];
  lessonId: string;
  sourceLabel: string;
  targetLabel: string;
  /** Zdanie pod tabelą o tym, czego w panelu nie da się ułożyć — zostaje przy liście. */
  children?: React.ReactNode;
}) {
  const [nowe, setNowe] = useState(false);
  const [otwarte, setOtwarte] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="card-title">Słówka ({rows.length})</h2>
        <AddButton label="Dodaj słówko" open={nowe} onToggle={() => setNowe(!nowe)} />
      </div>

      {nowe && <AddWord lessonId={lessonId} sourceLabel={sourceLabel} targetLabel={targetLabel} />}

      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Lekcja jest pusta — dla dziecka nie ma w niej jeszcze nic do zrobienia. Zacznij od
          przycisku „Dodaj słówko”.
        </p>
      ) : (
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
                      {/* Liczba zadań prowadzi do ich listy: dotąd mówiła, że coś jest, ale nie
                          dawała jak tego zobaczyć ani poprawić. */}
                      <td className="text-right tabular-nums">
                        {row.tasks > 0 ? (
                          <Link
                            href={`/admin/zadania/${lessonId}/${row.conceptId}`}
                            className="back-link justify-end"
                            title="Zobacz i popraw zadania tego słówka"
                          >
                            {row.tasks}
                          </Link>
                        ) : (
                          row.tasks
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn-row"
                          aria-expanded={open}
                          onClick={() => setOtwarte(open ? null : row.conceptId)}
                        >
                          {open ? (
                            "Zwiń"
                          ) : (
                            <>
                              <span aria-hidden>✏️</span> Edytuj
                            </>
                          )}
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
      )}

      {children}
    </section>
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
