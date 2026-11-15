import { Suspense } from "react";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { PasswordForm } from "./password-form";

const data = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString("pl-PL") : "nigdy";

async function Accounts() {
  const { supabase, userId } = await requireAdmin("/admin/konta");
  const { data: accounts, error } = await supabase.rpc("list_accounts");

  if (error) return <p className="msg-error">{dbLoadError(error)}</p>;
  if ((accounts ?? []).length === 0) return <p className="text-zinc-600 dark:text-zinc-400">Nie ma jeszcze kont.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {(accounts ?? []).map((account) => (
        <li key={account.user_id} className="card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="font-semibold">
                {account.display_name}
                {account.user_id === userId && " · to Ty"}
              </span>
              <span className="text-base text-zinc-600 dark:text-zinc-400">{account.email}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-base">
              <span className="chip">{account.is_admin ? "administrator" : "uczeń"}</span>
              <span className="text-sm text-zinc-500">
                konto od {data(account.created_at)} · ostatnie logowanie {data(account.last_sign_in_at)}
                {account.password_changed_at && ` · hasło zmieniane ${data(account.password_changed_at)}`}
              </span>
            </div>
          </div>
          <PasswordForm
            userId={account.user_id}
            displayName={account.display_name}
            self={account.user_id === userId}
          />
        </li>
      ))}
    </ul>
  );
}

export default function AccountsPage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Konta"
        intro="Kto ma konto i kiedy ostatnio się logował. Hasła nie da się podejrzeć — można je tylko ustawić na nowo."
      />
      <Suspense fallback={<Loading />}>
        <Accounts />
      </Suspense>
    </Shell>
  );
}
