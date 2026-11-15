import { describe, expect, it } from 'vitest';

import { starsFor, toNextStar } from '../scoring.ts';

describe('starsFor', () => {
  it('przyznaje gwiazdki na progach 0,8 / 0,9 / 1,0', () => {
    expect(starsFor(0.79)).toBe(0);
    expect(starsFor(0.8)).toBe(1);
    expect(starsFor(0.89)).toBe(1);
    expect(starsFor(0.9)).toBe(2);
    expect(starsFor(0.99)).toBe(2);
    expect(starsFor(1)).toBe(3);
  });
});

describe('toNextStar', () => {
  it('mówi, ilu procent brakuje do kolejnej gwiazdki', () => {
    expect(toNextStar(0.7)).toBe(10);
    expect(toNextStar(0.85)).toBe(5);
  });

  it('przy komplecie nie ma czego brakować', () => {
    expect(toNextStar(1)).toBeNull();
  });
});
