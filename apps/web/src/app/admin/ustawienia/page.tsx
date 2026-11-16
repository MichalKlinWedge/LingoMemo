import { Suspense } from "react";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";

import { LessonSettings } from "./settings-panel";

async function Settings() {
  const { supabase } = await requireAdmin("/admin/ustawienia");

  // Wartość domyślna taka sama jak w lekcji: brakujący wiersz nie ma dawać innego czasu
  // w panelu niż na ekranie dziecka.
  const { data: autoNextSeconds } = await supabase.rpc("setting_int", {
    p_key: "auto_next_seconds",
    p_default: 6,
  });

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Ustawienia"
        intro="Pokrętła całej aplikacji. Zmiana działa od razu, dla wszystkich dzieci."
      />
      <LessonSettings autoNextSeconds={autoNextSeconds ?? 6} />
    </>
  );
}

export default function SettingsPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Settings />
      </Suspense>
    </Shell>
  );
}
