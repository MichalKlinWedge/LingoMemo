"use client";

import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { slugify } from "@lingomemo/core";

/**
 * Wspólny kontrakt akcji serwera. Każda zwraca albo błąd do pokazania, albo potwierdzenie —
 * nigdy nie rzuca wyjątkiem w stronę dziecka.
 */
export type FormState = { error?: string; ok?: string; token?: string };

export function Status({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p className="msg-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="msg-ok" role="status">
        {state.ok}
      </p>
    );
  }
  return null;
}

/** Co trzeba zapamiętać o jednym polu, żeby je odtworzyć: wartość albo zaznaczenie. */
type Wpisane = { name: string; value: string; checked: boolean; kind: "value" | "checked" };

function zapamietaj(form: HTMLFormElement): Wpisane[] {
  return Array.from(form.elements).flatMap((element) => {
    const pole = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    // Pole bez nazwy nic nie wysyła, a pliku i tak nie da się wpisać z powrotem.
    if (!pole.name || (pole as HTMLInputElement).type === "file") return [];
    const zaznaczane = (pole as HTMLInputElement).type === "checkbox" || (pole as HTMLInputElement).type === "radio";
    return [
      {
        name: pole.name,
        value: pole.value,
        checked: (pole as HTMLInputElement).checked,
        kind: zaznaczane ? ("checked" as const) : ("value" as const),
      },
    ];
  });
}

function odtworz(form: HTMLFormElement, zapamietane: Wpisane[]) {
  for (const stan of zapamietane) {
    for (const element of Array.from(form.elements)) {
      const pole = element as HTMLInputElement;
      if (pole.name !== stan.name) continue;
      if (stan.kind === "checked") {
        if (pole.value === stan.value) pole.checked = stan.checked;
      } else if (pole.value !== stan.value) {
        pole.value = stan.value;
      }
    }
  }
}

/**
 * Formularz panelu, który po błędzie nie gubi tego, co administrator wpisał.
 *
 * React czyści formularz po każdym wywołaniu akcji — przy udanym zapisie o to właśnie chodzi
 * („dodaj kolejny dział"), ale przy błędzie walidacji dorosły traci wszystkie pola i musi
 * wpisywać je od nowa, choć pomylił się w jednym. Zapamiętujemy więc pola w chwili wysłania
 * i wpisujemy je z powrotem, gdy akcja wróci z błędem. Pola trzymane w stanie Reacta
 * (`TitleAndSlug`) bronią się same — to jest dla zwykłych pól i list wyboru.
 *
 * Każdy formularz w panelu administratora używa tego komponentu zamiast gołego `<form>`.
 */
/**
 * Ostatni udany zapis albo `null`. Pola trzymane w stanie Reacta nie dają się wyczyścić przez
 * `form.reset()`, więc dowiadują się o udanym zapisie stąd — po zmianie tożsamości obiektu.
 */
const UdanyZapis = createContext<FormState | null>(null);

export function Form({
  action,
  state,
  className,
  children,
}: {
  action: (formData: FormData) => void;
  state: FormState;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const zapamietane = useRef<Wpisane[] | null>(null);

  useEffect(() => {
    const form = ref.current;
    const stan = zapamietane.current;
    if (!form || !stan) return;
    zapamietane.current = null;
    if (!state.error) return;

    odtworz(form, stan);
    // React potrafi wyczyścić formularz dopiero po tym efekcie — wtedy pierwsze odtworzenie
    // przepada, więc powtarzamy je po przemalowaniu. Druga próba nic nie psuje.
    const klatka = requestAnimationFrame(() => odtworz(form, stan));
    return () => cancelAnimationFrame(klatka);
  }, [state]);

  return (
    <UdanyZapis.Provider value={state.ok && !state.error ? state : null}>
      <form
        ref={ref}
        action={action}
        className={className}
        onSubmit={(event) => {
          zapamietane.current = zapamietaj(event.currentTarget);
        }}
      >
        {children}
      </form>
    </UdanyZapis.Provider>
  );
}

/** Przycisk, który sam pilnuje, żeby nie dało się kliknąć dwa razy. */
export function SubmitButton({
  children,
  pendingLabel = "Chwileczkę…",
  variant = "primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  /** „danger" to czerwony przycisk kasujący. Występuje wyłącznie w panelu administratora. */
  variant?: "primary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={variant === "danger" ? "btn-danger" : "btn-primary"} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
  autoComplete,
  placeholder,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  autoComplete?: string;
  placeholder?: string;
  /** Dla pól liczbowych. Bez `step` przeglądarka przyjmuje wyłącznie liczby całkowite
   *  i blokuje wysłanie formularza własnym dymkiem, zanim akcja w ogóle ruszy. */
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-semibold">{label}</span>
      <input
        className="field"
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}

/**
 * Para pól „Nazwa" i „Nazwa w adresie". Adres podpowiada się z nazwy, dopóki administrator sam
 * go nie poprawi — wtedy podpowiadanie milknie, żeby nie kasować jego pracy przy każdej kolejnej
 * literze wpisanej w tytule. Wyczyszczenie adresu wraca do podpowiadania.
 */
export function TitleAndSlug({
  titlePlaceholder,
  slugPlaceholder,
  defaultTitle = "",
  defaultSlug = "",
  titleLabel = "Nazwa",
  slugLabel = "Nazwa w adresie",
  slugHidden = false,
}: {
  titlePlaceholder?: string;
  slugPlaceholder?: string;
  defaultTitle?: string;
  defaultSlug?: string;
  titleLabel?: string;
  slugLabel?: string;
  /**
   * Adres bez własnego pola: składa się z nazwy i jedzie ukrytym polem. Przy zakładaniu czegoś
   * nowego nie ma czego w nim poprawiać, a człowiek, który widzi „pl-en-starter", zatrzymuje się
   * nad tym jak nad decyzją do podjęcia. Przy poprawianiu adres zostaje widoczny — wtedy jest już
   * ustalony i bywa, że to właśnie jego trzeba zmienić.
   */
  slugHidden?: boolean;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [slug, setSlug] = useState(defaultSlug);
  /** Adres wpisany ręcznie. Przy edycji istniejącego wpisu od razu — jest już ustalony. */
  const [wlasny, setWlasny] = useState(defaultSlug !== "");
  const titleId = useId();
  const slugId = useId();

  // Po udanym dodaniu formularz „nowego czegoś" czyści się cały, więc te dwa pola też.
  // Formularz edycji ma wartości w `defaultTitle` — tam czyszczenie skasowałoby nazwę wpisaną
  // przed chwilą, zanim strona przeładuje dane z bazy. Stan poprawiamy w trakcie renderowania,
  // nie w efekcie: efekt z `setState` to kaskada renderów, której linter słusznie zabrania.
  const nowy = defaultTitle === "" && defaultSlug === "";
  const udany = useContext(UdanyZapis);
  const [poprzedni, setPoprzedni] = useState(udany);
  if (udany !== poprzedni) {
    setPoprzedni(udany);
    if (udany && nowy) {
      setTitle("");
      setSlug("");
      setWlasny(false);
    }
  }

  return (
    <div className={slugHidden ? "" : "grid gap-4 sm:grid-cols-2"}>
      <label className="flex flex-col gap-2" htmlFor={titleId}>
        <span className="font-semibold">{titleLabel}</span>
        <input
          id={titleId}
          className="field"
          name="title"
          required
          value={title}
          placeholder={titlePlaceholder}
          onChange={(event) => {
            setTitle(event.target.value);
            if (!wlasny) setSlug(slugify(event.target.value));
          }}
        />
      </label>

      {slugHidden && <input type="hidden" name="slug" value={slug} />}

      {!slugHidden && (
        <label className="flex flex-col gap-2" htmlFor={slugId}>
          <span className="font-semibold">{slugLabel}</span>
          <input
            id={slugId}
            className="field font-mono"
            name="slug"
            required
            value={slug}
            placeholder={slugPlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const wpisane = event.target.value;
              setSlug(wpisane);
              // Puste pole znaczy „podpowiadaj dalej" — inaczej raz skasowany adres zostałby pusty.
              setWlasny(wpisane !== "");
            }}
          />
        </label>
      )}
    </div>
  );
}
