import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { Loading, Shell } from "@/components/shell";
import { createClient } from "@/lib/supabase/server";

import { InviteForm } from "./invite-form";

type Preview = {
  ok: boolean;
  reason?: string;
  displayName?: string | null;
  email?: string | null;
  courseTitle?: string | null;
};

/**
 * Podgląd zaproszenia wydaje funkcja `invite_preview` w bazie — nie dotykamy tu tabeli zaproszeń,
 * bo ta nie jest w ogóle wystawiona na zewnątrz. Wszystko dynamiczne siedzi w `<Suspense>`,
 * inaczej Next z Cache Components nie zbuduje strony.
 */
async function Invite({ params }: { params: PageProps<"/zaproszenie/[token]">["params"] }) {
  const { token } = await params;
  const supabase = await createClient();

  // Adres z nagłówka służy wyłącznie do ograniczenia liczby prób odczytania zaproszeń.
  const forwarded = (await headers()).get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();

  const { data } = await supabase.rpc("invite_preview", { p_token: token, p_ip: ip });
  const preview = (data ?? { ok: false, reason: "invalid" }) as Preview;

  if (!preview.ok) {
    return (
      <div className="flex flex-col items-center gap-3 pt-6 text-center">
        <span className="text-6xl" aria-hidden>
          🔒
        </span>
        <h1>Zaproszenie nie działa</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {preview.reason === "rate_limit"
            ? "Za dużo prób. Spróbuj ponownie za kwadrans."
            : "To zaproszenie jest nieprawidłowe, zostało już użyte albo wygasło. Poproś o nowy link."}
        </p>
        <Link href="/login" className="btn-secondary">
          Przejdź do logowania
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <span className="text-6xl" aria-hidden>
          🎉
        </span>
        <h1>{preview.displayName ? `Cześć, ${preview.displayName}!` : "Witaj w LingoMemo"}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {preview.courseTitle ? `Czeka na ciebie kurs „${preview.courseTitle}”.` : "Załóż konto i zaczynamy naukę."}
        </p>
      </div>
      <InviteForm token={token} displayName={preview.displayName ?? null} email={preview.email ?? null} />
    </>
  );
}

export default function InvitePage({ params }: PageProps<"/zaproszenie/[token]">) {
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Invite params={params} />
      </Suspense>
    </Shell>
  );
}
