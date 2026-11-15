import type { ReactNode } from "react";

import { Breadcrumbs, type Crumb } from "./breadcrumbs";

/**
 * Nagłówek strony — jeden układ wszędzie: okruszki, tytuł z działaniami przy prawej krawędzi,
 * opis pod tytułem. Dzięki temu droga powrotna stoi na każdej stronie w tym samym miejscu, co
 * dla dziecka jest ważniejsze niż dla dorosłego.
 */
export function PageHeader({
  crumbs,
  title,
  actions,
  intro,
  children,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  actions?: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-2">
      <Breadcrumbs items={crumbs ?? []} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="flex min-w-0 flex-1 basis-64 items-center gap-3">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {intro && <p className="text-zinc-600 dark:text-zinc-400">{intro}</p>}
      {children}
    </header>
  );
}
