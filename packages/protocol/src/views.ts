import { createDeck, isCard, resolvePlay, settleRound, type Card, type RuleConfig,
  type Hand, type TablePlay, type Settlement } from '../../rules/src';
import type { PublicRoomView, PublicGameView, SelfGameView } from './messages';
import { object, integer, stringValue, oneOf, array, nullable, booleanValue, record, invalid, type Schema } from './schema';

export const id = stringValue(128);
export const version = integer(0, Number.MAX_SAFE_INTEGER);
const rank = oneOf('3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2');
export const declaration = object({ kind: oneOf('single', 'pair', 'straight', 'consecutive-pairs', 'bomb'), primaryRank: rank });
export const rulesSchema: Schema<RuleConfig> = (input) => {
  const value = object<RuleConfig>({ version: oneOf('gdy-default-v1'), deckCount: oneOf(1, 2),
    allowedBombSizes: array(oneOf(3, 4, 5, 6, 7, 8), 1, 6), roundPointCap: integer(5, 50),
    straightMinLength: integer(3, 12), consecutivePairsMinLength: integer(2, 12) })(input);
  if (new Set(value.allowedBombSizes).size !== value.allowedBombSizes.length) return invalid();
  return value;
};
const cardSchema: Schema<Card> = (input) => {
  const value = record(input);
  const card = value.kind === 'standard'
    ? object({ cardId: stringValue(64), deckIndex: oneOf(0, 1), kind: oneOf('standard'),
        suit: oneOf('clubs', 'diamonds', 'hearts', 'spades'), rank })(input)
    : object({ cardId: stringValue(64), deckIndex: oneOf(0, 1), kind: oneOf('joker'),
        suit: oneOf('joker'), rank: oneOf('small-joker', 'big-joker') })(input);
  return isCard(card) ? card : invalid();
};
const handSchema = object<Hand>({ ...{ kind: oneOf('single', 'pair', 'straight', 'consecutive-pairs', 'bomb'), primaryRank: rank },
  cardCount: integer(1, 24), sequenceLength: integer(1, 12),
  wildAssignments: array(object({ cardId: stringValue(64), rank }), 0, 4) });
const tableSchema = object<TablePlay>({ playerId: id, cardIds: array(stringValue(64), 1, 24), hand: handSchema });
const settlementSchema = object<Settlement>({ winnerId: id, bombCount: integer(0, 36),
  multiplier: integer(1, 2 ** 36), pointCap: integer(5, 50),
  scores: array(object({ playerId: id, remainingCards: integer(0, 108), delta: integer(-50, 350) }), 2, 8) });
const publicShape = object<PublicGameView>({ version, status: oneOf('playing', 'finished', 'awaiting-rule'),
  pendingRule: nullable(oneOf('joker-only-lead')), rules: rulesSchema,
  players: array(object({ playerId: id, handCount: integer(0, 108) }), 2, 8), turnPlayerId: id,
  drawPileCount: integer(0, 108), consecutivePasses: integer(0, 6), bombCount: integer(0, 36),
  multiplier: integer(1, 2 ** 36), table: nullable(tableSchema), settlement: nullable(settlementSchema) });
export const publicGameSchema: Schema<PublicGameView> = (input) => {
  const value = publicShape(input);
  const ids = value.players.map((player) => player.playerId);
  if (new Set(ids).size !== ids.length || ids.indexOf(value.turnPlayerId) < 0 ||
      value.multiplier !== 2 ** value.bombCount || value.consecutivePasses >= ids.length - 1 ||
      value.drawPileCount + value.players.reduce((sum, player) => sum + player.handCount, 0) > value.rules.deckCount * 54) return invalid();
  if (value.table) {
    const table = value.table;
    const deck = createDeck(value.rules.deckCount);
    const cards = table.cardIds.map((cardId) => deck.find((card) => card.cardId === cardId));
    if (ids.indexOf(table.playerId) < 0 || cards.some((card) => !card)) return invalid();
    const resolved = resolvePlay(cards.filter((card) => card !== undefined), value.rules, null, table.hand);
    if (!resolved || JSON.stringify(resolved) !== JSON.stringify(table.hand)) return invalid();
  } else if (value.consecutivePasses !== 0) return invalid();
  if (value.status === 'finished') {
    if (!value.settlement || value.pendingRule !== null) return invalid();
    const expected = settleRound(value.players.map((player) => ({ playerId: player.playerId, remainingCards: player.handCount })),
      value.settlement.winnerId, value.bombCount, value.rules.roundPointCap);
    if (JSON.stringify(expected) !== JSON.stringify(value.settlement)) return invalid();
  } else if (value.settlement || value.players.some((player) => player.handCount === 0)) return invalid();
  if (value.status === 'awaiting-rule') {
    if (value.pendingRule !== 'joker-only-lead' || value.table) return invalid();
  } else if (value.pendingRule !== null) return invalid();
  return value;
};
export const selfGameSchema: Schema<SelfGameView> = (input) => {
  const value = object<SelfGameView>({ selfPlayerId: id, public: publicGameSchema, hand: array(cardSchema, 0, 108) })(input);
  const self = value.public.players.find((player) => player.playerId === value.selfPlayerId);
  if (!self || self.handCount !== value.hand.length || new Set(value.hand.map((card) => card.cardId)).size !== value.hand.length ||
      value.hand.some((card) => card.deckIndex >= value.public.rules.deckCount || (value.public.table ? value.public.table.cardIds.indexOf(card.cardId) >= 0 : false))) return invalid();
  return value;
};
export const roomSchema: Schema<PublicRoomView> = (input) => {
  const value = object<PublicRoomView>({ roomId: id, version, roundId: nullable(id),
    status: oneOf('waiting', 'locked', 'playing', 'finished', 'awaiting-rule'), capacity: integer(2, 8), hostPlayerId: id,
    rules: rulesSchema, players: array(object({ playerId: id, displayName: stringValue(40), seat: integer(0, 7),
      ready: booleanValue, connected: booleanValue }), 1, 8) })(input);
  if (value.players.length > value.capacity || value.players.some((player) => player.seat >= value.capacity) ||
      !value.players.some((player) => player.playerId === value.hostPlayerId) ||
      new Set(value.players.map((player) => player.playerId)).size !== value.players.length ||
      new Set(value.players.map((player) => player.seat)).size !== value.players.length ||
      ((value.status === 'waiting' || value.status === 'locked') ? value.roundId !== null : value.roundId === null)) return invalid();
  return value;
};
