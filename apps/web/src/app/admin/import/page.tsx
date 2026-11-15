import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Shell } from "@/components/shell";

import { ImportForm } from "./import-form";

export default function ImportPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Import lekcji"
        intro="Wklej plik z lekcją. Nazwy (slug kursu, działu i lekcji oraz klucze słówek) decydują
               o tym, czy powstanie nowa lekcja, czy zostanie nadpisana istniejąca."
      />
      <ImportForm />
    </Shell>
  );
}
