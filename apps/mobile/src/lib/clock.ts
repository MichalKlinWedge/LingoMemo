/**
 * Stoper do pomiarów PoC. Poza komponentem, bo `Date.now()` wywołane w ciele komponentu jest
 * wywołaniem niepewnym przy ponownym renderze — i słusznie odbija to linter Reacta.
 *
 * `const took = stopwatch(); … const ms = took();`
 */
export function stopwatch(): () => number {
  const began = Date.now();
  return () => Date.now() - began;
}

/** Data w strefie telefonu w formacie kolumny `due_on`. W UTC „dziś" bywa wczoraj. */
export function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
