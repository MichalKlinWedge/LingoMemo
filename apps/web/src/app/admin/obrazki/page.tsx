import { Suspense } from "react";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { BUCKET } from "./bucket";
import { MediaList, type MediaFile } from "./media-list";
import { Upload } from "./upload";

/** Ile plików pokazujemy z jednego katalogu. Biblioteka ma być do przejrzenia, nie do przewijania. */
const LIMIT = 200;

async function Media() {
  const { supabase } = await requireAdmin("/admin/obrazki");
  const storage = supabase.storage.from(BUCKET);

  // Storage nie umie listować rekurencyjnie: najpierw katalogi (pliki wgrywarka wkłada
  // do katalogu z rokiem), potem zawartość każdego z nich.
  const { data: korzen, error } = await storage.list("", { limit: LIMIT, sortBy: { column: "name", order: "desc" } });

  const katalogi = (korzen ?? []).filter((wpis) => wpis.id === null).map((wpis) => wpis.name);
  const wPodkatalogach = await Promise.all(
    katalogi.map(async (katalog) => {
      const { data } = await storage.list(katalog, { limit: LIMIT, sortBy: { column: "name", order: "asc" } });
      return (data ?? []).filter((wpis) => wpis.id !== null).map((wpis) => ({ katalog, wpis }));
    }),
  );

  const wszystkie = [
    ...(korzen ?? []).filter((wpis) => wpis.id !== null).map((wpis) => ({ katalog: "", wpis })),
    ...wPodkatalogach.flat(),
  ];

  const sciezki = wszystkie.map(({ katalog, wpis }) => (katalog === "" ? wpis.name : `${katalog}/${wpis.name}`));

  // Użycie liczy baza jednym zapytaniem: przy każdym pliku osobne byłoby tyle zapytań,
  // ile obrazków w bibliotece.
  const { data: usage } = await supabase.rpc("media_usage", { p_paths: sciezki });
  const uzycieDla = new Map((usage ?? []).map((row) => [row.path, row]));

  const files: MediaFile[] = wszystkie.map(({ wpis }, index) => {
    const path = sciezki[index]!;
    const row = uzycieDla.get(path);
    return {
      path,
      url: storage.getPublicUrl(path).data.publicUrl,
      size: (wpis.metadata?.size as number | undefined) ?? 0,
      updatedAt: wpis.updated_at ?? wpis.created_at ?? null,
      concepts: row?.concepts ?? 0,
      exercises: row?.exercises ?? 0,
    };
  });

  // Najnowsze na górze: po wgraniu paczki obrazków administrator szuka właśnie ich.
  files.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Obrazki"
        intro="Biblioteka plików do słówek i zadań „wskaż obrazek”. Ścieżkę wklejasz do pliku lekcji albo wybierasz przy słówku na stronie lekcji."
      />

      <section className="card flex flex-col gap-4 p-6">
        <h2 className="card-title">Wgraj nowe</h2>
        <Upload />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="card-title">W bibliotece ({files.length})</h2>
        {error && <p className="msg-error">{dbLoadError(error)}</p>}
        <MediaList files={files} />
      </section>
    </>
  );
}

export default function ImagesPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Media />
      </Suspense>
    </Shell>
  );
}
