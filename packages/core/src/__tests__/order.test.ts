import { describe, expect, it } from 'vitest';

import { moveItem, wouldMove } from '../order.ts';

const lista = ['a', 'b', 'c', 'd'];

describe('moveItem', () => {
  it('przesuwa element w dół o jedno miejsce', () => {
    expect(moveItem(lista, 0, 1)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('przesuwa element w górę o jedno miejsce', () => {
    expect(moveItem(lista, 2, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('przenosi z początku na koniec', () => {
    expect(moveItem(lista, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('przenosi z końca na początek', () => {
    expect(moveItem(lista, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('nie rusza listy, gdy element wraca na swoje miejsce', () => {
    expect(moveItem(lista, 2, 2)).toEqual(lista);
  });

  it('nie wypycha elementu poza listę', () => {
    expect(moveItem(lista, 0, -1)).toEqual(lista);
    expect(moveItem(lista, 3, 4)).toEqual(lista);
  });

  it('nie zmienia listy wejściowej', () => {
    const wejscie = [...lista];
    moveItem(wejscie, 0, 2);
    expect(wejscie).toEqual(lista);
  });

  it('zachowuje wszystkie elementy', () => {
    expect([...moveItem(lista, 1, 3)].sort()).toEqual([...lista].sort());
  });
});

describe('wouldMove', () => {
  it('wie, kiedy nie ma czego zapisywać', () => {
    expect(wouldMove(lista, 1, 1)).toBe(false);
    expect(wouldMove(lista, 0, -1)).toBe(false);
    expect(wouldMove(lista, 3, 4)).toBe(false);
    expect(wouldMove(lista, 0, 1)).toBe(true);
  });
});
