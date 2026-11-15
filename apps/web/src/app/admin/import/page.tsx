import { PageHeader } from "@/components/page-header";
import { Shell } from "@/components/shell";

import { ImportForm } from "./import-form";

export default function ImportPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: "/admin", label: "Panel" }}
        title="Import lekcji"
        intro="Wklej plik z lekcją. Nazwy (slug kursu, działu i lekcji oraz klucze słówek) decydują
               o tym, czy powstanie nowa lekcja, czy zostanie nadpisana istniejąca."
      />
      <ImportForm />
    </Shell>
  );
}
