import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Nagłówek strony — jeden układ wszędzie: powrót, tytuł z działaniami przy prawej krawędzi,
 * opis pod tytułem. Dzięki temu „wstecz” stoi na każdej stronie w tym samym miejscu, co dla
 * dziecka jest ważniejsze niż dla dorosłego.
 */
export function PageHeader({
  back,
  title,
  actions,
  intro,
  children,
}: {
  back?: { href: string; label: ReactNode };
  title: ReactNode;
  actions?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      {back && (
        <Link href={back.href} className="back-link">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex min-w-0 flex-1 basis-64 items-center gap-3">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {intro && <p className="text-zinc-600 dark:text-zinc-400">{intro}</p>}
      {children}
    </header>
  );
}
