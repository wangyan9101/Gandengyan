import { describe, expect, it } from 'vitest';
import {
  canBeatHand, createDeck, createRules, recognizeHands, resolvePlay, RANK_ORDER,
  type Hand, type HandKind,
} from '../../packages/rules/src';
import { selectCards, type Rank } from './helpers';

const rules = createRules({ deckCount: 2 });
function hand(ranks: readonly Rank[], kind?: HandKind): Hand {
  const result = recognizeHands(selectCards(ranks), rules).find((entry) => !kind || entry.kind === kind);
  if (!result) throw new Error(`Invalid test hand ${ranks}`);
  return result;
}

describe('natural hand recognition', () => {
  const examples: { ranks: Rank[]; kind: HandKind }[] = [
    { ranks: ['3'], kind: 'single' },
    { ranks: ['A', 'A'], kind: 'pair' },
    { ranks: ['2', '2'], kind: 'pair' },
    { ranks: ['5', '3', '4'], kind: 'straight' },
    { ranks: ['3', '4', '5', '6'], kind: 'straight' },
    { ranks: ['Q', 'K', 'A'], kind: 'straight' },
    { ranks: ['3', '3', '4', '4'], kind: 'consecutive-pairs' },
    { ranks: ['3', '3', '4', '4', '5', '5'], kind: 'consecutive-pairs' },
  ];
  it.each(examples)('recognizes $kind / $ranks', ({ ranks, kind }) => {
    expect(recognizeHands(selectCards(ranks), rules).map((entry) => entry.kind)).toContain(kind);
  });
  it.each([3, 4, 5, 6, 7, 8])('recognizes %i-card bombs', (size) => {
    const result = hand(Array.from({ length: size }, () => '3'), 'bomb');
    expect(result.cardCount).toBe(size);
    expect(result.primaryRank).toBe('3');
  });
  const invalid: Rank[][] = [[], ['3', '4'], ['3', '3', '4'], ['A', '2', '3'], ['K', 'A', '2'],
    ['3', '4', '6'], ['3', '3', '5', '5'], ['K', 'K', 'A', 'A', '2', '2'],
    ['small-joker'], ['big-joker'], ['small-joker', 'big-joker'],
    ['small-joker', 'big-joker', 'small-joker'],
    ['3', '3', '3', '3', '3', '3', '3', '3', 'big-joker']];
  it.each(invalid.map((ranks) => ({ ranks })))('rejects invalid $ranks', ({ ranks }) => {
    expect(recognizeHands(selectCards(ranks), rules)).toEqual([]);
  });
  it('accepts the maximum straight and consecutive-pair lengths', () => {
    const ranks = RANK_ORDER.slice(0, 12);
    expect(hand(ranks).cardCount).toBe(12);
    expect(hand(ranks.flatMap((rank) => [rank, rank])).cardCount).toBe(24);
  });
  it('honors configurable minimum lengths and bomb sizes', () => {
    const strict = createRules({ deckCount: 2, straightMinLength: 4, consecutivePairsMinLength: 3,
      allowedBombSizes: [4, 8] });
    for (const ranks of [['3', '4', '5'], ['3', '3', '4', '4'], ['3', '3', '3']] as Rank[][]) {
      expect(recognizeHands(selectCards(ranks), strict)).toEqual([]);
    }
    expect(recognizeHands(selectCards(['3', '3', '3', '3']), strict)[0]?.kind).toBe('bomb');
  });
  it('distinguishes identical suit/rank cards across decks but rejects duplicate IDs and forged metadata', () => {
    const copies = createDeck(2).filter((card) => card.rank === '3' && card.suit === 'clubs');
    expect(resolvePlay(copies, rules)?.kind).toBe('pair');
    const card = copies[0];
    expect(recognizeHands([card, card], rules)).toEqual([]);
    expect(recognizeHands([{ ...card, rank: '4' }], rules)).toEqual([]);
    expect(recognizeHands(copies, createRules({ deckCount: 1 }))).toEqual([]);
  });
});

describe('wildcards', () => {
  it('uses either joker only together with at least one natural card', () => {
    for (const joker of ['small-joker', 'big-joker'] as const) {
      expect(hand(['3', joker]).wildAssignments[0]?.rank).toBe('3');
      expect(hand(['2', joker]).primaryRank).toBe('2');
    }
  });
  it('returns all interpretations and uses explicit declarations to disambiguate bombs', () => {
    const cards = selectCards(['3', 'small-joker', 'big-joker']);
    expect(recognizeHands(cards, rules).map((entry) => [entry.kind, entry.primaryRank])).toEqual([
      ['straight', '3'], ['bomb', '3'],
    ]);
    expect(resolvePlay(cards, rules)?.kind).toBe('straight');
    expect(resolvePlay(cards, rules, null, { kind: 'bomb', primaryRank: '3' })?.kind).toBe('bomb');
    expect(resolvePlay(cards, rules, null, { kind: 'bomb', primaryRank: '4' })).toBeNull();
  });
  it('fills gaps, shifts to the legal adjacent interpretation, and ignores input order', () => {
    const cards = selectCards(['4', '5', 'big-joker']);
    expect(recognizeHands(cards, rules).map((entry) => entry.primaryRank)).toEqual(['3', '4']);
    const result = resolvePlay(cards, rules, hand(['3', '4', '5']));
    expect(result?.primaryRank).toBe('4');
    expect(result?.wildAssignments[0]?.rank).toBe('6');
    expect(recognizeHands([...cards].reverse(), rules)).toEqual(recognizeHands(cards, rules));
  });
  it('fills consecutive pairs without allowing 2 in sequences', () => {
    expect(hand(['3', '4', 'small-joker', 'big-joker'], 'consecutive-pairs').wildAssignments.map((entry) => entry.rank))
      .toEqual(['3', '4']);
    expect(recognizeHands(selectCards(['A', '2', 'big-joker']), rules)).toEqual([]);
  });
  it('allows 6-card single-deck wild bombs and 8-card double-deck bombs, but never over 8', () => {
    expect(resolvePlay(selectCards(['3', '3', '3', '3', 'small-joker', 'big-joker'], 1),
      createRules(), null, { kind: 'bomb', primaryRank: '3' })?.cardCount).toBe(6);
    expect(hand(['3', '3', '3', '3', 'small-joker', 'big-joker', 'small-joker', 'big-joker'], 'bomb').cardCount).toBe(8);
  });
});

describe('following rules', () => {
  it.each(['single', 'pair'] as const)('%s follows exactly one rank, with 2 as a special response', (kind) => {
    const size = kind === 'single' ? 1 : 2;
    const at = (rank: Rank) => hand(Array.from({ length: size }, () => rank));
    expect(canBeatHand(at('4'), at('3'))).toBe(true);
    expect(canBeatHand(at('5'), at('3'))).toBe(false);
    expect(canBeatHand(at('3'), at('3'))).toBe(false);
    expect(canBeatHand(at('2'), at('3'))).toBe(true);
    expect(canBeatHand(at('2'), at('A'))).toBe(true);
    expect(canBeatHand(at('2'), at('2'))).toBe(false);
    expect(canBeatHand(at('3'), at('2'))).toBe(false);
  });
  it('requires equal sequence lengths and adjacent starts', () => {
    expect(canBeatHand(hand(['4', '5', '6']), hand(['3', '4', '5']))).toBe(true);
    expect(canBeatHand(hand(['5', '6', '7']), hand(['3', '4', '5']))).toBe(false);
    expect(canBeatHand(hand(['4', '5', '6', '7']), hand(['3', '4', '5']))).toBe(false);
    expect(canBeatHand(hand(['4', '4', '5', '5']), hand(['3', '3', '4', '4']))).toBe(true);
    expect(canBeatHand(hand(['5', '5', '6', '6']), hand(['3', '3', '4', '4']))).toBe(false);
    expect(canBeatHand(hand(['4', '4', '5', '5', '6', '6']), hand(['3', '3', '4', '4']))).toBe(false);
  });
  it('lets bombs beat every ordinary type, compares size before rank, and requires strict superiority', () => {
    const bomb = hand(['3', '3', '3']);
    for (const ordinary of [hand(['2']), hand(['2', '2']), hand(['Q', 'K', 'A']), hand(['K', 'K', 'A', 'A'])]) {
      expect(canBeatHand(bomb, ordinary)).toBe(true);
      expect(canBeatHand(ordinary, bomb)).toBe(false);
    }
    expect(canBeatHand(hand(['3', '3', '3', '3']), hand(['2', '2', '2']))).toBe(true);
    expect(canBeatHand(hand(['4', '4', '4']), bomb)).toBe(true);
    expect(canBeatHand(bomb, bomb)).toBe(false);
    expect(canBeatHand(hand(['3', '3', 'big-joker'], 'bomb'), bomb)).toBe(false);
  });
  it('never compares different ordinary types', () => {
    expect(canBeatHand(hand(['4', '4']), hand(['3']))).toBe(false);
  });
});
