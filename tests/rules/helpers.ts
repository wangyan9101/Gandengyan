import {
  assertStateIntegrity, createDeck, createGame, createRules,
  type Card, type DeckCount, type GameState, type RuleOptions,
} from '../../packages/rules/src';

export type Rank = Card['rank'];

/** Test-only LCG, never suitable as a server shuffle RNG. */
export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function selectCards(ranks: readonly Rank[], deckCount: DeckCount = 2): readonly Card[] {
  const available = [...createDeck(deckCount)];
  return ranks.map((rank) => {
    const index = available.findIndex((card) => card.rank === rank);
    if (index < 0) throw new Error(`Insufficient ${rank} in fixture`);
    const card = available.splice(index, 1)[0];
    if (!card) throw new Error('Fixture allocation failed');
    return card;
  });
}

export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Mid-round fixture: every unassigned physical card is explicitly in discards. */
export function scenario(
  hands: readonly (readonly Rank[])[], draw: readonly Rank[] = [], options: RuleOptions = {}, dealerIndex = 0,
): GameState {
  const rules = createRules({ deckCount: 2, ...options });
  const original = createGame({ playerIds: hands.map((_, i) => `p${i}`), dealerIndex, rules }, seededRandom(1));
  const available = [...createDeck(rules.deckCount)];
  const take = (rank: Rank): Card => {
    const index = available.findIndex((card) => card.rank === rank);
    if (index < 0) throw new Error(`Insufficient ${rank} in scenario`);
    const card = available.splice(index, 1)[0];
    if (!card) throw new Error('Fixture allocation failed');
    return card;
  };
  const players = hands.map((ranks, index) => ({ playerId: `p${index}`, hand: ranks.map(take) }));
  const drawPile = draw.map(take);
  const state: GameState = { ...original, players, drawPile, discardPile: available };
  assertStateIntegrity(state);
  return freeze(state);
}

export function ownedIds(state: GameState, playerId: string, ranks: readonly Rank[]): readonly string[] {
  const available = [...(state.players.find((player) => player.playerId === playerId)?.hand || [])];
  return ranks.map((rank) => {
    const index = available.findIndex((card) => card.rank === rank);
    if (index < 0) throw new Error('Not held in fixture');
    const card = available.splice(index, 1)[0];
    if (!card) throw new Error('Fixture allocation failed');
    return card.cardId;
  });
}
