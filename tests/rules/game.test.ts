import { describe, expect, it } from 'vitest';
import {
  applyCommand, assertStateIntegrity, createDeck, createGame, createPlayerView, createPublicView,
  createRules, resolvePlay, type CommandError, type GameState, type HandDeclaration,
} from '../../packages/rules/src';
import { freeze, ownedIds, scenario, seededRandom, type Rank } from './helpers';

function play(state: GameState, playerId: string, ranks: readonly Rank[], declaration?: HandDeclaration): GameState {
  const result = applyCommand(state, { type: 'play', playerId, expectedVersion: state.version,
    cardIds: ownedIds(state, playerId, ranks), ...(declaration ? { declaration } : {}) });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  assertStateIntegrity(result.state);
  return result.state;
}

function pass(state: GameState, playerId: string): GameState {
  const result = applyCommand(state, { type: 'pass', playerId, expectedVersion: state.version });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  assertStateIntegrity(result.state);
  return result.state;
}

function rejected(state: GameState, command: unknown, error: CommandError): void {
  const before = JSON.stringify(state);
  const result = applyCommand(state, command);
  expect(result).toEqual({ ok: false, state, error });
  expect(result.state).toBe(state);
  expect(JSON.stringify(state)).toBe(before);
}

describe('game creation and configuration snapshots', () => {
  it('starts with the dealer, freezes all state, and reproduces deals', () => {
    const options = { playerIds: ['a', 'b', 'c'], dealerIndex: 1, rules: createRules({ deckCount: 2 }) };
    const state = createGame(options, seededRandom(42));
    expect(state).toEqual(createGame(options, seededRandom(42)));
    expect(state.turnIndex).toBe(1);
    expect(state.players.map((player) => player.hand.length)).toEqual([5, 6, 5]);
    expect(state.drawPile).toHaveLength(92);
    expect(state.version).toBe(0);
    expect(state.bombCount).toBe(0);
    expect(state.table).toBeNull();
    for (const object of [state, state.rules, state.rules.allowedBombSizes, state.players,
      state.players[0], state.players[0]?.hand, state.players[0]?.hand[0], state.drawPile]) {
      expect(Object.isFrozen(object)).toBe(true);
    }
  });
  it('copies configuration and never freezes or mutates caller-owned options', () => {
    const bombs = [3, 4] as (3 | 4)[];
    const rules = createRules({ allowedBombSizes: bombs, roundPointCap: 5 });
    const ids = ['a', 'b'];
    const state = createGame({ playerIds: ids, dealerIndex: 0, rules }, seededRandom(1));
    bombs.push(3);
    ids[0] = 'changed';
    expect(state.rules.allowedBombSizes).toEqual([3, 4]);
    expect(state.players[0]?.playerId).toBe('a');
    expect(Object.isFrozen(bombs)).toBe(false);
    expect(Object.isFrozen(ids)).toBe(false);
  });
  it.each([['a', 'a'], ['a', ''], ['a', ' ']])('rejects invalid player IDs %j', (...ids) => {
    expect(() => createGame({ playerIds: ids, dealerIndex: 0 }, seededRandom(1))).toThrow();
  });
  it('rejects unsupported rule versions', () => {
    expect(() => createGame({ playerIds: ['a', 'b'], dealerIndex: 0,
      rules: { ...createRules(), version: 'unknown' } }, seededRandom(1))).toThrow();
  });
});

describe('turns, passing and refill', () => {
  it('keeps all but the current player out and disallows passing on a free lead', () => {
    const state = scenario([['3', '9'], ['4', '10']]);
    rejected(state, { type: 'play', playerId: 'p1', expectedVersion: 0, cardIds: ownedIds(state, 'p1', ['4']) }, 'not-your-turn');
    rejected(state, { type: 'pass', playerId: 'p0', expectedVersion: 0 }, 'cannot-pass');
  });
  it('resets consecutive passes after a new play and allows a previous passer to follow again', () => {
    let state = scenario([['3', '6', '9'], ['5', '10'], ['4', 'J']]);
    state = play(state, 'p0', ['3']);
    state = pass(state, 'p1');
    expect(state.consecutivePasses).toBe(1);
    state = play(state, 'p2', ['4']);
    expect(state.consecutivePasses).toBe(0);
    state = pass(state, 'p0');
    state = play(state, 'p1', ['5']);
    expect(state.consecutivePasses).toBe(0);
    expect(state.table?.playerId).toBe('p1');
  });
  it('requires all other players to pass and refills once in leader-first seat order', () => {
    let state = scenario([['3', '9'], ['4', '10'], ['5', 'J']], ['6', '7', '8', 'Q']);
    state = play(state, 'p0', ['3']);
    state = play(state, 'p1', ['4']);
    state = pass(state, 'p2');
    expect(state.drawPile.map((card) => card.rank)).toEqual(['6', '7', '8', 'Q']);
    state = pass(state, 'p0');
    expect(state.table).toBeNull();
    expect(state.turnIndex).toBe(1);
    expect(state.consecutivePasses).toBe(0);
    expect(state.players.map((player) => player.hand.map((card) => card.rank))).toEqual([
      ['9', '8'], ['10', '6'], ['5', 'J', '7'],
    ]);
    expect(state.drawPile.map((card) => card.rank)).toEqual(['Q']);
    expect(state.discardPile.filter((card) => card.rank === '3' || card.rank === '4').length).toBeGreaterThan(1);
  });
  it('handles partial refill and continues after the pile is exhausted', () => {
    let state = scenario([['3', '9'], ['4', '10'], ['5', 'J']], ['6']);
    state = play(state, 'p0', ['3']);
    state = play(state, 'p1', ['4']);
    state = pass(state, 'p2');
    state = pass(state, 'p0');
    expect(state.players.map((player) => player.hand.length)).toEqual([1, 2, 2]);
    expect(state.players[1]?.hand.map((card) => card.rank)).toEqual(['10', '6']);
    expect(state.drawPile).toEqual([]);
    state = play(state, 'p1', ['6']);
    state = pass(state, 'p2');
    state = pass(state, 'p0');
    expect(state.status).toBe('playing');
    expect(state.turnIndex).toBe(1);
    expect(state.drawPile).toEqual([]);
    expect(state.players[1]?.hand.map((card) => card.rank)).toEqual(['10']);
  });
});

describe('illegal commands leave the exact snapshot untouched', () => {
  it('rejects missing ownership, duplicate IDs, stale versions and malformed commands', () => {
    const state = scenario([['3', '9'], ['4', '10']]);
    const ids = ownedIds(state, 'p0', ['3']);
    rejected(state, { type: 'play', playerId: 'p0', expectedVersion: 0, cardIds: ownedIds(state, 'p1', ['4']) }, 'not-owned');
    rejected(state, { type: 'play', playerId: 'p0', expectedVersion: 0, cardIds: [ids[0], ids[0]] }, 'invalid-command');
    rejected(state, { type: 'play', playerId: 'p0', expectedVersion: 1, cardIds: ids }, 'stale-version');
    rejected(state, { type: 'pass', playerId: 'outsider', expectedVersion: 0 }, 'unknown-player');
    for (const input of [null, [], {}, { type: 'pass', playerId: 'p0' },
      { type: 'play', playerId: 'p0', expectedVersion: 0, cardIds: [] },
      { type: 'play', playerId: 'p0', expectedVersion: 0, cardIds: new Array(1) },
      { type: 'pass', playerId: 'p0', expectedVersion: 0, bombCount: 99 },
      { type: 'play', playerId: 'p0', expectedVersion: 0, cardIds: ids, declaration: { kind: 'bomb', primaryRank: '3', secret: 1 } }]) {
      rejected(state, input, 'invalid-command');
    }
  });
  it('rejects illegal combinations, forged declarations and nonadjacent responses', () => {
    let state = scenario([['3', '9'], ['5', '5', 'small-joker', '10']]);
    rejected(state, { type: 'play', playerId: 'p0', expectedVersion: 0,
      cardIds: ownedIds(state, 'p0', ['3', '9']) }, 'invalid-play');
    state = play(state, 'p0', ['3']);
    rejected(state, { type: 'play', playerId: 'p1', expectedVersion: 1,
      cardIds: ownedIds(state, 'p1', ['5']) }, 'invalid-play');
    rejected(state, { type: 'play', playerId: 'p1', expectedVersion: 1,
      cardIds: ownedIds(state, 'p1', ['small-joker']) }, 'invalid-play');
    rejected(state, { type: 'play', playerId: 'p1', expectedVersion: 1,
      cardIds: ownedIds(state, 'p1', ['5', '5', 'small-joker']), declaration: { kind: 'bomb', primaryRank: '6' } }, 'invalid-play');
    expect(state.bombCount).toBe(0);
  });
  it('rejects a weaker bomb without increasing global count, and honors disabled bomb sizes', () => {
    let state = scenario([['5', '5', '5', '9'], ['3', '3', '3', '10']]);
    state = play(state, 'p0', ['5', '5', '5']);
    rejected(state, { type: 'play', playerId: 'p1', expectedVersion: state.version,
      cardIds: ownedIds(state, 'p1', ['3', '3', '3']) }, 'invalid-play');
    expect(state.bombCount).toBe(1);
    const disabled = scenario([['3', '3', '3', '9'], ['4']], [], { allowedBombSizes: [4] });
    rejected(disabled, { type: 'play', playerId: 'p0', expectedVersion: 0,
      cardIds: ownedIds(disabled, 'p0', ['3', '3', '3']) }, 'invalid-play');
  });
  it('copies command arrays and declarations rather than retaining caller-owned mutable data', () => {
    const state = scenario([['3', '3', 'small-joker', '9'], ['4']]);
    const ids = [...ownedIds(state, 'p0', ['3', '3', 'small-joker'])];
    const declaration: HandDeclaration = { kind: 'bomb', primaryRank: '3' };
    const result = applyCommand(state, { type: 'play', playerId: 'p0', expectedVersion: 0,
      cardIds: ids, declaration });
    expect(result.ok).toBe(true);
    ids.length = 0;
    Object.assign(declaration, { primaryRank: '4' });
    expect(result.state.table?.cardIds).toHaveLength(3);
    expect(result.state.table?.hand.primaryRank).toBe('3');
    expect(result.state.bombCount).toBe(1);
    expect(Object.isFrozen(declaration)).toBe(false);
  });
});

describe('bomb accumulation and final settlement', () => {
  it('counts global bombs across players and tricks, includes the winning bomb and settles exactly once', () => {
    let state = scenario([['3', '3', '3', '5', '5', '5'], ['4', '4', '4', '9'], ['10', 'J']], [], { roundPointCap: 20 });
    state = play(state, 'p0', ['3', '3', '3']);
    expect(state.bombCount).toBe(1);
    const beforeSecond = state;
    const command = { type: 'play', playerId: 'p1', expectedVersion: state.version,
      cardIds: ownedIds(state, 'p1', ['4', '4', '4']) };
    const result = applyCommand(state, command);
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.bombCount).toBe(2);
    rejected(state, command, 'stale-version');
    expect(beforeSecond.bombCount).toBe(1);
    state = pass(state, 'p2');
    state = pass(state, 'p0');
    expect(state.bombCount).toBe(2);
    state = play(state, 'p1', ['9']);
    expect(state.status).toBe('finished');
    expect(state.settlement?.scores.map((score) => score.delta)).toEqual([-12, 20, -8]);
    rejected(state, { type: 'pass', playerId: 'p2', expectedVersion: state.version }, 'game-finished');

    let lastBomb = scenario([['3', '3', 'small-joker'], ['4', '5']], [], { roundPointCap: 50 });
    lastBomb = play(lastBomb, 'p0', ['3', '3', 'small-joker'], { kind: 'bomb', primaryRank: '3' });
    expect(lastBomb.bombCount).toBe(1);
    expect(lastBomb.settlement?.multiplier).toBe(2);
    expect(lastBomb.settlement?.scores.map((score) => score.delta)).toEqual([4, -4]);
  });
  it('wins immediately without drawing even if the common pile still has cards', () => {
    let state = scenario([['3', '4', '5'], ['6', '7']], ['8', '9']);
    const initialPile = state.drawPile;
    state = play(state, 'p0', ['3', '4', '5']);
    expect(state.status).toBe('finished');
    expect(state.drawPile).toEqual(initialPile);
    expect(state.settlement?.winnerId).toBe('p0');
  });
  it('can finish on a wildcard combination and does not count an ambiguous ordinary play as a bomb', () => {
    let state = scenario([['3', 'small-joker', 'big-joker'], ['4', '5']]);
    state = play(state, 'p0', ['3', 'small-joker', 'big-joker']);
    expect(state.status).toBe('finished');
    expect(state.table?.hand.kind).toBe('straight');
    expect(state.bombCount).toBe(0);
    expect(state.settlement?.scores.map((score) => score.delta)).toEqual([2, -2]);
  });
});

describe('unresolved joker-only lead', () => {
  it('allows passing, then suspends without inventing victory or settlement', () => {
    let state = scenario([['3', 'big-joker'], ['5', '9']]);
    state = play(state, 'p0', ['3']);
    expect(state.status).toBe('playing');
    state = pass(state, 'p1');
    expect(state.status).toBe('awaiting-rule');
    expect(state.pendingRule).toBe('joker-only-lead');
    expect(state.settlement).toBeNull();
    expect(state.players[0]?.hand.map((card) => card.rank)).toEqual(['big-joker']);
    rejected(state, { type: 'pass', playerId: 'p0', expectedVersion: state.version }, 'awaiting-rule');
  });
  it('performs the normal refill before deciding whether the lead is blocked', () => {
    let state = scenario([['3', 'big-joker'], ['5', '9']], ['6']);
    state = play(state, 'p0', ['3']);
    state = pass(state, 'p1');
    expect(state.status).toBe('playing');
    expect(state.players[0]?.hand.map((card) => card.rank)).toEqual(['big-joker', '6']);
    state = play(state, 'p0', ['big-joker', '6']);
    expect(state.status).toBe('finished');
  });
  it('does not pause merely because a nonleading player has only jokers', () => {
    let state = scenario([['3', 'big-joker'], ['4']]);
    state = play(state, 'p0', ['3']);
    state = play(state, 'p1', ['4']);
    expect(state.status).toBe('finished');
    expect(state.pendingRule).toBeNull();
    expect(state.settlement?.scores.map((score) => score.delta)).toEqual([-1, 1]);
  });
});

describe('privacy projections', () => {
  it('excludes all private cards and hidden draw order from public serialization', () => {
    const state = createGame({ playerIds: ['a', 'b', 'c'], dealerIndex: 0 }, seededRandom(9));
    const serialized = JSON.stringify(createPublicView(state));
    for (const player of state.players) {
      for (const card of player.hand) expect(serialized).not.toContain(card.cardId);
    }
    for (const card of state.drawPile) expect(serialized).not.toContain(card.cardId);
    expect(serialized).not.toContain('drawPile"');
    expect(serialized).not.toContain('discardPile');
    const own = createPlayerView(state, 'b');
    expect(own.hand).toEqual(state.players[1]?.hand);
    expect(own.hand).not.toBe(state.players[1]?.hand);
    for (const card of state.players[0]?.hand || []) expect(JSON.stringify(own)).not.toContain(card.cardId);
    expect(() => createPlayerView(state, 'outsider')).toThrow();
    expect(Object.isFrozen(own.hand[0])).toBe(true);
  });
  it('exposes only played cards at the table, with no references to hidden state arrays', () => {
    let state = scenario([['3', '9'], ['4', '10']], ['J']);
    const playedId = ownedIds(state, 'p0', ['3'])[0];
    state = play(state, 'p0', ['3']);
    const view = createPublicView(state);
    expect(view.table?.cardIds).toEqual([playedId]);
    expect(view.table).not.toBe(state.table);
    expect(view.table?.hand).not.toBe(state.table?.hand);
    expect(Object.isFrozen(view.table?.hand)).toBe(true);
    for (const card of [...state.players.flatMap((player) => player.hand), ...state.drawPile]) {
      expect(JSON.stringify(view)).not.toContain(card.cardId);
    }
  });
});

describe('card conservation over real transition sequences', () => {
  for (const decks of [1, 2] as const) {
    for (const count of [2, 3, 8]) {
      for (const seed of [1, 17, 2026]) {
        it(`maintains every physical card: ${decks} decks / ${count} players / seed ${seed}`, () => {
          let state = createGame({ playerIds: Array.from({ length: count }, (_, i) => `p${i}`),
            dealerIndex: count - 1, rules: createRules({ deckCount: decks }) }, seededRandom(seed));
          const ids = createDeck(decks).map((card) => card.cardId).sort();
          let steps = 0;
          while (state.status === 'playing' && steps < 2000) {
            const actor = state.players[state.turnIndex];
            if (!actor) throw new Error('Missing actor');
            const card = actor.hand.find((held) => resolvePlay([held], state.rules, state.table?.hand || null));
            const command = card ? { type: 'play', playerId: actor.playerId, expectedVersion: state.version, cardIds: [card.cardId] }
              : { type: 'pass', playerId: actor.playerId, expectedVersion: state.version };
            const before = JSON.stringify(state);
            const result = applyCommand(state, command);
            expect(result.ok).toBe(true);
            expect(JSON.stringify(state)).toBe(before);
            state = result.state;
            assertStateIntegrity(state);
            const all = [...state.players.flatMap((player) => player.hand), ...state.drawPile, ...state.discardPile];
            expect(all.map((entry) => entry.cardId).sort()).toEqual(ids);
            steps += 1;
          }
          expect(steps).toBeLessThan(2000);
          expect(['finished', 'awaiting-rule']).toContain(state.status);
          if (state.settlement) expect(state.settlement.scores.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
        });
      }
    }
  }
  it('detects a duplicate card even if the total card count remains unchanged', () => {
    const state = scenario([['3', '9'], ['4', '10']], ['J']);
    const card = state.players[0]?.hand[0];
    expect(() => assertStateIntegrity(freeze({ ...state, drawPile: [card] }))).toThrow();
  });
});
