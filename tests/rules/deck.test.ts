import { describe, expect, it } from 'vitest';
import { createDeck, dealCards, shuffle, shuffleAndDeal } from '../../packages/rules/src';
import { seededRandom } from './helpers';

describe('Fisher–Yates shuffle', () => {
  it('uses the entire [0, i] swap range and does not change input', () => {
    const input = Object.freeze([1, 2, 3, 4]);
    expect(shuffle(input, () => 0)).toEqual([2, 3, 4, 1]);
    expect(shuffle(input, () => 1 - Number.EPSILON)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });
  it('supports empty, singleton and undefined elements without calling RNG unnecessarily', () => {
    const fail = () => { throw new Error('Should not be called'); };
    expect(shuffle([], fail)).toEqual([]);
    expect(shuffle([undefined], fail)).toEqual([undefined]);
    expect(shuffle([undefined, 1], () => 0)).toEqual([1, undefined]);
  });
  it.each([-0.01, 1, Infinity, NaN, -Infinity])('rejects invalid RNG output %s', (value) => {
    expect(() => shuffle([1, 2], () => value)).toThrow(RangeError);
  });
  it('reproduces a seeded permutation without losing double-deck cards', () => {
    const input = createDeck(2);
    const result = shuffle(input, seededRandom(42));
    expect(result).toEqual(shuffle(input, seededRandom(42)));
    expect(result).not.toEqual(shuffle(input, seededRandom(43)));
    expect(result.map((card) => card.cardId).sort()).toEqual(input.map((card) => card.cardId).sort());
    expect(new Set(result.map((card) => card.cardId)).size).toBe(108);
  });
  it('uses exactly n-1 random values', () => {
    let calls = 0;
    shuffle(createDeck(2), () => { calls += 1; return 0.5; });
    expect(calls).toBe(107);
  });
});

describe('dealing', () => {
  for (const deckCount of [1, 2] as const) {
    for (let count = 2; count <= 8; count += 1) {
      for (let dealer = 0; dealer < count; dealer += 1) {
        it(`${deckCount} decks / ${count} players / dealer ${dealer}: counts and conservation`, () => {
          const deck = createDeck(deckCount);
          const result = shuffleAndDeal(deckCount, count, dealer, seededRandom(102));
          expect(result.hands.map((hand) => hand.length)).toEqual(
            Array.from({ length: count }, (_, i) => i === dealer ? 6 : 5),
          );
          expect(result.drawPile).toHaveLength(54 * deckCount - 5 * count - 1);
          const all = [...result.hands.flat(), ...result.drawPile];
          expect(new Set(all.map((card) => card.cardId)).size).toBe(deck.length);
          expect(all.map((card) => card.cardId).sort()).toEqual(deck.map((card) => card.cardId).sort());
        });
      }
    }
  }
  it('uses clockwise deal order and leaves the top of the draw pile intact', () => {
    const deck = createDeck(1);
    const result = dealCards(deck, 3, 1);
    expect(result.hands[1]?.map((card) => card.cardId)).toEqual([0, 3, 6, 9, 12, 15].map((i) => deck[i]?.cardId));
    expect(result.hands[2]?.[0]).toEqual(deck[1]);
    expect(result.hands[0]?.[0]).toEqual(deck[2]);
    expect(result.drawPile[0]).toEqual(deck[16]);
    expect(result.hands[1]?.[0]).not.toBe(deck[0]);
  });
  it.each([[1, 0], [9, 0], [2.5, 0], [2, -1], [2, 2], [2, 0.5]])('rejects invalid seats %j', (count, dealer) => {
    expect(() => dealCards(createDeck(1), count, dealer)).toThrow(RangeError);
  });
  it('rejects insufficient, duplicated, malformed or mismatched physical decks', () => {
    const deck = createDeck(1);
    expect(() => dealCards(deck.slice(1), 2, 0)).toThrow();
    expect(() => dealCards([deck[0], ...deck.slice(0, 53)], 2, 0)).toThrow();
    expect(() => dealCards(deck.map((card, i) => i === 0 ? { ...card, cardId: 'forged' } : card), 2, 0)).toThrow();
    expect(() => dealCards(createDeck(2).filter((card) => card.deckIndex === 1), 2, 0)).toThrow();
  });
});
