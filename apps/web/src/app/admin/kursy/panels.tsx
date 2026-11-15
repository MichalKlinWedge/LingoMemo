"use client";

import { useActionState } from "react";

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
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <details className="card p-6">
      {/* Tak samo jak w `Editor`: po samym nagłówku nie widać, że to coś robi. */}
      <summary className="btn-danger w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden>🗑️</span> {heading}
      </summary>
      <Form action={formAction} state={state} className="mt-4 flex flex-col gap-4">
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

export function NewCourse({ languages }: { languages: { code: string; name_pl: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(createCourseAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowy kurs</h2>
      <Form action={action} state={state} className="flex flex-col gap-4">
        <TitleAndSlug titlePlaceholder="Angielski od zera" slugPlaceholder="pl-en-starter" />
        <Field label="Opis" name="description" required={false} placeholder="Pierwsze słówka i zwroty." />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ikona" name="icon" required={false} placeholder="🇬🇧" />
          <label className="flex flex-col gap-2">
            <span className="font-semibold">Język dziecka</span>
            <select name="source_lang" className="field" defaultValue="pl">
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name_pl}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="font-semibold">Język uczony</span>
            <select name="target_lang" className="field" defaultValue="en">
              {languages.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name_pl}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Published defaultChecked />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj kurs</SubmitButton>
      </Form>
    </section>
  );
}

export function CourseSettings({
  course,
  languages,
  counts,
}: {
  course: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    icon: string | null;
    source_lang: string;
    target_lang: string;
    sort_order: number;
    is_published: boolean;
  };
  languages: { code: string; name_pl: string }[];
  counts: { units: number; lessons: number; words: number; students: number };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateCourseAction, {});

  return (
    <>
      <Editor summary="Edytuj kurs">
        <Form action={action} state={state} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={course.id} />
          {/* Po czym poznać, że slug się zmienił — akcja przerzuca wtedy na nowy adres. */}
          <input type="hidden" name="current_slug" value={course.slug} />
          <TitleAndSlug defaultTitle={course.title} defaultSlug={course.slug} />
          <Field label="Opis" name="description" required={false} defaultValue={course.description ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ikona" name="icon" required={false} defaultValue={course.icon ?? ""} />
            <Field label="Kolejność" name="sort_order" type="number" min="0" defaultValue={String(course.sort_order)} />
          </div>
          <Languages
            languages={languages}
            source={course.source_lang}
            target={course.target_lang}
            editable={counts.words === 0}
          />
          <Published defaultChecked={course.is_published} />
          <Status state={state} />
          <SubmitButton pendingLabel="Zapisuję…">Zapisz kurs</SubmitButton>
        </Form>
      </Editor>

      <Danger
        action={deleteCourseAction}
        heading="Usuń kurs"
        slug={course.slug}
        hidden={{ id: course.id, current_slug: course.slug }}
        warning={
          `Znikną: działy (${counts.units}), lekcje (${counts.lessons}), słówka (${counts.words}) ` +
          `oraz postępy i powtórki dzieci zapisanych na kurs (${counts.students}). Tego się nie cofnie. ` +
          `Jeśli chodzi tylko o to, żeby dzieci tego nie widziały, odznacz „Widoczne dla dzieci".`
        }
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

type LessonOption = { id: string; title: string };

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
            {others.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
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
export function EditWord({
  conceptId,
  lessonId,
  source,
  target,
  tag,
  sourceLabel,
  targetLabel,
  conceptKey,
}: {
  conceptId: string;
  lessonId: string;
  source: string;
  target: string;
  tag: string;
  sourceLabel: string;
  targetLabel: string;
  conceptKey: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateWordAction, {});
  const [removeState, removeAction] = useActionState<FormState, FormData>(removeWordAction, {});

  return (
    <Editor summary="Edytuj słówko">
      <Form action={action} state={state} className="flex flex-col gap-3">
        <input type="hidden" name="concept_id" value={conceptId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Po ${sourceLabel}`} name="source" defaultValue={source} />
          <Field label={`Po ${targetLabel}`} name="target" defaultValue={target} />
        </div>
        <Field label="Emoji" name="tags" required={false} defaultValue={tag} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Klucz <code>{conceptKey}</code> zostaje — po nim import rozpoznaje to słówko. Kilka
          dobrych odpowiedzi wpisz po przecinku; pierwsza jest główna.
        </p>
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz słówko</SubmitButton>
      </Form>

      {/* Osobny formularz, nie przycisk w tamtym: to inna akcja, z własnym komunikatem.
          Bez przepisywania nazwy — zdjęcie słówka z lekcji odwraca się jednym dodaniem,
          a stan powtórek dziecka i tak zostaje. */}
      <Form action={removeAction} state={removeState} className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="lesson_id" value={lessonId} />
        <input type="hidden" name="concept_id" value={conceptId} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Zdjęcie z lekcji kasuje też jej zadania z tym słówkiem. Słówko nietknięte przez żadne
          dziecko i nieużywane gdzie indziej znika z kursu.
        </p>
        <Status state={removeState} />
        <SubmitButton variant="danger" pendingLabel="Usuwam…">
          Usuń słówko z lekcji
        </SubmitButton>
      </Form>
    </Editor>
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
