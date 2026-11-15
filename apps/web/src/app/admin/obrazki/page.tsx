import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Shell } from "@/components/shell";

import { Upload } from "./upload";

export default function ImagesPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Obrazki"
        intro="Obrazki do słówek. Po wgraniu skopiuj ścieżkę i wklej ją do pola „image” w pliku lekcji."
      />
      <Upload />
    </Shell>
  );
}
