import { default_w, FSRS6_DEFAULT_DECAY, S_MAX, S_MIN } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import { DESIRED_RETENTION, FSRS6_BOUNDS, FSRS6_DEFAULT_WEIGHTS, gradeFor, RATING } from '../srs.ts';

/**
 * Stałe skopiowane z implementacji referencyjnej muszą za nią nadążać. Jeśli `ts-fsrs` zmieni
 * wagi albo granice, ten test pada i trzeba świadomie zdecydować, czy je przenosimy — a potem
 * przegenerować przypadki testowe dla bazy (`node scripts/fsrs-fixtures.mjs`).
 */
describe('stałe FSRS-6', () => {
  it('wagi zgadzają się z implementacją referencyjną', () => {
    expect([...FSRS6_DEFAULT_WEIGHTS]).toEqual([...default_w]);
  });

  it('ostatnia waga to wykładnik zaniku', () => {
    expect(FSRS6_DEFAULT_WEIGHTS[20]).toBe(FSRS6_DEFAULT_DECAY);
  });

  it('granice stabilności zgadzają się z implementacją referencyjną', () => {
    expect(FSRS6_BOUNDS.sMin).toBe(S_MIN);
    expect(FSRS6_BOUNDS.sMax).toBe(S_MAX);
  });

  it('docelowa retencja mieści się w sensownym zakresie', () => {
    expect(DESIRED_RETENTION).toBeGreaterThanOrEqual(0.7);
    expect(DESIRED_RETENTION).toBeLessThanOrEqual(0.97);
  });
});

describe('gradeFor', () => {
  it('błędna odpowiedź to „again”', () => {
    expect(gradeFor({ correct: false })).toBe(RATING.again);
    expect(gradeFor({ correct: false, responseMs: 500, singleTap: true })).toBe(RATING.again);
  });

  it('literówka i podpowiedź obniżają ocenę do „hard”', () => {
    expect(gradeFor({ correct: true, nearMiss: true })).toBe(RATING.hard);
    expect(gradeFor({ correct: true, hintUsed: true })).toBe(RATING.hard);
  });

  it('zwykła poprawna odpowiedź to „good”', () => {
    expect(gradeFor({ correct: true })).toBe(RATING.good);
    expect(gradeFor({ correct: true, responseMs: 9000, singleTap: true })).toBe(RATING.good);
  });

  it('„easy” tylko za szybkie dotknięcie, nigdy za pisanie', () => {
    expect(gradeFor({ correct: true, responseMs: 1200, singleTap: true })).toBe(RATING.easy);
    expect(gradeFor({ correct: true, responseMs: 1200, singleTap: false })).toBe(RATING.good);
    expect(gradeFor({ correct: true, responseMs: 1200 })).toBe(RATING.good);
  });

  it('literówka bije szybkość', () => {
    expect(gradeFor({ correct: true, nearMiss: true, responseMs: 800, singleTap: true })).toBe(RATING.hard);
  });
});
