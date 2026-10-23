import { LocalSession } from '../../packages/local/src';
import { seededRandom } from './helpers';
import { describe, expect, it } from 'vitest';
import { createRules, applyCommand } from '../../packages/rules/src';
import { parseClientMessage, parseServerMessage, encodeServerMessage, projectGameSync,
  MAX_MESSAGE_LENGTH } from '../../packages/protocol/src';

import { fixture } from './protocol-fixtures';

const base = { protocolVersion: 1, requestId: 'req-1', roomId: 'room-1', roundId: null, expectedVersion: 0 };

describe('protocol requests', () => {
  const requests = [
    { ...base, type: 'create-room', roomId: null, capacity: 8, rules: createRules({ deckCount: 2 }) },
    { ...base, type: 'join-room' }, { ...base, type: 'ready', ready: true }, { ...base, type: 'start' },
    { ...base, type: 'play', roundId: 'round-1', cardIds: ['0:clubs:3'], declaration: null },
    { ...base, type: 'pass', roundId: 'round-1' }, { ...base, type: 'sync' },
  ];
  for (const request of requests) it(`accepts ${request.type} JSON and object`, () => {
    expect(parseClientMessage(request).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify(request)).ok).toBe(true);
  });
  for (const field of ['requestId', 'roomId', 'roundId', 'expectedVersion', 'protocolVersion']) {
    it(`requires ${field}`, () => {
      const request: Record<string, unknown> = { ...base, type: 'sync' };
      delete request[field]; expect(parseClientMessage(request).ok).toBe(false);
    });
  }
  it('rejects identity spoofing, oversized and invalid input', () => {
    for (const input of [null, [], '{', ' '.repeat(MAX_MESSAGE_LENGTH + 1),
      { ...base, type: 'sync', playerId: 'bob' }, { ...base, type: 'sync', expectedVersion: -1 },
      { ...base, type: 'sync', protocolVersion: 2 }, { ...base, type: 'sync', expectedVersion: NaN },
      { ...base, type: 'ready', ready: 1 },
      { ...base, type: 'create-room', roomId: null, capacity: 9, rules: createRules() },
      { ...base, type: 'play', roundId: 'round-1', cardIds: ['x', 'x'], declaration: null },
      { ...base, type: 'play', roundId: 'round-1', cardIds: Array(25).fill('x'), declaration: null },
      { ...base, type: 'play', roundId: 'round-1', cardIds: ['x'], declaration: { kind: 'bomb', primaryRank: 'joker' } },
    ]) expect(parseClientMessage(input).ok).toBe(false);
  });
});

describe('view privacy and response boundary', () => {
  it('projects only authorized self cards and never serializes trusted state', () => {
    const { state, room, sync } = fixture();
    const encoded = encodeServerMessage(sync);
    for (const card of state.players[1]?.hand || []) expect(encoded).not.toContain(card.cardId);
    for (const card of state.drawPile) expect(encoded).not.toContain(card.cardId);
    for (const actor of [null, 'intruder']) {
      const denied = projectGameSync(state, room, actor, 'req-1');
      expect(denied.type).toBe('error');
      const text = encodeServerMessage(denied);
      for (const card of state.players[0]?.hand || []) expect(text).not.toContain(card.cardId);
      expect(text).not.toContain('self');
    }
    const nonMemberRoom = { ...room, players: room.players.filter((player) => player.playerId !== 'alice') };
    expect(projectGameSync(state, nonMemberRoom, 'alice', 'denied').type).toBe('error');
    expect(parseServerMessage(state).ok).toBe(false);
    expect(parseServerMessage(encoded).ok).toBe(true);
  });
  it('rejects extra private fields recursively on both inbound and outbound paths', () => {
    const { state, sync } = fixture();
    const inputs = [
      { ...sync, state },
      sync.type === 'sync' ? { ...sync, room: { ...sync.room, hands: state.players } } : null,
      sync.type === 'sync' && sync.self ? { ...sync, self: { ...sync.self,
        public: { ...sync.self.public, players: state.players } } } : null,
      sync.type === 'sync' && sync.self ? { ...sync, self: { ...sync.self, public: { ...sync.self.public, drawPile: state.drawPile } } } : null,
      sync.type === 'sync' && sync.self ? { ...sync, self: { ...sync.self,
        hand: sync.self.hand.map((card) => ({ ...card, token: 'private' })) } } : null,
      { protocolVersion: 1, type: 'error', requestId: 'x', roomId: null, roundId: null, code: 'unauthorized', self: state },
    ];
    for (const input of inputs) {
      expect(parseServerMessage(input).ok).toBe(false);
      expect(() => encodeServerMessage(input)).toThrow();
    }
  });
  it('checks counts, duplicate seats, hand ownership identity and immutable copies', () => {
    const { sync } = fixture();
    if (sync.type !== 'sync' || !sync.self) throw new Error('fixture');
    for (const input of [
      { ...sync, self: { ...sync.self, selfPlayerId: 'intruder' } },
      { ...sync, self: { ...sync.self, hand: [] } },
      { ...sync, room: { ...sync.room, status: 'waiting', roundId: null } },
      { ...sync, room: { ...sync.room, players: sync.room.players.map((player) => ({ ...player, seat: 0 })) } },
      { ...sync, self: { ...sync.self, hand: sync.self.hand.map(() => sync.self?.hand[0]) } },
    ]) expect(parseServerMessage(input).ok).toBe(false);
    const parsed = parseServerMessage(sync);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== 'sync' || !parsed.value.self) throw new Error('fixture');
    expect(parsed.value.self.hand).not.toBe(sync.self.hand);
    expect(Object.isFrozen(parsed.value.self.hand[0])).toBe(true);
  });
  it('roundtrips real table projections using existing rule interpretation', () => {
    const { state, room } = fixture();
    const card = state.players[0]?.hand.find((card) => card.kind === 'standard');
    if (!card) throw new Error('fixture');
    const result = applyCommand(state, { type: 'play', playerId: 'alice', expectedVersion: 0, cardIds: [card.cardId] });
    if (!result.ok) throw new Error('fixture');
    expect(parseServerMessage(projectGameSync(result.state, room, 'bob', 'r2')).ok).toBe(true);
  });
  it('accepts lobby snapshots without private data and all snapshots of a real local round', () => {
    const { room } = fixture();
    expect(parseServerMessage({ protocolVersion: 1, type: 'sync', requestId: null,
      room: { ...room, status: 'waiting', roundId: null }, self: null }).ok).toBe(true);
    const local = new LocalSession({ playerCount: 3, deckCount: 2, pointCap: 20 }, seededRandom(2026));
    for (let step = 0; step < 1000; step += 1) {
      const view = local.snapshot().view;
      const roundRoom = { ...room, status: view.public.status, capacity: 3, rules: view.public.rules,
        players: view.public.players.map((player, seat) => ({ playerId: player.playerId,
          displayName: player.playerId, seat, ready: true, connected: true })) , hostPlayerId: 'human' };
      expect(parseServerMessage({ protocolVersion: 1, type: 'sync', requestId: null, room: roundRoom, self: view }).ok).toBe(true);
      if (!local.isPlaying) { expect(view.public.status).toBe('finished'); return; }
      if (local.isHumanTurn) {
        const hint = local.hint();
        if (hint) local.play(hint.cardIds, hint.declaration); else local.pass();
      } else local.stepAi();
    }
    throw new Error('Round did not finish');
  });

});
