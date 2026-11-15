import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="text-6xl" aria-hidden>
        🧭
      </span>
      <h1>Nie ma takiej strony</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Chyba zgubiliśmy drogę. Wróćmy na początek.</p>
      <Link href="/" className="btn-primary">
        Strona główna
      </Link>
    </main>
  );
}
