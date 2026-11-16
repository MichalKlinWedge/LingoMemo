import Link from "next/link";
import { Suspense } from "react";

import { CRUMB_HOME } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";

const KAFELKI = [
  { href: "/admin/kursy", icon: "📚", title: "Kursy", text: "Kursy, działy, lekcje i słówka." },
  { href: "/admin/import", icon: "📥", title: "Import lekcji", text: "Wklej lekcję z pliku JSON." },
  { href: "/admin/zaproszenia", icon: "✉️", title: "Zaproszenia", text: "Wygeneruj link do założenia konta." },
  {
    href: "/admin/uczniowie",
    icon: "🧒",
    title: "Uczniowie i konta",
    text: "Kto się uczy, jak mu idzie i zmiana hasła.",
  },
  { href: "/admin/obrazki", icon: "🖼️", title: "Obrazki", text: "Wgraj obrazki do słówek." },
  {
    href: "/admin/statystyki",
    icon: "📊",
    title: "Statystyki",
    text: "Cała aplikacja naraz: kursy, dzieci, celność, trudne słówka.",
  },
  {
    href: "/admin/ustawienia",
    icon: "⚙️",
    title: "Ustawienia",
    text: "Pokrętła całej aplikacji, np. czas przejścia do następnego zadania.",
  },
];

async function Panel() {
  const { supabase } = await requireAdmin("/admin");

  const [{ count: lessons }, { count: concepts }, { data: students }] = await Promise.all([
    supabase.from("lessons").select("id", { count: "exact", head: true }),
    supabase.from("concepts").select("id", { count: "exact", head: true }),
    supabase.rpc("list_students"),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[CRUMB_HOME]}
        title="Panel"
        intro={`Lekcji: ${lessons ?? 0} · słówek: ${concepts ?? 0} · kont: ${(students ?? []).length}`}
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {KAFELKI.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="card flex h-full items-center gap-4 p-5">
              <span className="text-4xl" aria-hidden>
                {item.icon}
              </span>
              <span className="flex flex-col">
                <span className="card-title">{item.title}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">{item.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function AdminPage() {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Panel />
      </Suspense>
    </Shell>
  );
}
