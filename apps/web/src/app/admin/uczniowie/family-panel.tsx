"use client";

import { useActionState } from "react";

import { setChildAction, setParentAction } from "@/app/admin/uczniowie/parent-actions";
import { Form, type FormState } from "@/components/forms";

/** Konto, które można komuś przypisać jako dziecko. */
export type Osoba = { userId: string; displayName: string; isAdmin: boolean };

/** Przycisk nadający albo odbierający rolę rodzica. */
function RoleButton({ userId, isParent }: { userId: string; isParent: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setParentAction, {});

  return (
    <Form action={action} state={state} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="is_parent" value={isParent ? "false" : "true"} />
      <button type="submit" className="btn-row">
        {isParent ? "Odbierz rolę rodzica" : "Zrób rodzicem"}
      </button>
      {state.error && <span className="text-base text-red-700">{state.error}</span>}
    </Form>
  );
}

/** Jedno dziecko na liście rodzica: przypięte albo nie. */
function ChildButton({
  parentId,
  child,
  linked,
}: {
  parentId: string;
  child: Osoba;
  linked: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(setChildAction, {});

  return (
    <Form action={action} state={state} className="flex items-center gap-2">
      <input type="hidden" name="parent_id" value={parentId} />
      <input type="hidden" name="child_id" value={child.userId} />
      <input type="hidden" name="linked" value={linked ? "false" : "true"} />
      <button type="submit" className="btn-row" aria-pressed={linked}>
        <span aria-hidden>{linked ? "✓" : "+"}</span> {child.displayName}
      </button>
      {state.error && <span className="text-base text-red-700">{state.error}</span>}
    </Form>
  );
}

/**
 * Rola rodzica i jego dzieci, rozwijane pod wierszem osoby.
 *
 * Przypisanie jest po stronie rodzica, nie dziecka: rodziców jest w tej aplikacji dwoje,
 * a dzieci kilkoro — krótsza lista do klikania i od razu widać, komu brakuje przypisania.
 * Dziecko może mieć dwoje rodziców, więc to zwykłe przełączniki, a nie wybór jednego z listy.
 */
export function FamilyPanel({
  userId,
  isParent,
  childIds,
  people,
}: {
  userId: string;
  isParent: boolean;
  /** Identyfikatory już przypisanych dzieci. */
  childIds: string[];
  /** Wszystkie konta — do wyboru dzieci. */
  people: Osoba[];
}) {
  const przypisane = new Set(childIds);
  // Administratora nie przypisujemy jako dziecka: to konto rodzica-opiekuna, nie ucznia.
  const kandydaci = people.filter((osoba) => osoba.userId !== userId && !osoba.isAdmin);

  return (
    <details>
      <summary className="back-link cursor-pointer list-none font-semibold">
        {isParent ? `Dzieci (${przypisane.size})` : "Rola rodzica"}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <RoleButton userId={userId} isParent={isParent} />

        {isParent && (
          <>
            <p className="text-base text-zinc-600 dark:text-zinc-400">
              Zaznaczone dzieci rodzic widzi w swoim panelu — postępy, czas nauki i słówka do
              powtórki. Niczego nie zmienia, tylko ogląda.
            </p>
            {kandydaci.length === 0 ? (
              <p className="text-base text-zinc-600 dark:text-zinc-400">Nie ma jeszcze kont uczniów.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {kandydaci.map((child) => (
                  <ChildButton
                    key={child.userId}
                    parentId={userId}
                    child={child}
                    linked={przypisane.has(child.userId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
