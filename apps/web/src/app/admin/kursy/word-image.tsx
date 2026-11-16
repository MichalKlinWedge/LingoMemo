"use client";

import { useActionState, useState } from "react";

import { mediaUrl } from "@/components/exercises/media";
import { type FormState, Status, SubmitButton } from "@/components/forms";

import { setWordImageAction } from "./image-actions";

/**
 * Obrazek przy słówku, ustawiany ścieżką z biblioteki „Obrazki". Dotąd dało się go przypisać
 * wyłącznie plikiem importu, więc dorosły poprawiający słówko w panelu nie miał jak dołożyć
 * mu obrazka.
 *
 * Podgląd rysujemy z tego, co wpisane, jeszcze przed zapisem: literówka w ścieżce wygląda
 * wtedy jak brak obrazka, a nie jak zapisana wartość, której nigdzie nie widać.
 */
export function WordImage({ conceptId, imagePath }: { conceptId: string; imagePath: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(setWordImageAction, {});
  const [path, setPath] = useState(imagePath ?? "");
  const url = mediaUrl(path);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="concept" value={conceptId} />

      <span
        className="flex items-center justify-center rounded-xl"
        style={{ width: "3.5rem", height: "3.5rem", background: "var(--color-zinc-100)" }}
      >
        {url === null ? (
          <span className="text-2xl" aria-hidden>
            🖼
          </span>
        ) : (
          // Zwykły <img>: plik wgrywa administrator w trakcie działania aplikacji.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        )}
      </span>

      <label className="flex min-w-48 flex-1 flex-col gap-2">
        <span className="font-semibold">Obrazek (ścieżka z „Obrazków”)</span>
        <input
          className="field font-mono text-base"
          name="image_path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="2026/jablko.png"
          autoComplete="off"
        />
      </label>

      <SubmitButton pendingLabel="Zapisuję…">Zapisz obrazek</SubmitButton>
      <Status state={state} />
    </form>
  );
}
