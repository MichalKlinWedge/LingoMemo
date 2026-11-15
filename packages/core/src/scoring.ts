/**
 * Progi gwiazdek. Te same liczby są w `finish_lesson_session` w bazie — tutaj służą wyłącznie do
 * pokazania, ile brakuje do kolejnej gwiazdki. Wynik zapisany w bazie zawsze pochodzi z bazy.
 */
export const STAR_THRESHOLDS = [0.8, 0.9, 1] as const;

/** Liczba gwiazdek (0–3) dla wyniku w zakresie 0–1. */
export function starsFor(score: number): 0 | 1 | 2 | 3 {
  if (score >= STAR_THRESHOLDS[2]) return 3;
  if (score >= STAR_THRESHOLDS[1]) return 2;
  if (score >= STAR_THRESHOLDS[0]) return 1;
  return 0;
}

/** Ile procent brakuje do następnej gwiazdki; `null`, gdy są już trzy. */
export function toNextStar(score: number): number | null {
  const next = STAR_THRESHOLDS.find((threshold) => score < threshold);
  if (next === undefined) return null;
  // Zaokrąglenie przed `ceil`: 0,8 - 0,7 to w zmiennoprzecinkowym 0,1000…09, czyli 11%, nie 10%.
  return Math.ceil(Math.round((next - score) * 10000) / 100);
}
