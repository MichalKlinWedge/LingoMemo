"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { refreshMediaAction } from "./actions";

type Wgrany = { nazwa: string; sciezka: string; adres: string };

/**
 * Wgrywanie obrazków do słówek. Plik leci prosto z przeglądarki do Storage — nie przechodzi
 * przez serwer aplikacji, więc nie dotyka limitu wielkości żądania w Server Action.
 *
 * Wgrywać może tylko administrator (polityka na `storage.objects`), a odczyt jest publiczny:
 * obrazek jabłka nie jest tajemnicą, a dzięki temu działa zwykły `<img>` bez podpisywania
 * adresów, które i tak wygasają.
 */
export function Upload() {
  const [wgrane, setWgrane] = useState<Wgrany[]>([]);
  const [blad, setBlad] = useState<string | null>(null);
  const [trwa, setTrwa] = useState(false);

  const handle = async (files: FileList | null) => {
    if (files === null || files.length === 0) return;
    setTrwa(true);
    setBlad(null);
    const supabase = createClient();
    const dodane: Wgrany[] = [];

    for (const file of Array.from(files)) {
      // Nazwa bez polskich znaków i spacji — ścieżka trafia potem wprost do JSON-a lekcji.
      const czysta = file.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9.]+/g, "-");
      const sciezka = `${new Date().getFullYear()}/${czysta}`;

      const { error } = await supabase.storage
        .from("lesson-media")
        .upload(sciezka, file, { upsert: true, contentType: file.type });

      if (error) {
        setBlad(`${file.name}: ${error.message}`);
        break;
      }

      const { data } = supabase.storage.from("lesson-media").getPublicUrl(sciezka);
      dodane.push({ nazwa: file.name, sciezka, adres: data.publicUrl });
    }

    setWgrane((było) => [...dodane, ...było]);
    setTrwa(false);
    // Plik poszedł prosto do Storage, z pominięciem serwera, więc lista biblioteki niżej
    // nic o nim nie wie — trzeba poprosić serwer o ponowne wyliczenie strony.
    if (dodane.length > 0) await refreshMediaAction();
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="font-semibold">Wybierz obrazki</span>
        <input
          type="file"
          className="field"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          multiple
          disabled={trwa}
          onChange={(event) => void handle(event.target.files)}
        />
        <span className="text-base text-zinc-600 dark:text-zinc-400">
          Najwyżej 2 MB na plik. Ścieżkę wklejasz potem do pola <code>image</code> słówka.
        </span>
      </label>

      {trwa && <p className="text-zinc-500">Wgrywam…</p>}
      {blad && <p className="msg-error">{blad}</p>}

      {wgrane.length > 0 && (
        <ul className="flex flex-col gap-3">
          {wgrane.map((plik) => (
            <li key={plik.sciezka} className="card flex items-center gap-4 p-4">
              {/* Zwykły <img>, nie next/image: to są obrazki wgrywane w trakcie działania
                  aplikacji, więc i tak nie da się ich zoptymalizować przy budowaniu. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={plik.adres} alt="" width={64} height={64} style={{ objectFit: "contain" }} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-base text-zinc-600 dark:text-zinc-400">{plik.nazwa}</span>
                <input
                  className="field font-mono text-base"
                  readOnly
                  value={plik.sciezka}
                  onFocus={(event) => event.currentTarget.select()}
                  aria-label="Ścieżka do wklejenia w pliku lekcji"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
