"use client";

import { useActionState } from "react";

import { updateStudentAction } from "@/app/admin/uczniowie/actions";
import { Field, Form, Status, SubmitButton, type FormState } from "@/components/forms";

/**
 * Strefy czasowe do wyboru. Krótka lista, a nie pełne `Intl.supportedValuesOf("timeZone")`:
 * czterystu pozycji nikt nie przewinie, a biblioteka stref w przeglądarce i w Node bywa innej
 * wersji — lista złożona na serwerze i w przeglądarce rozjechałaby się przy uwodnieniu.
 * Strefa dziecka dokłada się do listy sama, więc wpis spoza niej nie zniknie po zapisie.
 */
const ZONES = [
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Oslo",
  "Europe/Stockholm",
  "Europe/Kyiv",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

/**
 * Dane dziecka widziane przez rodzica. Imię wpisuje się raz, przy zakładaniu konta — i do tej pory
 * nie było go gdzie poprawić, bo dziecko nie ma ekranu swojego profilu, a polityka na `profiles`
 * puszcza do zapisu tylko własny wiersz.
 *
 * Strefa czasowa wygląda na drobiazg, ale to ona wyznacza, o której dziecku zmienia się dzień:
 * od niej zależy termin powtórki i to, czy wieczorna lekcja przedłuża serię dni z rzędu.
 */
export function ProfilePanel({
  userId,
  displayName,
  timeZone,
}: {
  userId: string;
  displayName: string;
  timeZone: string;
}) {
  const [state, action] = useActionState(updateStudentAction, {} as FormState);
  const zones = ZONES.includes(timeZone) ? ZONES : [timeZone, ...ZONES];

  return (
    <section className="card flex flex-col gap-4 p-5">
      <h2 className="card-title">Dane dziecka</h2>

      <Form action={action} state={state} className="flex flex-col gap-4">
        <input type="hidden" name="user_id" value={userId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Imię" name="display_name" defaultValue={displayName} autoComplete="off" />
          <label className="flex flex-col gap-2">
            <span className="font-semibold">Strefa czasowa</span>
            <select name="time_zone" className="field" defaultValue={timeZone}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Imię widać na ekranie dziecka i na liście uczniów. Strefa czasowa decyduje, o której
          dziecku zmienia się dzień — czyli kiedy wypada powtórka i czy wieczorna lekcja przedłuża
          serię. Adres e-mail i hasło zmienia się na ekranie <strong>Konta</strong>.
        </p>

        <Status state={state} />
        <SubmitButton pendingLabel="Zapisuję…">Zapisz dane</SubmitButton>
      </Form>
    </section>
  );
}
