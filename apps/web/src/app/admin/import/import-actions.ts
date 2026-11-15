"use server";

import { refresh } from "next/cache";

import { ENTRIES, EXERCISES, formatIssues, lessonImportSchema, plural, WORDS } from "@lingomemo/core";
import type { Json } from "@lingomemo/db";

import { requireAdmin } from "@/lib/auth";
import { dbErrorMessage } from "@/lib/db-error";

export type ImportState = {
  error?: string;
  ok?: string;
  /** Lista problemów ze ścieżką, np. `exercises[3].payload.answer: …`. */
  issues?: string[];
  preview?: {
    course: string;
    unit: string;
    lesson: string;
    concepts: number;
    exercises: number;
    types: string[];
    lessonExists: boolean;
    courseExists: boolean;
  };
  warnings?: string[];
};

/** Wspólne dla podglądu i zapisu: sparsuj JSON i sprawdź go schematem. */
function parsePayload(raw: string) {
  if (raw.trim() === "") return { error: "Wklej plik z lekcją." } as const;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { error: `To nie jest poprawny JSON: ${(error as Error).message}` } as const;
  }

  const result = lessonImportSchema.safeParse(parsed);
  if (!result.success) {
    return { error: "Plik nie zgadza się z formatem.", issues: formatIssues(result.error) } as const;
  }
  return { data: result.data } as const;
}

/**
 * Podgląd na sucho: sprawdza plik i mówi, co się stanie — czy lekcja powstanie, czy zostanie
 * nadpisana. Nie zapisuje niczego.
 */
export async function previewImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase } = await requireAdmin("/admin/import");
  const parsed = parsePayload(String(form.get("payload") ?? ""));
  if ("error" in parsed) return { error: parsed.error, issues: parsed.issues };

  const data = parsed.data;

  const { data: course } = await supabase.from("courses").select("id, title").eq("slug", data.course).maybeSingle();
  let lessonExists = false;
  if (course) {
    const { data: unit } = await supabase
      .from("units")
      .select("id")
      .eq("course_id", course.id)
      .eq("slug", data.unit.slug)
      .maybeSingle();
    if (unit) {
      const { data: lesson } = await supabase
        .from("lessons")
        .select("id")
        .eq("unit_id", unit.id)
        .eq("slug", data.lesson.slug)
        .maybeSingle();
      lessonExists = lesson !== null;
    }
  }

  return {
    ok: lessonExists
      ? "Plik jest poprawny. Lekcja o tej nazwie już istnieje — import ją nadpisze."
      : "Plik jest poprawny. Powstanie nowa lekcja.",
    preview: {
      course: course?.title ?? data.course,
      unit: data.unit.title,
      lesson: data.lesson.title,
      concepts: data.concepts.length,
      exercises: data.exercises.length,
      types: [...new Set(data.exercises.map((item) => item.type))],
      lessonExists,
      courseExists: course !== null,
    },
  };
}

/** Zapis. Cała treść wchodzi jednym wywołaniem, więc albo wejdzie w całości, albo wcale. */
export async function runImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase } = await requireAdmin("/admin/import");
  const parsed = parsePayload(String(form.get("payload") ?? ""));
  if ("error" in parsed) return { error: parsed.error, issues: parsed.issues };

  const { data, error } = await supabase.rpc("admin_import_lesson", {
    p_payload: parsed.data as unknown as Json,
  });

  if (error) return { error: dbErrorMessage(error, "Nie udało się zaimportować lekcji.") };

  const report = data as unknown as {
    concepts: number;
    exercises: number;
    terms: number;
    warnings: string[];
  };

  refresh();
  return {
    ok: `Gotowe: ${plural(report.concepts, WORDS)}, ${plural(report.terms, ENTRIES)}, ${plural(report.exercises, EXERCISES)}.`,
    warnings: report.warnings?.length > 0 ? report.warnings : undefined,
  };
}
