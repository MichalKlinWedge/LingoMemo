import Link from "next/link";

import { Shell } from "@/components/shell";

/**
 * Strona startowa na czas Etapu 0 — potwierdza, że aplikacja wstaje i motyw się ładuje.
 * W Etapie 3 zastąpi ją wybór kursu i mapa działów.
 */
export default function HomePage() {
  return (
    <Shell>
      <h1>LingoMemo</h1>
      <p>Nauka słówek i zwrotów. Szkielet aplikacji działa — treści dochodzą w kolejnych etapach.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/login" className="btn-primary">
          Zaloguj się
        </Link>
      </div>
    </Shell>
  );
}
