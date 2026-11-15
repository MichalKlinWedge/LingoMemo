"use client";

import { useActionState, useState } from "react";

import { type ImportState, previewImport, runImport } from "./import-actions";

const PRZYKLAD = `{
  "schemaVersion": 1,
  "course": "pl-en-starter",
  "unit": { "slug": "jedzenie", "title": "Jedzenie", "icon": "🍎", "sortOrder": 3 },
  "lesson": {
    "slug": "owoce",
    "title": "Owoce",
    "icon": "🍏",
    "sortOrder": 1,
    "prerequisiteLessonSlug": null
  },
  "concepts": [
    {
      "key": "food.apple",
      "tags": ["🍎"],
      "terms": {
        "pl": [{ "text": "jabłko", "pos": "noun" }],
        "en": [{ "text": "apple", "pos": "noun", "forms": [{ "label": "plural", "text": "apples" }] }]
      }
    },
    {
      "key": "food.pear",
      "tags": ["🍐"],
      "terms": {
        "pl": [{ "text": "gruszka", "pos": "noun" }],
        "en": [{ "text": "pear", "pos": "noun" }]
      }
    }
  ],
  "exercises": [
    {
      "type": "translate_ab",
      "conceptKey": "food.apple",
      "payload": { "prompt": "jabłko", "accepted": ["apple"], "options": ["apple", "pear", "bread"] }
    },
    {
      "type": "translate_ba",
      "conceptKey": "food.pear",
      "payload": { "prompt": "pear", "accepted": ["gruszka"] }
    },
    {
      "type": "listening",
      "conceptKey": "food.apple",
      "payload": { "speak": "apple", "lang": "en-GB", "accepted": ["apple"] }
    }
  ]
}`;

function Report({ state }: { state: ImportState }) {
  return (
    <>
      {state.error && (
        <div className="msg-error flex flex-col gap-2">
          <span>{state.error}</span>
          {state.issues && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-base font-normal">
              {state.issues.map((issue) => (
                <li key={issue}>
                  <code>{issue}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state.ok && <p className="msg-ok">{state.ok}</p>}

      {state.warnings && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-base">
          {state.warnings.map((warning) => (
            <li key={warning}>⚠️ {warning}</li>
          ))}
        </ul>
      )}

      {state.preview && (
        <dl className="card grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-base">
          <dt className="text-zinc-600 dark:text-zinc-400">Kurs</dt>
          <dd>
            {state.preview.course} {!state.preview.courseExists && "— nie ma takiego kursu!"}
          </dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Dział</dt>
          <dd>{state.preview.unit}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Lekcja</dt>
          <dd>
            {state.preview.lesson} {state.preview.lessonExists && "(zostanie nadpisana)"}
          </dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Słówka</dt>
          <dd>{state.preview.concepts}</dd>
          <dt className="text-zinc-600 dark:text-zinc-400">Zadania</dt>
          <dd>
            {state.preview.exercises} ({state.preview.types.join(", ")})
          </dd>
        </dl>
      )}
    </>
  );
}

/**
 * Dwa przyciski na jednym polu tekstowym: podgląd niczego nie zapisuje, import zapisuje całość
 * jednym wywołaniem. Osobne akcje, bo mylny klik „Importuj” zamiast „Sprawdź” ma kosztować
 * najwyżej nadpisanie lekcji, a nie połowiczny zapis.
 */
export function ImportForm() {
  const [payload, setPayload] = useState("");
  const [previewState, preview, previewPending] = useActionState<ImportState, FormData>(previewImport, {});
  const [importState, doImport, importPending] = useActionState<ImportState, FormData>(runImport, {});

  const state = importState.ok || importState.error ? importState : previewState;
  const pending = previewPending || importPending;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Plik lekcji (JSON)</span>
        <textarea
          name="payload"
          className="field font-mono"
          style={{ minHeight: "22rem", fontSize: "0.95rem", lineHeight: 1.5 }}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          spellCheck={false}
          placeholder="Wklej tutaj zawartość pliku…"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <form action={preview}>
          <input type="hidden" name="payload" value={payload} />
          <button type="submit" className="btn-secondary" disabled={pending}>
            Sprawdź na sucho
          </button>
        </form>
        <form action={doImport}>
          <input type="hidden" name="payload" value={payload} />
          <button type="submit" className="btn-primary" disabled={pending}>
            {importPending ? "Importuję…" : "Importuj"}
          </button>
        </form>
        <button type="button" className="btn-secondary" onClick={() => setPayload(PRZYKLAD)} disabled={pending}>
          Wstaw przykład
        </button>
      </div>

      <Report state={state} />
    </div>
  );
}
