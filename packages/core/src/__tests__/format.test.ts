import { describe, expect, it } from 'vitest';

import { LESSONS, plural, pluralForm, WORDS } from '../format.ts';

describe('pluralForm', () => {
  it('dla jedynki daje formę pojedynczą', () => {
    expect(pluralForm(1, WORDS)).toBe('słówko');
  });

  it('dla 2-4 daje formę mnogą bliższą', () => {
    expect(pluralForm(2, WORDS)).toBe('słówka');
    expect(pluralForm(23, WORDS)).toBe('słówka');
    expect(pluralForm(104, WORDS)).toBe('słówka');
  });

  it('dla nastek daje formę dopełniaczową, mimo końcówki 2-4', () => {
    expect(pluralForm(12, WORDS)).toBe('słówek');
    expect(pluralForm(113, WORDS)).toBe('słówek');
  });

  it('dla zera i 5-21 daje formę dopełniaczową', () => {
    expect(pluralForm(0, WORDS)).toBe('słówek');
    expect(pluralForm(5, WORDS)).toBe('słówek');
    expect(pluralForm(21, WORDS)).toBe('słówek');
  });

  it('skleja liczbę z odmienionym rzeczownikiem', () => {
    expect(plural(3, LESSONS)).toBe('3 lekcje');
    expect(plural(5, LESSONS)).toBe('5 lekcji');
  });
});
