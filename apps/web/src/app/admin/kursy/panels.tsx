"use client";

import { useActionState } from "react";

import {
  addWordAction,
  createCourseAction,
  createLessonAction,
  createUnitAction,
  setEnrollmentAction,
  updateCourseAction,
  updateLessonAction,
  updateUnitAction,
  updateWordAction,
} from "@/app/admin/kursy/actions";
import { Field, type FormState, Status, SubmitButton } from "@/components/forms";

/** Pole wyboru „opublikowane". Treść nieopublikowana jest widoczna tylko dla administratora. */
function Published({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-3">
      <input type="checkbox" name="is_published" defaultChecked={defaultChecked} className="h-6 w-6" />
      <span className="font-semibold">Widoczne dla dzieci</span>
    </label>
  );
}

/** Formularz edycji chowamy pod rozwijaniem — lista ma zostać czytelna. */
function Editor({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="w-full">
      <summary className="back-link cursor-pointer list-none font-semibold">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function NewCourse({ languages }: { languages: { code: string; name_pl: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(createCourseAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowy kurs</h2>
      <form action={action} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nazwa" name="title" placeholder="Angielski od zera" />
          <Field label="Nazwa w adresie" name="slug" placeholder="pl-en-starter" />
        </div>
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
      </form>
    </section>
  );
}

export function CourseSettings({
  course,
}: {
  course: { id: string; title: string; description: string | null; icon: string | null; sort_order: number; is_published: boolean };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateCourseAction, {});

  return (
    <Editor summary="Ustawienia kursu">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={course.id} />
        <Field label="Nazwa" name="title" defaultValue={course.title} />
        <Field label="Opis" name="description" required={false} defaultValue={course.description ?? ""} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ikona" name="icon" required={false} defaultValue={course.icon ?? ""} />
          <Field label="Kolejność" name="sort_order" type="number" defaultValue={String(course.sort_order)} />
        </div>
        <Published defaultChecked={course.is_published} />
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz kurs</SubmitButton>
      </form>
    </Editor>
  );
}

export function NewUnit({ courseId, nextOrder }: { courseId: string; nextOrder: number }) {
  const [state, action] = useActionState<FormState, FormData>(createUnitAction, {});

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowy dział</h2>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="course_id" value={courseId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nazwa" name="title" placeholder="Jedzenie" />
          <Field label="Nazwa w adresie" name="slug" placeholder="jedzenie" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ikona" name="icon" required={false} placeholder="🍎" />
          <Field label="Kolor" name="color" required={false} placeholder="#f97316" />
          <Field label="Kolejność" name="sort_order" type="number" defaultValue={String(nextOrder)} />
        </div>
        <Published defaultChecked />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj dział</SubmitButton>
      </form>
    </section>
  );
}

export function UnitSettings({
  unit,
}: {
  unit: { id: string; title: string; icon: string | null; color: string | null; sort_order: number; is_published: boolean };
}) {
  const [state, action] = useActionState<FormState, FormData>(updateUnitAction, {});

  return (
    <Editor summary="Ustawienia działu">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={unit.id} />
        <Field label="Nazwa" name="title" defaultValue={unit.title} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Ikona" name="icon" required={false} defaultValue={unit.icon ?? ""} />
          <Field label="Kolor" name="color" required={false} defaultValue={unit.color ?? ""} />
          <Field label="Kolejność" name="sort_order" type="number" defaultValue={String(unit.sort_order)} />
        </div>
        <Published defaultChecked={unit.is_published} />
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz dział</SubmitButton>
      </form>
    </Editor>
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
        <Field label="Kolejność" name="sort_order" type="number" defaultValue={String(lesson?.sort_order ?? 1)} />
        <Field label="Punkty za ukończenie" name="xp_reward" type="number" defaultValue={String(lesson?.xp_reward ?? 50)} />
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
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="unit_id" value={unitId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nazwa" name="title" placeholder="Owoce" />
          <Field label="Nazwa w adresie" name="slug" placeholder="owoce" />
        </div>
        <LessonFields others={others} lesson={{ title: "", icon: null, kind: "standard", sort_order: nextOrder, xp_reward: 50, pass_threshold: 0.8, prerequisite_lesson_id: null, is_published: true }} />
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj lekcję</SubmitButton>
      </form>
    </section>
  );
}

export function LessonSettings({
  lesson,
  unitId,
  others,
}: {
  lesson: { id: string; title: string; icon: string | null; kind: string; sort_order: number; xp_reward: number; pass_threshold: number; prerequisite_lesson_id: string | null; is_published: boolean };
  unitId: string;
  others: LessonOption[];
}) {
  const [state, action] = useActionState<FormState, FormData>(updateLessonAction, {});

  return (
    <Editor summary="Ustawienia lekcji">
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="id" value={lesson.id} />
        <input type="hidden" name="unit_id" value={unitId} />
        <Field label="Nazwa" name="title" defaultValue={lesson.title} />
        <LessonFields lesson={lesson} others={others} />
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz lekcję</SubmitButton>
      </form>
    </Editor>
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
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="lesson_id" value={lessonId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Po ${sourceLabel}`} name="source" placeholder="jabłko" />
          <Field label={`Po ${targetLabel}`} name="target" placeholder="apple" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Klucz (opcjonalnie)" name="key" required={false} placeholder="food.apple" />
          <Field label="Emoji (opcjonalnie)" name="tags" required={false} placeholder="🍎" />
        </div>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Powstaną trzy zadania: tłumaczenie w obie strony i ze słuchu.
        </p>
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">Dodaj słówko</SubmitButton>
      </form>
    </section>
  );
}

/**
 * Poprawienie słówka. Zmiana przepisuje też treść zadań wygenerowanych z pary słów — inaczej
 * literówka poprawiona w słówku zostawałaby w zadaniu, które dziecko widzi na ekranie.
 */
export function EditWord({
  conceptId,
  source,
  target,
  tag,
  sourceLabel,
  targetLabel,
  conceptKey,
}: {
  conceptId: string;
  source: string;
  target: string;
  tag: string;
  sourceLabel: string;
  targetLabel: string;
  conceptKey: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(updateWordAction, {});

  return (
    <Editor summary="Popraw">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="concept_id" value={conceptId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Po ${sourceLabel}`} name="source" defaultValue={source} />
          <Field label={`Po ${targetLabel}`} name="target" defaultValue={target} />
        </div>
        <Field label="Emoji" name="tags" required={false} defaultValue={tag} />
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Klucz <code>{conceptKey}</code> zostaje — po nim import rozpoznaje to słówko.
        </p>
        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz słówko</SubmitButton>
      </form>
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
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="course_id" value={courseId} />
      <input type="hidden" name="enrolled" value={enrolled ? "true" : "false"} />
      <button type="submit" className="btn-secondary px-4 py-1 text-base" style={{ minHeight: "2.5rem" }}>
        {enrolled ? "Wypisz" : "Zapisz"}
      </button>
      {state.error && <span className="text-base text-red-700">{state.error}</span>}
    </form>
  );
}
