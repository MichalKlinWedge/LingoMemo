/**
 * Przestawianie elementów listy.
 *
 * Używa tego panel administratora przy zmianie kolejności lekcji — i przeciągnięciem myszą,
 * i strzałkami z klawiatury. Logika indeksów jest tu, a nie w komponencie, bo to jedyna część
 * tej funkcji, w której da się pomylić o jeden, i jedyna, którą warto przetestować bez
 * przeglądarki.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const lista = [...items];

  // Poza listę nie przestawiamy: strzałka w górę na pierwszym elemencie ma nie robić nic,
  // zamiast przerzucać go na koniec.
  if (from === to || from < 0 || from >= lista.length || to < 0 || to >= lista.length) {
    return [...items];
  }

  const [wyjety] = lista.splice(from, 1);
  lista.splice(to, 0, wyjety as T);
  return lista;
}

/** Czy przestawienie w ogóle coś zmieni — po tym poznajemy, że nie ma czego zapisywać. */
export function wouldMove<T>(items: readonly T[], from: number, to: number): boolean {
  return from !== to && from >= 0 && from < items.length && to >= 0 && to < items.length;
}
