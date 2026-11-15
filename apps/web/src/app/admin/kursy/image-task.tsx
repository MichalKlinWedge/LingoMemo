"use client";

import { useActionState, useId, useState } from "react";

import { addImageTaskAction } from "@/app/admin/kursy/actions";
import { Form, Status, SubmitButton, type FormState } from "@/components/forms";
import { createClient } from "@/lib/supabase/client";

/** Jeden kafelek zadania: ścieżka pliku w buckecie i to, czy właśnie się wgrywa. */
type Slot = { id: number; path: string; busy: boolean };

const pusty = (id: number): Slot => ({ id, path: "", busy: false });
const POCZATEK: Slot[] = [pusty(1), pusty(2)];

/** Nazwa pliku bez ogonków i spacji — ścieżka trafia potem wprost do payloadu zadania. */
function czystaNazwa(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, "-");
}

/**
 * Zadanie z obrazkiem składane w panelu: słowo u góry, od dwóch do czterech obrazków pod spodem,
 * jeden zaznaczony jako poprawny.
 *
 * Obrazki lecą do Storage prosto z przeglądarki — tak samo jak w panelu „Obrazki" — bo plik
 * 2 MB przez Server Action przechodzi tylko po podniesieniu limitu żądania. Do akcji jedzie
 * potem sama ścieżka. Można też wkleić ścieżkę pliku wgranego wcześniej.
 */
export function AddImageTask({
  lessonId,
  words,
  speakLang,
  speakLabel,
}: {
  lessonId: string;
  /** Słówka lekcji — bez wskazania słówka zadanie nie liczy się do powtórek. */
  words: { id: string; label: string }[];
  /** Kod języka dla syntezatora mowy, np. „en-GB". Bez niego nie ma czym przeczytać słowa. */
  speakLang: string | null;
  speakLabel: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(addImageTaskAction, {});
  const [slots, setSlots] = useState<Slot[]>(POCZATEK);
  const [answer, setAnswer] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const wordId = useId();
  const promptId = useId();
  // `createBrowserClient` oddaje wciąż tę samą instancję, więc wołanie go przy renderze nic
  // nie kosztuje i nie ma po co trzymać klienta w stanie.
  const storage = createClient().storage.from("lesson-media");

  // Po udanym dodaniu zaczynamy od czystego formularza. Pola w stanie Reacta nie czyszczą się
  // same — `form.reset()` ich nie dotyka. Stan poprawiamy w trakcie renderowania, nie w efekcie.
  const [poprzedni, setPoprzedni] = useState(state);
  if (state !== poprzedni) {
    setPoprzedni(state);
    if (state.ok) {
      setSlots(POCZATEK);
      setAnswer("");
      setUploadError(null);
    }
  }

  const zmien = (id: number, zmiana: Partial<Slot>) =>
    setSlots((było) => było.map((slot) => (slot.id === id ? { ...slot, ...zmiana } : slot)));

  const wgraj = async (id: number, file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    zmien(id, { busy: true });

    const sciezka = `${new Date().getFullYear()}/${czystaNazwa(file.name)}`;
    const { error } = await storage.upload(sciezka, file, { upsert: true, contentType: file.type });

    if (error) {
      setUploadError(`${file.name}: ${error.message}`);
      zmien(id, { busy: false });
      return;
    }

    // Poprawnego obrazka nie zaznaczamy sami: zadanie z cicho ustawionym złym kluczem odpowiedzi
    // wygląda na ekranie normalnie i wychodzi dopiero wtedy, gdy dziecko dostanie błąd za dobrą
    // odpowiedź. Administrator musi kliknąć „poprawny" świadomie.
    setSlots((było) => było.map((slot) => (slot.id === id ? { ...slot, path: sciezka, busy: false } : slot)));
  };

  const dodaj = () =>
    setSlots((było) => (było.length >= 4 ? było : [...było, pusty(Math.max(...było.map((s) => s.id)) + 1)]));

  const usun = (id: number) => {
    if (slots.length <= 2) return;
    const zostaje = slots.filter((slot) => slot.id !== id);
    setSlots(zostaje);
    if (!zostaje.some((slot) => slot.path === answer)) setAnswer("");
  };

  const gotowe = slots.filter((slot) => slot.path !== "").length;

  return (
    <section className="card flex flex-col gap-4 p-6">
      <h2 className="card-title">Nowe zadanie z obrazkiem</h2>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Dziecko widzi słowo i dotyka obrazka, który je pokazuje. Pierwsze zadanie, które zrobi,
        zanim nauczy się czytać po {speakLabel.toLowerCase()}.
      </p>

      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="lesson_id" value={lessonId} />
        {speakLang !== null && <input type="hidden" name="lang" value={speakLang} />}

        <label className="flex flex-col gap-2" htmlFor={promptId}>
          <span className="font-semibold">Słowo nad obrazkami</span>
          <input id={promptId} className="field" name="prompt" required placeholder="dog" />
        </label>

        {speakLang !== null && (
          <label className="flex items-center gap-3">
            <input type="checkbox" name="speak" className="h-6 w-6" />
            <span className="font-semibold">Przeczytaj słowo głosem ({speakLang})</span>
          </label>
        )}

        <label className="flex flex-col gap-2" htmlFor={wordId}>
          <span className="font-semibold">Słówko lekcji</span>
          <select id={wordId} className="field" name="concept_id" defaultValue="">
            <option value="">— bez słówka (zadanie nie wejdzie do powtórek)</option>
            {words.map((word) => (
              <option key={word.id} value={word.id}>
                {word.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">Obrazki (od dwóch do czterech)</legend>

          {slots.map((slot, index) => (
            <div key={slot.id} className="flex flex-wrap items-center gap-3 rounded-2xl border-2 p-3"
                 style={{ borderColor: "var(--line)" }}>
              {slot.path === "" ? (
                <span
                  className="flex items-center justify-center rounded-xl text-2xl"
                  style={{ width: "4rem", height: "4rem", background: "var(--color-zinc-200)" }}
                  aria-hidden
                >
                  {slot.busy ? "…" : "🖼"}
                </span>
              ) : (
                // Zwykły <img>, nie next/image: pliki wgrywa administrator w trakcie działania
                // aplikacji, więc nie ma ich czym zoptymalizować przy budowaniu.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={storage.getPublicUrl(slot.path).data.publicUrl}
                  alt=""
                  style={{ width: "4rem", height: "4rem", objectFit: "contain" }}
                />
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <input
                  type="file"
                  className="field"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  disabled={slot.busy}
                  aria-label={`Wgraj obrazek ${index + 1}`}
                  onChange={(event) => void wgraj(slot.id, event.target.files?.[0])}
                />
                <input
                  className="field font-mono text-base"
                  name="options"
                  value={slot.path}
                  placeholder="albo wklej ścieżkę: 2026/pies.png"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Ścieżka obrazka ${index + 1}`}
                  onChange={(event) => zmien(slot.id, { path: event.target.value })}
                />
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="answer"
                  className="h-6 w-6"
                  value={slot.path}
                  checked={slot.path !== "" && answer === slot.path}
                  disabled={slot.path === ""}
                  onChange={() => setAnswer(slot.path)}
                />
                <span className="font-semibold">poprawny</span>
              </label>

              {slots.length > 2 && (
                <button
                  type="button"
                  className="chip"
                  style={{ minHeight: "2.75rem" }}
                  onClick={() => usun(slot.id)}
                  aria-label={`Usuń obrazek ${index + 1}`}
                >
                  Usuń
                </button>
              )}
            </div>
          ))}

          {slots.length < 4 && (
            <button type="button" className="btn-secondary self-start" onClick={dodaj}>
              Dodaj obrazek
            </button>
          )}
        </fieldset>

        {uploadError && <p className="msg-error">{uploadError}</p>}
        <Status state={state} />
        <SubmitButton pendingLabel="Dodaję…">
          {gotowe < 2 ? "Dodaj zadanie (wgraj dwa obrazki)" : "Dodaj zadanie"}
        </SubmitButton>
      </Form>
    </section>
  );
}
