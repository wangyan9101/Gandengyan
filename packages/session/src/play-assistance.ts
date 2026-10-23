import {
  RANK_ORDER, resolvePlay, type Card, type Hand, type HandDeclaration, type RuleConfig,
} from '../../rules/src';

/** Only the acting player's hand and public information enter the planner. */
export interface AiContext {
  readonly playerId: string;
  readonly version: number;
  readonly hand: readonly Card[];
  readonly rules: RuleConfig;
  readonly previous: Hand | null;
}

export interface LegalPlay {
  readonly cardIds: readonly string[];
  readonly declaration: HandDeclaration;
  readonly hand: Hand;
}

/** Generates bounded rank templates, then delegates every legality decision to the engine. */
export function findLegalPlays(context: AiContext): readonly LegalPlay[] {
  const natural = context.hand.filter((card) => card.kind === 'standard');
  const jokers = context.hand.filter((card) => card.kind === 'joker');
  const plays: LegalPlay[] = [];
  const seen = new Set<string>();
  const add = (declaration: HandDeclaration, ranks: readonly string[], copies: number): void => {
    const size = ranks.length * copies;
    if (size > context.hand.length) return;
    const selected: Card[] = [];
    for (const rank of ranks) selected.push(...natural.filter((card) => card.rank === rank).slice(0, copies));
    if (selected.length === 0 || size - selected.length > jokers.length) return;
    const minimumWilds = size - selected.length;
    const maximumWilds = size === 1 ? 0 : Math.min(jokers.length, size - 1);
    for (let wildCount = minimumWilds; wildCount <= maximumWilds; wildCount += 1) {
      const cards = [...selected.slice(0, size - wildCount), ...jokers.slice(0, wildCount)];
      const interpreted = resolvePlay(cards, context.rules, context.previous, declaration);
      if (!interpreted) continue;
      const cardIds = cards.map((card) => card.cardId);
      const key = `${declaration.kind}:${declaration.primaryRank}:${[...cardIds].sort().join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plays.push({ cardIds: Object.freeze(cardIds), declaration: Object.freeze({ ...declaration }), hand: interpreted });
    }
  };
  for (const rank of RANK_ORDER) {
    add({ kind: 'single', primaryRank: rank }, [rank], 1);
    add({ kind: 'pair', primaryRank: rank }, [rank], 2);
    for (const size of context.rules.allowedBombSizes) add({ kind: 'bomb', primaryRank: rank }, [rank], size);
  }
  for (const kind of ['straight', 'consecutive-pairs'] as const) {
    const sequenceRanks = RANK_ORDER.filter((rank) => rank !== '2');
    const minimum = kind === 'straight' ? context.rules.straightMinLength : context.rules.consecutivePairsMinLength;
    for (let length = minimum; length <= sequenceRanks.length; length += 1) {
      for (let start = 0; start + length <= sequenceRanks.length; start += 1) {
        const ranks = sequenceRanks.slice(start, start + length);
        const rank = ranks[0];
        if (rank) add({ kind, primaryRank: rank }, ranks, kind === 'straight' ? 1 : 2);
      }
    }
  }
  const naturalIds = new Set(natural.map((card) => card.cardId));
  const leavesOnlyJokers = (play: LegalPlay): number =>
    Number(play.cardIds.length < context.hand.length &&
      play.cardIds.filter((id) => naturalIds.has(id)).length === natural.length);
  plays.sort((a, b) =>
    Number(b.cardIds.length === context.hand.length) - Number(a.cardIds.length === context.hand.length) ||
    leavesOnlyJokers(a) - leavesOnlyJokers(b) ||
    b.hand.wildAssignments.length - a.hand.wildAssignments.length || b.cardIds.length - a.cardIds.length ||
    Number(a.hand.kind === 'bomb') - Number(b.hand.kind === 'bomb') ||
    RANK_ORDER.indexOf(a.hand.primaryRank) - RANK_ORDER.indexOf(b.hand.primaryRank));
  return Object.freeze(plays.map((play) => Object.freeze(play)));
}
