import { describe, expect, it } from 'vitest';
import { LocalSession } from '../../packages/local/src';
import { RemoteSession } from '../../packages/remote/src';
import { parseClientMessage, projectGameSync } from '../../packages/protocol/src';
import { applyCommand } from '../../packages/rules/src';
import type { GameSession } from '../../packages/session/src';
import { seededRandom } from './helpers';
import { fixture } from './protocol-fixtures';

describe('common session contract', () => {
  it('awaits local play/pass without exposing other hands', async () => {
    const local = new LocalSession({ playerCount: 3, deckCount: 1, pointCap: 20 }, seededRandom(2026));
    const session: GameSession = local;
    expect(await session.pass()).toBe(false);
    const hint = session.hint();
    if (!hint) throw new Error('fixture');
    expect(session.selectedInterpretations(hint.cardIds).length).toBeGreaterThan(0);
    expect(await session.play(hint.cardIds, hint.declaration)).toBe(true);
    expect(session.snapshot().view.selfPlayerId).toBe('human');
    expect(session.selectedInterpretations(['not-owned'])).toEqual([]);
  });
  it('awaits authority without optimistic state changes and rejects concurrent submission', async () => {
    const { state, room, sync } = fixture();
    let resolve: (value: unknown) => void = () => { throw new Error('not pending'); };
    let request: unknown;
    const remote: GameSession = new RemoteSession('alice', sync, { request: (encoded) => {
      request = JSON.parse(encoded) as unknown;
      return new Promise((done) => { resolve = done; });
    } }, () => 'req-2');
    const hint = remote.hint();
    if (!hint) throw new Error('fixture');
    const pending = remote.play(hint.cardIds, hint.declaration);
    expect(remote.snapshot().view.public.version).toBe(0);
    expect(await remote.pass()).toBe(false);
    const parsed = parseClientMessage(request);
    if (!parsed.ok || parsed.value.type !== 'play') throw new Error('request');
    expect(parsed.value).toMatchObject({ requestId: 'req-2', roomId: 'room-1', roundId: 'round-1', expectedVersion: 0 });
    expect(request).not.toHaveProperty('playerId');
    const result = applyCommand(state, { type: 'play', playerId: 'alice', expectedVersion: 0,
      cardIds: parsed.value.cardIds, ...(parsed.value.declaration ? { declaration: parsed.value.declaration } : {}) });
    if (!result.ok) throw new Error('fixture');
    resolve(projectGameSync(result.state, room, 'alice', 'req-2'));
    expect(await pending).toBe(true);
    expect(remote.snapshot().view.public.version).toBe(1);
  });
  it('rejects wrong recipient, room, round and stale snapshots', () => {
    const { sync } = fixture();
    expect(() => new RemoteSession('bob', sync, { request: async () => null }, () => 'x')).toThrow();
    const remote = new RemoteSession('alice', sync, { request: async () => null }, () => 'x');
    expect(remote.acceptMessage(sync)).toBe(false);
    if (sync.type !== 'sync') throw new Error('fixture');
    for (const room of [{ ...sync.room, roomId: 'other' }, { ...sync.room, roundId: 'old' }]) {
      expect(remote.acceptMessage({ ...sync, room })).toBe(false);
    }
    expect(remote.snapshot().view.public.version).toBe(0);
  });
  it('rejects malformed, failed and mismatched replies without altering state', async () => {
    for (const reply of [null, { protocolVersion: 1, type: 'error', requestId: 'wrong', roomId: 'room-1',
      roundId: 'round-1', code: 'unauthorized' }]) {
      const { sync } = fixture();
      const remote = new RemoteSession('alice', sync, { request: async () => reply }, () => 'x');
      expect(await remote.pass()).toBe(false);
      expect(remote.snapshot().view.public.version).toBe(0);
    }
    const { sync } = fixture();
    const remote = new RemoteSession('alice', sync, { request: async () => { throw new Error('network'); } }, () => 'x');
    expect(await remote.pass()).toBe(false);
    expect(remote.snapshot().view.public.version).toBe(0);
  });
  it('revokes access on unauthorized response', async () => {
    const { sync } = fixture();
    const remote = new RemoteSession('alice', sync, { request: async () => ({ protocolVersion: 1,
      type: 'error', requestId: 'x', roomId: 'room-1', roundId: 'round-1', code: 'unauthorized' }) }, () => 'x');
    expect(await remote.pass()).toBe(false);
    expect(() => remote.snapshot()).toThrow();
    expect(remote.isPlaying).toBe(false);
    expect(remote.acceptMessage(sync)).toBe(false);
  });
  it('accepts a matching reply even when its snapshot arrived first as a broadcast', async () => {
    const { state, room, sync } = fixture();
    let deliver: (value: unknown) => void = () => { throw new Error('not pending'); };
    const remote = new RemoteSession('alice', sync, { request: () => new Promise((done) => { deliver = done; }) }, () => 'x');
    const hint = remote.hint();
    if (!hint) throw new Error('fixture');
    const pending = remote.play(hint.cardIds, hint.declaration);
    const result = applyCommand(state, { type: 'play', playerId: 'alice', expectedVersion: 0,
      cardIds: hint.cardIds, declaration: hint.declaration });
    if (!result.ok) throw new Error('fixture');
    const reply = projectGameSync(result.state, room, 'alice', 'x');
    expect(remote.acceptMessage(reply)).toBe(true);
    deliver(reply);
    expect(await pending).toBe(true);
  });
  it('performs asynchronous pass using the server result', async () => {
    const { state, room } = fixture();
    const card = state.players[0]?.hand.find((card) => card.kind === 'standard');
    if (!card) throw new Error('fixture');
    const opening = applyCommand(state, { type: 'play', playerId: 'alice', expectedVersion: 0, cardIds: [card.cardId] });
    if (!opening.ok) throw new Error('fixture');
    const remote = new RemoteSession('bob', projectGameSync(opening.state, room, 'bob', 'initial'), {
      request: async (encoded) => {
        const parsed = parseClientMessage(encoded);
        if (!parsed.ok || parsed.value.type !== 'pass') throw new Error('request');
        const next = applyCommand(opening.state, { type: 'pass', playerId: 'bob', expectedVersion: parsed.value.expectedVersion });
        if (!next.ok) throw new Error('pass');
        return projectGameSync(next.state, room, 'bob', parsed.value.requestId);
      },
    }, () => 'pass-request');
    expect(await remote.pass()).toBe(true);
    expect(remote.snapshot().view.public.version).toBe(2);
    expect(remote.snapshot().view.public.turnPlayerId).toBe('alice');
  });
  it('ignores late transport replies after disposal', async () => {
    const { sync } = fixture();
    let deliver: (value: unknown) => void = () => { throw new Error('not pending'); };
    const remote = new RemoteSession('alice', sync, { request: () => new Promise((done) => { deliver = done; }) }, () => 'x');
    const pending = remote.pass();
    remote.dispose(); deliver(sync);
    expect(await pending).toBe(false);
    expect(() => remote.snapshot()).toThrow();
  });

  it('recovers stale state with a private sync and never automatically resubmits the action', async () => {
    const { state, room, sync } = fixture();
    const card = state.players[0]?.hand.find((card) => card.kind === 'standard');
    if (!card) throw new Error('fixture');
    const next = applyCommand(state, { type: 'play', playerId: 'alice', expectedVersion: 0, cardIds: [card.cardId] });
    if (!next.ok) throw new Error('fixture');
    const commands: string[] = []; let sequence = 0;
    const remote = new RemoteSession('alice', sync, { request: async (encoded) => {
      const parsed = parseClientMessage(encoded); if (!parsed.ok) throw new Error('request');
      commands.push(parsed.value.type);
      return parsed.value.type === 'sync' ? projectGameSync(next.state, { ...room, version: room.version + 1 }, 'alice', parsed.value.requestId)
        : { protocolVersion: 1, type: 'error', requestId: parsed.value.requestId, roomId: room.roomId,
            roundId: room.roundId, code: 'stale-version' };
    } }, () => `recovery-${++sequence}`);
    expect(await remote.play([card.cardId])).toBe(false);
    expect(commands).toEqual(['play', 'sync']);
    expect(remote.snapshot().view.public.version).toBe(1);
  });

});
