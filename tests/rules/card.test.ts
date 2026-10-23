import { describe, expect, it } from 'vitest';
import { assertUniqueCards, createDeck, isCard, STANDARD_RANKS, SUITS } from '../../packages/rules/src';

describe('physical deck', () => {
  it.each([1, 2] as const)('builds %i complete decks with unique physical IDs', (count) => {
    const cards = createDeck(count);
    expect(cards).toHaveLength(count * 54);
    expect(new Set(cards.map((card) => card.cardId)).size).toBe(count * 54);
    expect(cards.filter((card) => card.kind === 'joker')).toHaveLength(count * 2);
    for (let index = 0; index < count; index += 1) {
      const deck = cards.filter((card) => card.deckIndex === index);
      expect(deck).toHaveLength(54);
      for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
        const suited = deck.filter((card) => card.kind === 'standard' && card.suit === suit);
        expect(suited).toHaveLength(13);
        expect(new Set(suited.map((card) => card.rank)).size).toBe(13);
      }
      expect(deck.filter((card) => card.rank === 'small-joker')).toHaveLength(1);
      expect(deck.filter((card) => card.rank === 'big-joker')).toHaveLength(1);
    }
  });

  it('returns independent results without shared mutable cards', () => {
    const first = createDeck(2);
    const second = createDeck(2);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.forEach((card, index) => expect(card).not.toBe(second[index]));
  });

  it.each([0, 3, 1.5, NaN, undefined, '1'])('rejects invalid runtime deck count %s', (value) => {
    expect(() => createDeck(value as 1)).toThrow(RangeError);
  });
  it('validates joker suit, physical identity and sparse card arrays', () => {
    expect(Object.isFrozen(STANDARD_RANKS)).toBe(true);
    expect(Object.isFrozen(SUITS)).toBe(true);
    expect(createDeck(2).every(isCard)).toBe(true);
    expect(isCard(null)).toBe(false);
    expect(isCard({ ...createDeck(1)[0], deckIndex: 2 })).toBe(false);
    expect(isCard({ ...createDeck(1)[52], suit: 'clubs' })).toBe(false);
    expect(() => assertUniqueCards(new Array(1))).toThrow(RangeError);
  });
});
