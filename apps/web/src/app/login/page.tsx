import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";

import { LoginForm } from "./login-form";

/**
 * Strona nie jest `async`: nagłówek ma się pokazać od razu, a formularz czeka na `searchParams`
 * wewnątrz `<Suspense>`. Bez tego Next z Cache Components nie potrafi zrobić prerenderu.
 */
async function Form({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return <LoginForm next={next} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <span className="text-6xl" aria-hidden>
          🦉
        </span>
        <h1>LingoMemo</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Zaloguj się i ucz się słówek.</p>
      </div>
      <Suspense fallback={<Loading />}>
        <Form searchParams={searchParams} />
      </Suspense>
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Nie masz jeszcze konta? Poproś rodzica o link z zaproszeniem.
      </p>
    </Shell>
  );
}
