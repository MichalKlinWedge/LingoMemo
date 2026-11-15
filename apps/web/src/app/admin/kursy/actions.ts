"use server";

import { imageChoicePayloadSchema } from "@lingomemo/core";
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

  // Slug siedzi w adresie strony kursu, więc po jego zmianie dotychczasowy adres prowadzi donikąd.
  // Formularz z listy kursów nie podaje `current_slug`: tam slug nie jest w adresie i nie ma dokąd
  // przerzucać — wyrzucenie z listy na stronę kursu byłoby zaskoczeniem.
  const from = text(form, "current_slug");
  if (from !== "" && slug !== from) redirect(`/admin/kursy/${slug}`);

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

  // Slug siedzi w adresie strony działu, więc po jego zmianie dotychczasowy adres prowadzi
  // donikąd. Formularz z listy działów nie podaje `current_slug`: tam slug nie jest w adresie
  // i nie ma dokąd przerzucać — wyrzucenie z listy kursu byłoby zaskoczeniem.
  const from = text(form, "current_slug");
  if (from !== "" && slug !== from) redirect(`/admin/kursy/${text(form, "course_slug")}/${slug}`);

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
 * Usunięcie lekcji. Zadania, pozycje słówek w lekcji oraz postępy i sesje dzieci z tej lekcji
 * idą kaskadą — wszystkie klucze obce wskazujące lekcję mają `on delete cascade`, więc wystarczy
 * jedno zapytanie pod polityką `lessons_admin`.
 *
 * Co zostaje: słówka (wiszą na kursie, razem ze stanem powtórek dziecka) i punkty w `points_ledger`.
 * Lekcja, która otwierała się po tej, traci warunek wstępny (`on delete set null`) i staje się
 * dostępna od razu — o tym mówi ostrzeżenie w panelu.
 */
export async function deleteLessonAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const id = text(form, "id");
  if (!id) return { error: "Nie wiadomo, którą lekcję usunąć." };

  const confirmError = badConfirm(form, text(form, "current_slug"));
  if (confirmError) return { error: confirmError };

  const { error } = await supabase.from("lessons").delete().eq("id", id);
  if (error) return { error: dbErrorMessage(error, "Nie udało się usunąć lekcji.") };

  redirect(`/admin/kursy/${text(form, "course_slug")}/${text(form, "unit_slug")}`);
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

/**
 * Zdjęcie słówka z lekcji razem z jej zadaniami dla tego słówka. Samo słówko zostaje przy
 * kursie, bo wisi na nim stan powtórek dziecka — chyba że nikt go jeszcze nie widział i nie
 * występuje w żadnej innej lekcji; wtedy baza kasuje je całkiem, żeby nie zostawiać w kursie
 * niewidocznego śmiecia. Który przypadek zaszedł, mówi odpowiedź funkcji.
 */
export async function removeWordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const lessonId = text(form, "lesson_id");
  const conceptId = text(form, "concept_id");
  if (!lessonId || !conceptId) return { error: "Nie wiadomo, które słówko usunąć." };

  const { data, error } = await supabase.rpc("admin_remove_word", {
    p_lesson: lessonId,
    p_concept: conceptId,
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się usunąć słówka.") };

  const result = data as { removed?: string; exercises?: number } | null;
  refresh();
  return {
    ok:
      result?.removed === "course"
        ? `Słówko usunięte z kursu razem z zadaniami (${result?.exercises ?? 0}) — nikt go jeszcze nie przerabiał.`
        : `Słówko zdjęte z lekcji razem z jej zadaniami (${result?.exercises ?? 0}). Zostaje przy kursie, bo jest już w powtórkach albo w innej lekcji.`,
  };
}

/** Nazwy pól po polsku do komunikatu z zoda — „options: najwyżej cztery" nic nie mówi. */
const IMAGE_FIELD: Record<string, string> = {
  prompt: "Słowo",
  options: "Obrazki",
  answer: "Poprawny obrazek",
  speak: "Słowo do przeczytania",
  lang: "Język",
};

/**
 * Zadanie z obrazkiem. Jedyne zadanie składane w panelu z ręki — reszta wchodzi importem.
 *
 * Idzie zwykłym `insert` pod polityką `exercises_admin`: to jeden wiersz, więc nie ma tu czego
 * pakować w transakcję. Kształt payloadu sprawdza ten sam schemat zoda, co import, a na końcu
 * jeszcze raz `validate_exercise_payload` w bazie.
 */
export async function addImageTaskAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const lessonId = text(form, "lesson_id");
  if (!lessonId) return { error: "Nie wiadomo, do której lekcji dodać zadanie." };

  const prompt = text(form, "prompt");
  const options = form
    .getAll("options")
    .map((value) => String(value).trim())
    .filter((value) => value !== "");

  // Bez zaznaczonego obrazka zod powiedziałby tylko „nie może być puste" przy ścieżce pliku.
  if (text(form, "answer") === "") return { error: "Zaznacz, który obrazek jest poprawny." };

  const parsed = imageChoicePayloadSchema.safeParse({
    prompt,
    options,
    answer: text(form, "answer"),
    // Głos czyta to samo słowo, które widać — osobnego pola nie ma po co pokazywać.
    ...(flag(form, "speak") ? { speak: prompt, lang: text(form, "lang") } : {}),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const label = IMAGE_FIELD[String(issue?.path?.[0] ?? "")];
    const message = issue?.message ?? "Sprawdź pola zadania.";
    return { error: label ? `${label}: ${message}` : message };
  }

  // Zadanie ląduje na końcu lekcji. Kolejność zmienia się potem importem — w panelu nie ma
  // jeszcze przestawiania zadań.
  const { data: last } = await supabase
    .from("exercises")
    .select("sort_order")
    .eq("lesson_id", lessonId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("exercises").insert({
    lesson_id: lessonId,
    type: "image_choice",
    sort_order: (last?.sort_order ?? 0) + 1,
    // Bez słówka zadanie nie liczy się do powtórek — stan FSRS wisi na słówku, nie na zadaniu.
    concept_id: optional(form, "concept_id"),
    payload: parsed.data,
    points: 10,
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się dodać zadania z obrazkiem.") };

  refresh();
  return { ok: `Zadanie gotowe: „${parsed.data.prompt}" i ${parsed.data.options.length} obrazki do wyboru.` };
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

/**
 * Nowa kolejność lekcji w dziale. Identyfikatory idą jednym ciągiem, a baza przepisuje numery
 * w jednej transakcji — przy osobnych zapytaniach błąd w połowie zostawiłby dwie lekcje
 * na tej samej pozycji, a mapa kursu układa je właśnie po tej kolumnie.
 */
export async function reorderLessonsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const unitId = text(form, "parent_id") || text(form, "unit_id");
  const ids = text(form, "ids").split(",").filter(Boolean);
  if (!unitId || ids.length === 0) return { error: "Nie wiadomo, które lekcje przestawić." };

  const { error } = await supabase.rpc("admin_reorder_lessons", { p_unit: unitId, p_ids: ids });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać kolejności.") };

  refresh();
  return { ok: "Kolejność zapisana." };
}

/** To samo piętro wyżej: nowa kolejność działów w kursie. */
export async function reorderUnitsAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase } = await requireAdmin();

  const courseId = text(form, "parent_id");
  const ids = text(form, "ids").split(",").filter(Boolean);
  if (!courseId || ids.length === 0) return { error: "Nie wiadomo, które działy przestawić." };

  const { error } = await supabase.rpc("admin_reorder_units", { p_course: courseId, p_ids: ids });
  if (error) return { error: dbErrorMessage(error, "Nie udało się zapisać kolejności.") };

  refresh();
  return { ok: "Kolejność zapisana." };
}
