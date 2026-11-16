import { describe, expect, it } from 'vitest';

import { formatDuration, LESSONS, plural, pluralForm, spellDuration, WORDS } from '../format.ts';

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

describe('formatDuration', () => {
  it('poniżej minuty nie podaje liczby sekund', () => {
    expect(formatDuration(0)).toBe('< 1 min');
    expect(formatDuration(59)).toBe('< 1 min');
  });

  it('do godziny podaje same minuty, zaokrąglone w dół', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(119)).toBe('1 min');
    expect(formatDuration(1080)).toBe('18 min');
  });

  it('powyżej godziny dopisuje minuty z wiodącym zerem', () => {
    expect(formatDuration(3600)).toBe('1 godz.');
    expect(formatDuration(7500)).toBe('2 godz. 05 min');
    expect(formatDuration(9000)).toBe('2 godz. 30 min');
  });

  it('ujemnego czasu nie pokazuje jako ujemnego', () => {
    expect(formatDuration(-10)).toBe('< 1 min');
  });
});

describe('spellDuration', () => {
  it('odmienia godziny i minuty', () => {
    expect(spellDuration(30)).toBe('niecała minuta');
    expect(spellDuration(300)).toBe('5 minut');
    expect(spellDuration(3600)).toBe('1 godzina');
    expect(spellDuration(7500)).toBe('2 godziny 5 minut');
    expect(spellDuration(18000)).toBe('5 godzin');
  });
});
