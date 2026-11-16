import { Suspense } from "react";

import { formatDuration } from "@lingomemo/core";

import { CRUMB_HOME, CRUMB_PANEL } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { Loading, Shell } from "@/components/shell";
import { requireAdmin } from "@/lib/auth";
import { dbLoadError } from "@/lib/db-error";

import { type Osoba } from "./family-panel";
import { PeopleTable, type PersonRow } from "./people-table";

/** Data po polsku albo „nigdy" — `last_sign_in_at` jest puste do pierwszego logowania. */
const data = (value: string | null): string => (value ? new Date(value).toLocaleDateString("pl-PL") : "nigdy");

/**
 * Jedna strona na wszystko, co dotyczy ludzi: postępy dziecka i jego konto.
 *
 * Wcześniej były dwie listy tych samych osób — „Uczniowie" (punkty, lekcje, czas)
 * i „Konta" (logowanie, hasło). Żeby zmienić dziecku hasło po zajrzeniu w jego wyniki,
 * trzeba było wrócić do panelu i wejść w drugi kafelek, a obie listy i tak czytały
 * te same wiersze z `profiles`.
 */
async function People() {
  const { supabase, userId } = await requireAdmin("/admin/uczniowie");

  // Trzy źródła, bo każde wie co innego: `list_students` postępy, `list_accounts` konto,
  // `v_my_stats` czas nauki. Widok ma `security_invoker`, a polityki `*_read` dopuszczają
  // administratora, więc to samo zapytanie, które dziecku zwraca jeden wiersz, tu zwraca wszystkie.
  const [
    { data: students, error },
    { data: accounts, error: accountsError },
    { data: stats },
    { data: parents },
    { data: requests },
    { data: courses },
  ] = await Promise.all([
    supabase.rpc("list_students"),
    supabase.rpc("list_accounts"),
    supabase.from("v_my_stats").select("user_id, seconds_total, seconds_week, words_mastered"),
    supabase.rpc("admin_parents"),
    // Prośby o dostęp do kursu. Rodzic czeka na dziecko, dziecko czeka na kurs — jedno i drugie
    // jest „ktoś czeka na decyzję", więc stoi w tej samej tabeli, w tej samej kolumnie.
    supabase.rpc("admin_course_requests"),
    supabase.from("courses").select("id, title"),
  ]);

  const problem = error ?? accountsError;
  if (problem) return <p className="msg-error">{dbLoadError(problem)}</p>;
  if ((students ?? []).length === 0) return <p className="text-zinc-600 dark:text-zinc-400">Nie ma jeszcze kont.</p>;

  const accountOf = new Map((accounts ?? []).map((row) => [row.user_id, row]));
  const timeOf = new Map((stats ?? []).map((row) => [row.user_id, row]));
  // Rodzic bez dzieci też jest w tej mapie — inaczej nie dałoby się mu żadnego przypisać.
  const childrenOf = new Map((parents ?? []).map((row) => [row.user_id, row.children ?? []]));
  // Rodzic, który zalogował się bez przypisanego dziecka. Data mówi, od kiedy czeka — bez niej
  // „prosi o dziecko" wyglądałoby tak samo po godzinie i po tygodniu.
  const requestOf = new Map(
    (parents ?? []).filter((row) => row.requested_at).map((row) => [row.user_id, row.requested_at as string]),
  );
  // Kursy, o które prosi dziecko. Tytuł zamiast identyfikatora, bo to on ma stanąć w dymku
  // i w rozwiniętym wierszu — nazwa kursu jest całą treścią tej informacji.
  const tytulKursu = new Map((courses ?? []).map((course) => [course.id, course.title]));
  const prosiOKursy = new Map<string, string[]>();
  for (const request of requests ?? []) {
    const tytul = `${tytulKursu.get(request.course_id) ?? "nieznany kurs"} (od ${data(request.first_at)})`;
    prosiOKursy.set(request.user_id, [...(prosiOKursy.get(request.user_id) ?? []), tytul]);
  }
  const osoby: Osoba[] = (students ?? []).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    isAdmin: row.is_admin,
  }));

  const rows: PersonRow[] = (students ?? []).map((student) => {
    const account = accountOf.get(student.user_id);
    const extra = timeOf.get(student.user_id);
    const prosi = requestOf.get(student.user_id) ?? null;
    const kursy = prosiOKursy.get(student.user_id) ?? [];

    return {
      userId: student.user_id,
      displayName: student.display_name,
      email: student.email,
      // Jedna rola na wiersz: rodzic nie uczy się, więc „uczeń" przy nim byłby mylący.
      role: student.is_admin ? "administrator" : childrenOf.has(student.user_id) ? "rodzic" : "uczeń",
      isParent: childrenOf.has(student.user_id),
      childIds: childrenOf.get(student.user_id) ?? [],
      waiting: prosi !== null,
      asking: kursy,
      self: student.user_id === userId,
      points: student.total_points,
      lessons: student.lessons_done,
      streak: student.streak_days,
      time: formatDuration(extra?.seconds_total ?? 0),
      // Daty składamy tutaj: w tabeli zajęłyby cztery kolumny, z których na co dzień nie
      // patrzy się wcale, a pod rozwiniętym wierszem mieszczą się w jednym zdaniu.
      details: [
        `słówek: ${student.words_seen}`,
        `poziom: ${student.level}`,
        student.last_active_on
          ? `ostatnio uczył się ${new Date(student.last_active_on).toLocaleDateString("pl-PL")}`
          : "jeszcze się nie uczył",
        `konto od ${data(account?.created_at ?? null)}`,
        `ostatnie logowanie ${data(account?.last_sign_in_at ?? null)}`,
        ...(account?.password_changed_at ? [`hasło zmieniane ${data(account.password_changed_at)}`] : []),
        ...(prosi ? [`prosi o przypisanie dziecka od ${data(prosi)}`] : []),
        ...(kursy.length > 0 ? [`prosi o dostęp: ${kursy.join(", ")}`] : []),
      ].join(" · "),
    };
  });

  return <PeopleTable rows={rows} people={osoby} />;
}

export default function PeoplePage() {
  return (
    <Shell>
      <PageHeader
        crumbs={[CRUMB_HOME, CRUMB_PANEL]}
        title="Uczniowie i konta"
        intro="Postępy, czas nauki i dane konta. Hasła nie da się podejrzeć — można je tylko ustawić na nowo. Kliknij imię, żeby zobaczyć kartę dziecka."
      />
      <Suspense fallback={<Loading />}>
        <People />
      </Suspense>
    </Shell>
  );
}
