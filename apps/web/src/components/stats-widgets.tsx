import { plural } from "@lingomemo/core";

/**
 * Klocki ekranu postępów. Te same kafelki i ten sam wykres ogląda dziecko na swoim ekranie
 * i dorosły w panelu — gdyby każda strona rysowała je po swojemu, po pierwszej poprawce
 * zaczęłyby pokazywać co innego.
 */

export function Tile({ value, label, icon }: { value: string | number; label: string; icon: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 p-4 text-center">
      <span className="text-3xl" aria-hidden>
        {icon}
      </span>
      <span style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "var(--font-display)" }}>{value}</span>
      <span className="text-base text-zinc-600 dark:text-zinc-400">{label}</span>
    </div>
  );
}

/** Kolumny widoku są dla generatora typów opcjonalne, bo widok nie ma ograniczeń `not null`. */
export type DailyRow = {
  day: string | null;
  answers: number | null;
  correct: number | null;
  /** Tylko w widoku panelu: ile dzieci uczyło się tego dnia. */
  learners?: number | null;
};

/** Siedem ostatnich dni, także tych bez nauki — przerwa w nauce też jest informacją. */
export function lastSevenDays(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let back = 6; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - back);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

const WEEKDAY = ["N", "P", "W", "Ś", "C", "P", "S"];

/** Najwyższy słupek tygodnia. */
const BAR_MAX_PX = 112;

export function WeekChart({ daily, title = "Ostatni tydzień" }: { daily: DailyRow[]; title?: string }) {
  const days = lastSevenDays();
  const byDay = new Map(daily.filter((row) => row.day !== null).map((row) => [row.day, row]));
  const peak = Math.max(1, ...days.map((day) => byDay.get(day)?.answers ?? 0));
  const weekTotal = days.reduce((sum, day) => sum + (byDay.get(day)?.answers ?? 0), 0);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title">{title}</h2>
        <span className="text-base text-zinc-600 dark:text-zinc-400">
          {plural(weekTotal, ["odpowiedź", "odpowiedzi", "odpowiedzi"])}
        </span>
      </div>

      {/* Jedna seria, więc bez legendy — tytuł mówi, co to jest. Liczba tylko nad najlepszym
          dniem: podpisywanie każdego słupka zamienia wykres w tabelę. */}
      {/* Wysokości w pikselach, nie w procentach: procent liczy się od wysokości rodzica,
          a ta w elastycznym kontenerze bywa nieokreślona i słupki znikają. */}
      <ol className="flex items-end gap-2">
        {days.map((day) => {
          const row = byDay.get(day);
          const answers = row?.answers ?? 0;
          const height = answers === 0 ? 4 : Math.max(6, Math.round((answers / peak) * BAR_MAX_PX));
          const date = new Date(`${day}T12:00:00`);
          const isPeak = answers === peak && answers > 0;

          return (
            <li key={day} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-sm font-semibold" style={{ height: "1.25rem" }}>
                {isPeak ? answers : ""}
              </span>
              <div className="flex w-full items-end" style={{ height: `${BAR_MAX_PX}px` }}>
                <div
                  style={{
                    width: "100%",
                    height: `${height}px`,
                    borderRadius: "4px 4px 0 0",
                    background: answers === 0 ? "var(--line)" : "var(--color-brand)",
                  }}
                  title={`${date.toLocaleDateString("pl-PL")}: ${answers} odpowiedzi, ${row?.correct ?? 0} trafionych`}
                  aria-hidden
                />
              </div>
              <span className="text-sm text-zinc-500" aria-hidden>
                {WEEKDAY[date.getDay()]}
              </span>
              <span className="sr-only">
                {date.toLocaleDateString("pl-PL")}: {answers} odpowiedzi, {row?.correct ?? 0} trafionych
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Celność w procentach. Bez odpowiedzi nie ma czego liczyć — wtedy kreska, nie „0%". */
export function accuracy(correct: number, total: number): string {
  return total === 0 ? "—" : `${Math.round((correct / total) * 100)}%`;
}

/** Jeden słupek listy: podpis, wartość do narysowania i to, co widać przy słupku. */
export type BarRow = { key: string; label: string; value: number; display: string; note?: string };

/**
 * Lista poziomych słupków — kursy, dzieci, typy zadań. Poziomo, bo podpisy są pełnymi
 * nazwami („Numbers 10-100"), a pionowy wykres zamieniłby je w tekst pisany bokiem.
 *
 * Najdłuższy słupek wyznacza skalę, więc lista mówi „kto ile w stosunku do najlepszego",
 * a nie „ile dokładnie" — dokładna liczba stoi obok.
 */
export function BarList({
  title,
  rows,
  empty = "Jeszcze nie ma z czego liczyć.",
  intro,
}: {
  title: string;
  rows: BarRow[];
  empty?: string;
  intro?: string;
}) {
  const peak = Math.max(1, ...rows.map((row) => row.value));

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="card-title">{title}</h2>
        {intro && <span className="text-base text-zinc-600 dark:text-zinc-400">{intro}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{row.label}</span>
                <span className="text-base text-zinc-600 dark:text-zinc-400">
                  {row.display}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
              </div>
              {/* Tło słupka pokazuje całą skalę, więc widać też, ile brakuje do najlepszego. */}
              <div className="w-full overflow-hidden rounded-full" style={{ height: "0.75rem", background: "var(--line)" }}>
                <div
                  style={{
                    width: `${Math.max(2, Math.round((row.value / peak) * 100))}%`,
                    height: "100%",
                    background: "var(--color-brand)",
                  }}
                  aria-hidden
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Aktywność dzień po dniu przez ostatnie `days` dni. To samo co `WeekChart`, ale bez liter
 * dni tygodnia — przy trzydziestu słupkach i tak nie dałoby się ich przeczytać, więc podpisy
 * są co siódmy słupek, a reszta siedzi w dymku i w opisie dla czytnika ekranu.
 */
export function DaysChart({
  daily,
  days = 30,
  title = "Ostatnie 30 dni",
}: {
  daily: DailyRow[];
  days?: number;
  title?: string;
}) {
  const list: string[] = [];
  const today = new Date();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - back);
    list.push(day.toISOString().slice(0, 10));
  }

  const byDay = new Map(daily.filter((row) => row.day !== null).map((row) => [row.day, row]));
  const peak = Math.max(1, ...list.map((day) => byDay.get(day)?.answers ?? 0));
  const total = list.reduce((sum, day) => sum + (byDay.get(day)?.answers ?? 0), 0);

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title">{title}</h2>
        <span className="text-base text-zinc-600 dark:text-zinc-400">
          {plural(total, ["odpowiedź", "odpowiedzi", "odpowiedzi"])}
        </span>
      </div>
      <ol className="flex items-end gap-1">
        {list.map((day, index) => {
          const row = byDay.get(day);
          const answers = row?.answers ?? 0;
          const height = answers === 0 ? 3 : Math.max(5, Math.round((answers / peak) * BAR_MAX_PX));
          const date = new Date(`${day}T12:00:00`);
          const opis = `${date.toLocaleDateString("pl-PL")}: ${answers} odpowiedzi, ${row?.correct ?? 0} trafionych, dzieci: ${row?.learners ?? 0}`;

          return (
            <li key={day} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end" style={{ height: `${BAR_MAX_PX}px` }}>
                <div
                  style={{
                    width: "100%",
                    height: `${height}px`,
                    borderRadius: "3px 3px 0 0",
                    background: answers === 0 ? "var(--line)" : "var(--color-brand)",
                  }}
                  title={opis}
                  aria-hidden
                />
              </div>
              {/* Co siódmy podpis: przy trzydziestu dniach reszta i tak zlałaby się w szarą
                  kreskę. Dzień dzisiejszy podpisany zawsze — od niego liczy się wykres. */}
              <span className="text-sm text-zinc-500" aria-hidden style={{ height: "1rem" }}>
                {index % 7 === 0 || index === list.length - 1 ? date.getDate() : ""}
              </span>
              <span className="sr-only">{opis}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
