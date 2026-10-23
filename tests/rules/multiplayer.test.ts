import { describe, expect, it } from 'vitest';
import { createDeck, type DeckCount, type Card } from '../../packages/rules/src';
import { findLegalPlays, selfContext, selfHint } from '../../packages/session/src';
import { encodeServerMessage } from '../../packages/protocol/src';
import { secureRandom } from '../../server/src/secure-random';
import { setupMultiplayer, type MultiplayerFixture } from './multiplayer-fixtures';

function playRound(fixture: MultiplayerFixture) {
  const discards = new Set<string>(); let refilled = false;
  for (let step = 0; step < 2000; step += 1) {
    const views = fixture.players.map((player) => player.view());
    const first = views[0]?.self; if (!first) throw new Error('self');
    const state = first.public;
    const dealt = views.flatMap((view) => view.self?.hand.map((card) => card.cardId) || []);
    expect(new Set(dealt).size).toBe(dealt.length);
    expect(dealt.length + state.drawPileCount + discards.size).toBe(state.rules.deckCount * 54);
    for (let index = 0; index < views.length; index += 1) {
      const view = views[index]; if (!view?.self) throw new Error('self');
      expect(view.self.selfPlayerId).toBe(fixture.players[index]?.id);
      expect(view.self.public).toEqual(state);
      const serialized = encodeServerMessage(view);
      for (let other = 0; other < views.length; other += 1) if (other !== index) {
        for (const card of views[other]?.self?.hand || []) expect(serialized).not.toContain(card.cardId);
      }
      expect(serialized).not.toContain('drawPile"');
      expect(serialized).not.toContain('discardPile');
    }
    if (state.status !== 'playing') {
      expect(state.status).toBe('finished');
      expect(refilled).toBe(true);
      const settlement = state.settlement; if (!settlement) throw new Error('settlement');
      expect(settlement.scores.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
      expect(settlement.scores.filter((score) => score.playerId !== settlement.winnerId)
        .every((score) => score.delta <= 0 && -score.delta <= state.rules.roundPointCap)).toBe(true);
      return settlement;
    }
    const actor = fixture.players.find((player) => player.id === state.turnPlayerId);
    if (!actor?.view().self) throw new Error('actor');
    const self = actor.view().self; if (!self) throw new Error('self');
    const hint = selfHint(self);
    const command = hint ? { type: 'play', cardIds: hint.cardIds, declaration: hint.declaration }
      : { type: 'pass' };
    const reply = actor.send({ ...command, expectedVersion: state.version });
    expect(reply.type).toBe('sync');
    if (hint) hint.cardIds.forEach((id) => discards.add(id));
    const next = actor.view().self?.public; if (!next) throw new Error('next');
    expect(next.version).toBe(state.version + 1);
    if (next.drawPileCount < state.drawPileCount) refilled = true;
  }
  throw new Error('Round did not terminate');
}

describe('authoritative real-player game service', () => {
  for (const count of [2, 6, 8]) for (const deckCount of [1, 2] as const) for (const cap of [5, 50]) {
    it(`finishes ${count} players / ${deckCount} decks / cap ${cap}, then deals to the previous winner`, () => {
      const fixture = setupMultiplayer(count, deckCount, cap);
      const first = fixture.host.view(); const firstHand = first.self?.hand.map((card) => card.cardId);
      expect(first.self?.public.turnPlayerId).toBe(fixture.host.id);
      expect(first.self?.hand.length).toBe(6);
      expect(fixture.players.slice(1).every((player) => player.view().self?.hand.length === 5)).toBe(true);
      const settlement = playRound(fixture);
      const final = fixture.host.view();
      expect(final.room.players.every((player) => !player.ready)).toBe(true);
      expect(fixture.host.send({ type: 'start' })).toMatchObject({ code: 'not-ready' });
      const unchanged = fixture.host.view();
      expect(fixture.host.send({ type: 'pass', expectedVersion: final.self?.public.version })).toMatchObject({ code: 'game-finished' });
      expect(fixture.host.view()).toEqual(unchanged);
      for (const player of fixture.players) player.send({ type: 'ready', ready: true });
      fixture.resetRandom();
      const next = fixture.host.send({ type: 'start' });
      if (next.type !== 'sync' || !next.self) throw new Error('next');
      expect(next.room.roundId).not.toBe(first.room.roundId);
      expect(next.self.public).toMatchObject({ version: 0, bombCount: 0, multiplier: 1, settlement: null,
        turnPlayerId: settlement.winnerId });
      const dealer = fixture.players.find((player) => player.id === settlement.winnerId);
      expect(dealer?.view().self?.hand.length).toBe(6);
      expect(fixture.players.filter((player) => player.id !== settlement.winnerId).every((player) => player.view().self?.hand.length === 5)).toBe(true);
      expect(fixture.host.send({ type: 'play', roundId: first.room.roundId, expectedVersion: 0,
        cardIds: firstHand?.slice(0, 1), declaration: null })).toMatchObject({ code: 'wrong-round' });
      expect(fixture.host.view().self?.public.version).toBe(0);
    });
  }
  it('rejects impersonation, foreign cards, stale actions, duplicate IDs, and client score injection', () => {
    const { host, players } = setupMultiplayer(2);
    const guest = players[1]; if (!guest) throw new Error('guest');
    const before = host.view(); const own = before.self?.hand.find((card) => card.kind === 'standard');
    const other = guest.view().self?.hand[0]; if (!own || !other) throw new Error('cards');
    expect(guest.send({ type: 'play', cardIds: [other.cardId], declaration: null, expectedVersion: 0 })).toMatchObject({ code: 'not-your-turn' });
    expect(guest.send({ type: 'play', playerId: host.id, cardIds: [own.cardId], declaration: null, expectedVersion: 0 })).toMatchObject({ code: 'invalid-message' });
    expect(host.send({ type: 'play', cardIds: [other.cardId], declaration: null, expectedVersion: 0 })).toMatchObject({ code: 'not-owned' });
    expect(host.send({ type: 'play', cardIds: [own.cardId, own.cardId], declaration: null, expectedVersion: 0 })).toMatchObject({ code: 'invalid-message' });
    expect(host.send({ type: 'play', cardIds: [own.cardId], declaration: null, expectedVersion: 1 })).toMatchObject({ code: 'stale-version' });
    expect(host.send({ type: 'play', cardIds: [own.cardId], declaration: null, expectedVersion: 0, settlement: { delta: 999 } })).toMatchObject({ code: 'invalid-message' });
    expect(host.view()).toEqual(before); expect(guest.view().self?.public.version).toBe(0);
  });
  it('applies exactly one of two concurrent-version actions and rejects a cross-room actor', () => {
    const one = setupMultiplayer(2); const another = setupMultiplayer(2);
    const own = one.host.view().self?.hand.filter((card) => card.kind === 'standard');
    if (!own?.[0] || !own[1]) throw new Error('cards');
    expect(one.host.send({ type: 'play', cardIds: [own[0].cardId], declaration: null, expectedVersion: 0 }).type).toBe('sync');
    expect(one.host.send({ type: 'play', cardIds: [own[1].cardId], declaration: null, expectedVersion: 0 })).toMatchObject({ code: 'stale-version' });
    const replies: unknown[] = [];
    const outsider = one.service.connect((message) => replies.push(message));
    one.service.receive(outsider, { protocolVersion: 1, requestId: 'x', type: 'play', roomId: one.roomId,
      roundId: one.host.view().room.roundId, expectedVersion: 1, cardIds: [own[1].cardId], declaration: null });
    expect(replies[replies.length - 1]).toMatchObject({ code: 'forbidden' });
    expect(one.host.view().self?.public.version).toBe(1);
    expect(another.host.view().self?.public.version).toBe(0);
  });
});

/** Compute random choices for a desired test deck, without adding a server state override. */
function deckRandom(target: readonly Card[], deckCount: DeckCount) {
  const working = [...createDeck(deckCount)]; const values: number[] = [];
  for (let index = working.length - 1; index > 0; index -= 1) {
    const cardId = target[index]?.cardId;
    const choice = working.findIndex((card) => card.cardId === cardId);
    if (choice < 0 || choice > index) throw new Error('deck permutation');
    values.push((choice + 0.5) / (index + 1));
    const a = working[index]; const b = working[choice]; if (!a || !b) throw new Error('index');
    working[index] = b; working[choice] = a;
  }
  let index = 0; return () => { const value = values[index]; index += 1; if (value === undefined) throw new Error('random exhausted'); return value; };
}
describe('bomb, settlement and pause boundaries through real service commands', () => {
  it('includes winning bombs, refills in order, deduplicates play and settles only once', () => {
    const deck = createDeck(1); const ids = ['0:clubs:3','0:clubs:5','0:diamonds:3','0:clubs:6',
      '0:hearts:3','0:clubs:7','0:clubs:4','0:clubs:8','0:diamonds:4','0:clubs:9','0:hearts:4','0:spades:4','0:clubs:10'];
    const top = ids.map((id) => { const card = deck.find((card) => card.cardId === id); if (!card) throw new Error('card'); return card; });
    const fixture = setupMultiplayer(2, 1, 5, deckRandom([...top, ...deck.filter((card) => ids.indexOf(card.cardId) < 0)], 1));
    const guest = fixture.players[1]; if (!guest) throw new Error('guest');
    const command = { type: 'play', cardIds: ['0:clubs:3','0:diamonds:3','0:hearts:3'], declaration: { kind: 'bomb', primaryRank: '3' }, expectedVersion: 0 };
    const first = fixture.host.send(command, 'bomb');
    expect(fixture.host.send(command, 'bomb')).toEqual(first);
    expect(fixture.host.send({ ...command, cardIds: ['0:clubs:4'] }, 'bomb')).toMatchObject({ code: 'request-conflict' });
    expect(fixture.host.view().self?.public.bombCount).toBe(1);
    guest.send({ type: 'pass', expectedVersion: 1 });
    expect(fixture.host.view().self?.hand.some((card) => card.cardId === '0:spades:4')).toBe(true);
    const win = { type: 'play', cardIds: ['0:clubs:4','0:diamonds:4','0:hearts:4','0:spades:4'], declaration: { kind: 'bomb', primaryRank: '4' }, expectedVersion: 2 };
    const finished = fixture.host.send(win, 'win');
    expect(fixture.host.view().self?.public.settlement).toMatchObject({ multiplier: 4, bombCount: 2,
      scores: [{ delta: 5, remainingCards: 0 }, { delta: -5, remainingCards: 6 }] });
    expect(fixture.host.send(win, 'win')).toEqual(finished);
    expect(fixture.host.send(win, 'new-win')).toMatchObject({ code: 'game-finished' });
    expect(fixture.host.view()).toEqual(finished);
  });
  it('preserves the unresolved joker-only lead as a pause without scoring or starting another round', () => {
    const deck = createDeck(1);
    const jokers = deck.filter((card) => card.kind === 'joker');
    const target = [...jokers, ...deck.filter((card) => card.kind === 'standard')];
    const fixture = setupMultiplayer(2, 1, 20, deckRandom(target, 1));
    for (let step = 0; step < 1000; step += 1) {
      const view = fixture.host.view().self; if (!view) throw new Error('self');
      if (view.public.status !== 'playing') {
        expect(view.public.status).toBe('awaiting-rule');
        expect(view.public.settlement).toBeNull();
        expect(fixture.host.send({ type: 'start' })).toMatchObject({ code: 'wrong-phase' });
        expect(fixture.host.send({ type: 'pass', expectedVersion: view.public.version })).toMatchObject({ code: 'awaiting-rule' });
        return;
      }
      const actor = fixture.players.find((player) => player.id === view.public.turnPlayerId);
      const self = actor?.view().self; if (!actor || !self) throw new Error('actor');
      const single = findLegalPlays(selfContext(self)).find((play) => play.hand.kind === 'single');
      const reply = actor.send(single ? { type: 'play', cardIds: single.cardIds, declaration: single.declaration,
        expectedVersion: self.public.version } : { type: 'pass', expectedVersion: self.public.version });
      expect(reply.type).toBe('sync');
    }
    throw new Error('Expected unresolved-rule pause');
  });
  it('deals six cards and the opening turn to a non-host winner in the next round', () => {
    const deck = createDeck(1);
    const ids = ['0:clubs:3','0:clubs:4','0:clubs:J','0:clubs:5','0:clubs:Q','0:clubs:6',
      '0:clubs:K','0:clubs:7','0:clubs:A','0:clubs:8','0:clubs:2','0:clubs:9','0:clubs:10'];
    const top = ids.map((id) => { const card = deck.find((card) => card.cardId === id); if (!card) throw new Error('card'); return card; });
    const firstShuffle = deckRandom([...top, ...deck.filter((card) => ids.indexOf(card.cardId) < 0)], 1);
    let draws = 0;
    const fixture = setupMultiplayer(2, 1, 20, () => { draws += 1; return draws <= 53 ? firstShuffle() : 0.5; });
    const guest = fixture.players[1]; if (!guest) throw new Error('guest');
    fixture.host.send({ type: 'play', expectedVersion: 0, cardIds: ['0:clubs:3'], declaration: null });
    guest.send({ type: 'play', expectedVersion: 1, cardIds: ['0:clubs:4'], declaration: null });
    fixture.host.send({ type: 'pass', expectedVersion: 2 });
    guest.send({ type: 'play', expectedVersion: 3,
      cardIds: ['0:clubs:5','0:clubs:6','0:clubs:7','0:clubs:8','0:clubs:9'], declaration: { kind: 'straight', primaryRank: '5' } });
    expect(guest.view().self?.public.settlement?.winnerId).toBe(guest.id);
    fixture.host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true });
    const next = fixture.host.send({ type: 'start' });
    expect(next).toMatchObject({ type: 'sync', room: { hostPlayerId: fixture.host.id }, self: { public: { turnPlayerId: guest.id } } });
    expect(guest.view().self?.hand.length).toBe(6); expect(fixture.host.view().self?.hand.length).toBe(5);
  });
  it('uses a finite server random source in the required range', () => {
    const values = Array.from({ length: 32 }, secureRandom);
    expect(values.every((value) => Number.isFinite(value) && value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});
