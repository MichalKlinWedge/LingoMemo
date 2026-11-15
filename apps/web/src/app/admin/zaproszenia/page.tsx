import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { NewInvite, RevokeButton } from "./invite-panel";

async function Invites() {
  const { supabase } = await requireAdmin("/admin/zaproszenia");

  const [{ data: invites, error }, { data: courses }] = await Promise.all([
    supabase.rpc("list_invites"),
    supabase.from("courses").select("id, title").order("sort_order"),
  ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  return (
    <>
      <NewInvite courses={courses ?? []} siteUrl={siteUrl} />

      <section className="flex flex-col gap-3">
        <h2 className="card-title">Wygenerowane</h2>
        {error && <p className="msg-error">{dbLoadError(error)}</p>}
        {(invites ?? []).length === 0 && !error && (
          <p className="text-zinc-600 dark:text-zinc-400">Jeszcze żadnych zaproszeń.</p>
        )}
        <ul className="flex flex-col gap-3">
          {(invites ?? []).map((invite) => (
            <li key={invite.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold">
                  {invite.display_name ?? "bez imienia"}
                  {invite.role === "admin" && " · administrator"}
                </span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">
                  {invite.course_title ?? "bez kursu"} · {invite.token_prefix}… · ważne do{" "}
                  {new Date(invite.expires_at).toLocaleDateString("pl-PL")}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="chip">{invite.status}</span>
                {invite.status === "aktywne" && <RevokeButton id={invite.id} />}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default function InvitesPage() {
  return (
    <Shell>
      <PageHeader
        back={{ href: "/", label: "Strona główna" }}
        title="Zaproszenia"
        intro="Konto w LingoMemo zakłada się wyłącznie z linku. Każdy link działa raz."
      />
      <Suspense fallback={<Loading />}>
        <Invites />
      </Suspense>
    </Shell>
  );
}
