"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/forms";
import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

/**
 * Akcje panelu treści.
 *
 * Kursy, działy i lekcje zapisujemy zwykłymi zapytaniami — polityki `*_admin` w bazie i tak
 * sprawdzają rolę przy każdym wierszu, więc `requireAdmin()` pilnuje tu tylko tego, żeby nie
 * pokazywać formularzy komu popadnie. Wyjątkiem jest słówko: pięć tabel naraz, więc robi to
 * funkcja `admin_add_word` w jednej transakcji.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value === "" ? null : value;
}

function number(form: FormData, name: string, fallback: number): number {
  const value = Number.parseFloat(String(form.get(name) ?? ""));
  return Number.isFinite(value) ? value : fallback;
}

function flag(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

/** Slug trafia do adresu i do pliku importu, więc nie wpuszczamy tu czego popadnie. */
function badSlug(value: string): string | null {
  if (value === "") return "Podaj nazwę w adresie (slug).";
  if (!SLUG.test(value)) return "W slugu tylko małe litery, cyfry i myślniki.";
  return null;
}

/**
 * Zajęty slug to jedyny błąd zapisu, który administrator poprawi sam, więc dostaje własne
 * zdanie. Postgres zwraca tu `23505` z nazwą indeksu — dla człowieka to nic nie znaczy.
 */
function saveError(error: { code?: string; message: string }, taken: string, fallback: string): string {
  return error.code === "23505" ? taken : dbErrorMessage(error, fallback);
}

/**
 * Kasowanie potwierdza się przepisaniem sluga. Okienko „na pewno?" klika się odruchowo,
 * a tu znikają też postępy dziecka — przepisanie nazwy wymaga spojrzenia na to, co się kasuje.
 */
function badConfirm(form: FormData, slug: string): string | null {
  return text(form, "confirm") === slug ? null : `Żeby usunąć, przepisz w polu potwierdzenia: ${slug}`;
}

export async function createCourseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const slug = text(form, "slug");
  const slugError = badSlug(slug);
  if (slugError) return { error: slugError };

  const title = text(form, "title");
  if (!title) return { error: "Podaj nazwę kursu." };

  const source = text(form, "source_lang");
  const target = text(form, "target_lang");
  if (source === target) return { error: "Język dziecka i język uczony muszą się różnić." };

  const { error } = await supabase.from("courses").insert({
    slug,
    title,
    description: optional(form, "description"),
    icon: optional(form, "icon"),
    source_lang: source,
    target_lang: target,
    sort_order: Math.trunc(number(form, "sort_order", 0)),
    is_published: flag(form, "is_published"),
  });

  if (error) return { error: saveError(error, "Kurs o takim adresie (slug) już jest.", "Nie udało się dodać kursu.") };

  refresh();
  return { ok: "Kurs gotowy. Teraz dodaj do niego dział." };
}

export async function updateCourseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  const title = text(form, "title");
  const slug = text(form, "slug");
  const slugError = badSlug(slug);
  if (!id) return { error: "Nie wiadomo, który kurs zmienić." };
  if (slugError) return { error: slugError };
  if (!title) return { error: "Podaj nazwę kursu." };

  const source = text(form, "source_lang");
  const target = text(form, "target_lang");
  if (source === target) return { error: "Język dziecka i język uczony muszą się różnić." };

  const { error } = await supabase
    .from("courses")
    .update({
      slug,
      title,
      description: optional(form, "description"),
      icon: optional(form, "icon"),
      // Zmianę języków w kursie, który ma już słówka, odrzuca wyzwalacz w bazie. Tu wysyłamy
      // je zawsze — zapis idzie jednym zapytaniem, więc nie ma gdzie indziej tego sprawdzić.
      source_lang: source,
      target_lang: target,
      sort_order: Math.trunc(number(form, "sort_order", 0)),
      is_published: flag(form, "is_published"),
    })
    .eq("id", id);

  if (error) return { error: saveError(error, "Kurs o takim adresie (slug) już jest.", "Nie udało się zapisać kursu.") };

  // Slug siedzi w adresie strony, więc po jego zmianie dotychczasowy adres prowadzi donikąd.
  if (slug !== text(form, "current_slug")) redirect(`/admin/kursy/${slug}`);

  refresh();
  return { ok: "Zapisane." };
}

/** Usunięcie kursu razem z zawartością i postępami dzieci. Kolejności pilnuje funkcja w bazie. */
export async function deleteCourseAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  if (!id) return { error: "Nie wiadomo, który kurs usunąć." };

  const confirmError = badConfirm(form, text(form, "current_slug"));
  if (confirmError) return { error: confirmError };

  const { error } = await supabase.rpc("admin_delete_course", { p_course: id });
  if (error) return { error: dbErrorMessage(error, "Nie udało się usunąć kursu.") };

  redirect("/admin/kursy");
}

export async function createUnitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const courseId = text(form, "course_id");
  const slug = text(form, "slug");
  const slugError = badSlug(slug);
  if (!courseId) return { error: "Nie wiadomo, do którego kursu dodać dział." };
  if (slugError) return { error: slugError };

  const title = text(form, "title");
  if (!title) return { error: "Podaj nazwę działu." };

  const { error } = await supabase.from("units").insert({
    course_id: courseId,
    slug,
    title,
    icon: optional(form, "icon"),
    color: optional(form, "color"),
    sort_order: Math.trunc(number(form, "sort_order", 1)),
    is_published: flag(form, "is_published"),
  });

  if (error) {
    return { error: saveError(error, "Dział o takim adresie (slug) już jest w tym kursie.", "Nie udało się dodać działu.") };
  }

  refresh();
  return { ok: "Dział gotowy." };
}

export async function updateUnitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  const title = text(form, "title");
  const slug = text(form, "slug");
  const slugError = badSlug(slug);
  if (!id) return { error: "Nie wiadomo, który dział zmienić." };
  if (slugError) return { error: slugError };
  if (!title) return { error: "Podaj nazwę działu." };

  const { error } = await supabase
    .from("units")
    .update({
      slug,
      title,
      icon: optional(form, "icon"),
      color: optional(form, "color"),
      sort_order: Math.trunc(number(form, "sort_order", 1)),
      is_published: flag(form, "is_published"),
    })
    .eq("id", id);

  if (error) {
    return { error: saveError(error, "Dział o takim adresie (slug) już jest w tym kursie.", "Nie udało się zapisać działu.") };
  }

  if (slug !== text(form, "current_slug")) redirect(`/admin/kursy/${text(form, "course_slug")}/${slug}`);

  refresh();
  return { ok: "Zapisane." };
}

/**
 * Usunięcie działu razem z lekcjami. Słówka zostają przy kursie — wisi na nich stan powtórek
 * i historia prób dziecka, i właśnie po to `lesson_items` ma na nich `restrict`.
 */
export async function deleteUnitAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  if (!id) return { error: "Nie wiadomo, który dział usunąć." };

  const confirmError = badConfirm(form, text(form, "current_slug"));
  if (confirmError) return { error: confirmError };

  const { error } = await supabase.from("units").delete().eq("id", id);
  if (error) return { error: dbErrorMessage(error, "Nie udało się usunąć działu.") };

  redirect(`/admin/kursy/${text(form, "course_slug")}`);
}

/**
 * Pola lekcji wspólne dla dodawania i edycji. Lekcja powtórkowa nie ma własnych zadań — zestaw
 * buduje `get_review_set` ze stanu powtórek dziecka, więc musi wiedzieć, który dział powtarza.
 */
function lessonFields(form: FormData, unitId: string) {
  const kind = text(form, "kind") === "review" ? "review" : "standard";
  return {
    title: text(form, "title"),
    icon: optional(form, "icon"),
    kind: kind as "standard" | "review",
    sort_order: Math.trunc(number(form, "sort_order", 1)),
    xp_reward: Math.trunc(number(form, "xp_reward", 50)),
    pass_threshold: Math.min(Math.max(number(form, "pass_threshold", 0.8), 0), 1),
    prerequisite_lesson_id: optional(form, "prerequisite_lesson_id"),
    review_scope_unit_id: kind === "review" ? unitId : null,
    is_published: flag(form, "is_published"),
  };
}

export async function createLessonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const unitId = text(form, "unit_id");
  const slug = text(form, "slug");
  const slugError = badSlug(slug);
  if (!unitId) return { error: "Nie wiadomo, do którego działu dodać lekcję." };
  if (slugError) return { error: slugError };

  const fields = lessonFields(form, unitId);
  if (!fields.title) return { error: "Podaj nazwę lekcji." };

  const { error } = await supabase.from("lessons").insert({ unit_id: unitId, slug, ...fields });

  if (error) return { error: dbErrorMessage(error, "Nie udało się dodać lekcji.") };

  refresh();
  return { ok: "Lekcja gotowa. Teraz dodaj do niej słówka." };
}

export async function updateLessonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  const unitId = text(form, "unit_id");
  if (!id || !unitId) return { error: "Nie wiadomo, którą lekcję zmienić." };

  const fields = lessonFields(form, unitId);
  if (!fields.title) return { error: "Podaj nazwę lekcji." };
  if (fields.prerequisite_lesson_id === id) return { error: "Lekcja nie może otwierać samej siebie." };

  const { error } = await supabase.from("lessons").update(fields).eq("id", id);

  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać lekcji.") };

  refresh();
  return { ok: "Zapisane." };
}

/**
 * Słówko razem z zadaniami. Zadań nie składa przeglądarka — robi to funkcja w bazie, w jednej
 * transakcji, więc lekcja nigdy nie zostaje ze słówkiem bez zadań ani odwrotnie.
 */
export async function addWordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const lessonId = text(form, "lesson_id");
  if (!lessonId) return { error: "Nie wiadomo, do której lekcji dodać słówko." };

  const source = text(form, "source");
  const target = text(form, "target");
  if (!source || !target) return { error: "Wpisz słowo w obu językach." };

  // Klucz jest naturalnym identyfikatorem słówka: przy ponownym imporcie decyduje, czy wpis
  // zostanie zaktualizowany, czy zdublowany. Gdy administrator go nie poda, układamy go sami.
  const key = text(form, "key") || autoKey(target);
  const tag = text(form, "tags");

  const { data, error } = await supabase.rpc("admin_add_word", {
    p_lesson: lessonId,
    p_key: key,
    p_source: source,
    p_target: target,
    p_tags: tag === "" ? [] : [tag],
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się dodać słówka.") };

  const added = (data as { exercises?: number } | null)?.exercises ?? 0;
  refresh();
  return {
    ok: added > 0 ? `Dodane: ${source} → ${target}, zadań: ${added}.` : `Zaktualizowane: ${source} → ${target}.`,
  };
}

/**
 * Poprawienie słówka już dodanego do lekcji. Klucza nie da się tu zmienić: po nim import
 * rozpoznaje, że to ten sam wpis, więc podmiana klucza zdublowałaby słówko przy następnym pliku.
 */
export async function updateWordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const conceptId = text(form, "concept_id");
  if (!conceptId) return { error: "Nie wiadomo, które słówko poprawić." };

  const source = text(form, "source");
  const target = text(form, "target");
  if (!source || !target) return { error: "Wpisz słowo w obu językach." };

  const tag = text(form, "tags");

  const { data, error } = await supabase.rpc("admin_update_word", {
    p_concept: conceptId,
    p_source: source,
    p_target: target,
    p_tags: tag === "" ? [] : [tag],
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się poprawić słówka.") };

  const result = data as { updated?: number; skipped?: number } | null;
  const skipped = result?.skipped ?? 0;
  refresh();
  return {
    ok:
      skipped > 0
        ? `Poprawione. Zadań ułożonych ręcznie nie ruszam — sprawdź je sam: ${skipped}.`
        : "Poprawione razem z zadaniami.",
  };
}

/** „Strawberry!" na „strawberry". Bez ogonków — klucz jest techniczny i ma być stabilny. */
function autoKey(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? `slowo-${Date.now()}` : base;
}

/** Zapisanie albo wypisanie ucznia z kursu. Wypisanie nie rusza postępów — wracają z zapisem. */
export async function setEnrollmentAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const userId = text(form, "user_id");
  const courseId = text(form, "course_id");
  if (!userId || !courseId) return { error: "Nie wiadomo, kogo zapisać." };

  if (flag(form, "enrolled")) {
    const { error } = await supabase.from("enrollments").delete().eq("user_id", userId).eq("course_id", courseId);
    if (error) return { error: dbErrorMessage(error, "Nie udało się wypisać z kursu.") };
    refresh();
    return { ok: "Wypisany z kursu." };
  }

  const { error } = await supabase.from("enrollments").insert({ user_id: userId, course_id: courseId });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać na kurs.") };

  refresh();
  return { ok: "Zapisany na kurs." };
}
