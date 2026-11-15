import { Shell } from "@/components/shell";

import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const raw = params.next;
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <Shell>
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <span className="text-6xl" aria-hidden>
          🦉
        </span>
        <h1>LingoMemo</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Zaloguj się i ucz się słówek.</p>
      </div>
      <LoginForm next={next} />
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Nie masz jeszcze konta? Poproś rodzica o link z zaproszeniem.
      </p>
    </Shell>
  );
}
