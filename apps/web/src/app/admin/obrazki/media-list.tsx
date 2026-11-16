"use client";

import { useActionState } from "react";

import { type FormState, Status, SubmitButton } from "@/components/forms";

import { deleteMediaAction } from "./actions";

export type MediaFile = {
  path: string;
  url: string;
  size: number;
  updatedAt: string | null;
  /** Ile słówek i zadań wskazuje ten plik. Zero znaczy „nikt", a nie „nie wiem". */
  concepts: number;
  exercises: number;
};

function kilobajty(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;
}

function uzycie(file: MediaFile): string | null {
  const czesci: string[] = [];
  if (file.concepts > 0) czesci.push(`${file.concepts} słówko/słówka`);
  if (file.exercises > 0) czesci.push(`${file.exercises} zadanie/zadania`);
  return czesci.length === 0 ? null : czesci.join(" · ");
}

/**
 * Jeden plik biblioteki. Kasowanie przez Server Action, nie przez przeglądarkę: dzięki temu
 * lista odświeża się sama, a nie dopiero po ręcznym przeładowaniu strony.
 */
function Plik({ file }: { file: MediaFile }) {
  const [state, action] = useActionState<FormState, FormData>(deleteMediaAction, {});
  const w_uzyciu = uzycie(file);

  return (
    <li className="card flex flex-col gap-3 p-4">
      {/* Zwykły <img>: pliki wgrywa administrator w trakcie działania aplikacji, więc nie ma
          ich czym zoptymalizować przy budowaniu. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={file.url}
        alt=""
        style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", background: "var(--color-zinc-100)" }}
        className="rounded-xl"
      />

      {/* Pole tekstowe, nie napis: ścieżkę trzeba zaznaczyć i skopiować do pliku lekcji. */}
      <input className="field font-mono text-sm" readOnly value={file.path} aria-label={`Ścieżka pliku ${file.path}`} />

      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        {kilobajty(file.size)}
        {file.updatedAt ? ` · ${new Date(file.updatedAt).toLocaleDateString("pl-PL")}` : ""}
      </span>

      <span className={w_uzyciu ? "chip" : "text-sm text-zinc-500"}>
        {w_uzyciu ? `W użyciu: ${w_uzyciu}` : "Nieużywany"}
      </span>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="path" value={file.path} />
        <input type="hidden" name="used" value={w_uzyciu ? "1" : "0"} />
        {w_uzyciu && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" className="mt-1 h-5 w-5" />
            <span>
              Wiem, że zniknie z miejsc, w których jest użyty — dziecko zobaczy tam puste miejsce.
            </span>
          </label>
        )}
        <Status state={state} />
        <SubmitButton pendingLabel="Kasuję…" variant="danger">
          Usuń
        </SubmitButton>
      </form>
    </li>
  );
}

export function MediaList({ files }: { files: MediaFile[] }) {
  if (files.length === 0) {
    return (
      <p className="text-zinc-600 dark:text-zinc-400">
        W bibliotece nie ma jeszcze żadnego pliku. Wgraj pierwszy powyżej.
      </p>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <Plik key={file.path} file={file} />
      ))}
    </ul>
  );
}
