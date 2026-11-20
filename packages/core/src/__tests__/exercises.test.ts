import { describe, expect, it } from 'vitest';

import { EXERCISE_ICON, EXERCISE_LABEL, EXERCISE_TYPES, exerciseHeading } from '../exercises.ts';

describe('polecenie nad zadaniem', () => {
  it('każdy rodzaj zadania ma znaczek i krótkie polecenie', () => {
    for (const type of EXERCISE_TYPES) {
      const heading = exerciseHeading(type);
      expect(heading, type).not.toBeNull();
      expect(heading?.icon).toBe(EXERCISE_ICON[type]);
      expect(heading?.label).toBe(EXERCISE_LABEL[type]);
      // Polecenie czyta dziecko nad zadaniem, więc ma być jednym krótkim zdaniem bez kropki.
      expect(heading?.label.length, type).toBeLessThanOrEqual(26);
      expect(heading?.label.endsWith('.'), type).toBe(false);
    }
  });

  it('nieznany rodzaj nie daje polecenia', () => {
    // Zamiast surowej nazwy z bazy („fill_blank_typing") lepiej nie pokazać nic — tak wygląda
    // aplikacja starsza od bazy, w której ktoś właśnie dodał nowy rodzaj zadania.
    expect(exerciseHeading('cos_nowego')).toBeNull();
    expect(exerciseHeading('')).toBeNull();
  });
});
