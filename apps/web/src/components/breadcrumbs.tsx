import Link from "next/link";
import type { ReactNode } from "react";

/** Jeden stopień drogi: dokąd prowadzi i co ma na sobie napisane. */
export type Crumb = { href: string; label: ReactNode };

/**
 * Okruszki — cała droga do miejsca, w którym jesteśmy, a nie tylko jeden krok wstecz.
 * Z lekcji w panelu wraca się jednym kliknięciem do kursów, zamiast klikać „wstecz" trzy razy.
 * Ostatni stopień to tytuł strony (`<h1>` pod spodem), więc tu go nie powtarzamy.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav className="crumbs" aria-label="Ścieżka">
      <ol>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="crumb">
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Stopnie powtarzające się na wielu stronach — żeby ścieżka wszędzie brzmiała tak samo. */
export const CRUMB_HOME: Crumb = { href: "/", label: "Strona główna" };
export const CRUMB_PANEL: Crumb = { href: "/admin", label: "Panel" };
export const CRUMB_COURSES: Crumb = { href: "/admin/kursy", label: "Kursy" };
