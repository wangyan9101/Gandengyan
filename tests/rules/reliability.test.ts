import { describe, expect, it } from 'vitest';
import { RoomService } from '../../server/src/room-service';
import { createRules } from '../../packages/rules/src';
import { selfHint } from '../../packages/session/src';
import { parseResumeRequest, parseSessionCredentials, type ServerMessage, type SessionCredentials } from '../../packages/protocol/src';
import { seededRandom } from './helpers';

type Sync = Extract<ServerMessage, { type: 'sync' }>;
function setup(count = 2, deckCount: 1 | 2 = 1) {
  let now = 0;
  const service = new RoomService(seededRandom(2026), { now: () => now, retentionMs: 1000, turnTimeoutMs: 100 });
  function player() {
    const inbox: ServerMessage[] = [];
    let credential: SessionCredentials | null = null;
    let connection = '';
    let sequence = 0;
    let brokenTransport = false;
    const send = (message: ServerMessage) => { if (brokenTransport) throw new Error('send failed'); inbox.push(message); };
    const auth = (frame: SessionCredentials) => {
      expect(parseSessionCredentials(frame).ok).toBe(true); credential = frame;
      if (frame.snapshot) inbox.push(frame.snapshot);
    };
    connection = service.connect(send, auth);
    const id = connection;
    const view = (): Sync => {
      const last = [...inbox].reverse().find((message): message is Sync => message.type === 'sync');
      if (!last) throw new Error('No snapshot'); return last;
    };
    return { id, inbox, view, breakTransport: () => { brokenTransport = true; }, disconnect: () => service.disconnect(connection),
      token: () => { if (!credential) throw new Error('No credential'); return credential.resumeToken; },
      resume: () => {
        if (!credential) throw new Error('No credential');
        const token = credential.resumeToken;
        connection = service.connect(send, auth);
        return service.resume(connection, { protocolVersion: 1, type: 'resume', resumeToken: token });
      },
      send: (action: object, requestId?: string) => {
        const sync = [...inbox].reverse().find((message): message is Sync => message.type === 'sync');
        sequence += 1;
        service.receive(connection, { protocolVersion: 1, requestId: requestId || `r${sequence}`,
          roomId: sync?.room.roomId || null, roundId: sync?.room.roundId || null,
          expectedVersion: sync?.room.version || 0, ...action });
        const last = inbox[inbox.length - 1]; if (!last) throw new Error('No response'); return last;
      },
    };
  }
  const players = Array.from({ length: count }, player);
  const host = players[0]; if (!host) throw new Error('host');
  host.send({ type: 'create-room', capacity: count, rules: createRules({ deckCount }) });
  const roomId = host.view().room.roomId;
  players.slice(1).forEach((member) => member.send({ type: 'join-room', roomId, roundId: null }));
  function start() {
    players.forEach((member) => member.send({ type: 'ready', ready: true }));
    host.send({ type: 'start' }); service.tick();
  }
  return { service, host, players, roomId, player, start, advance: (delta: number) => { now += delta; service.tick(); } };
}

describe('session recovery, privacy and interruption policy', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8]) for (const decks of [1, 2] as const) {
    it(`restores every identity and private hand after all ${count} players disconnect (${decks} decks)`, () => {
      const fixture = setup(count, decks); fixture.start();
      const before = fixture.players.map((member) => member.view());
      fixture.players.forEach((member) => member.disconnect());
      fixture.players.forEach((member, index) => {
        expect(member.resume()).toBe(true);
        const previous = before[index]; if (!previous) throw new Error('before');
        expect(member.view().self).toEqual(previous.self);
        expect(member.view().room.roundId).toBe(previous.room.roundId);
        expect(member.view().room.players.find((entry) => entry.playerId === member.id)).toMatchObject({ connected: true, ready: false });
        const own = new Set(member.view().self?.hand.map((card) => card.cardId));
        for (const other of before.filter((entry) => entry.self?.selfPlayerId !== member.id)) {
          for (const card of other.self?.hand || []) {
            expect(own.has(card.cardId)).toBe(false);
            expect(JSON.stringify(member.view())).not.toContain(card.cardId);
          }
        }
        expect(JSON.stringify(member.view().room)).not.toContain(member.token());
      });
    });
  }
  it('requires an unguessable credential, revokes the old socket and rejects old-socket commands', () => {
    const fixture = setup(); fixture.start();
    const stranger = fixture.player();
    expect(fixture.service.resume(stranger.id, { protocolVersion: 1, type: 'resume', resumeToken: fixture.host.id })).toBe(false);
    expect(fixture.service.resume(stranger.id, { protocolVersion: 1, type: 'resume', resumeToken: '0'.repeat(64) })).toBe(false);
    expect(fixture.host.resume()).toBe(true); // live connection takeover is authorized by the secret, not playerId
    const before = fixture.host.view();
    fixture.service.disconnect(fixture.host.id); // stale socket close cannot disconnect its replacement
    fixture.service.receive(fixture.host.id, { protocolVersion: 1, requestId: 'old-socket', type: 'sync',
      roomId: fixture.roomId, roundId: before.room.roundId, expectedVersion: 0 });
    expect(fixture.host.view()).toEqual(before);
    expect(fixture.host.send({ type: 'sync' })).toMatchObject({ type: 'sync' });
    expect(fixture.host.view().room.players[0]?.connected).toBe(true);
  });
  it('retains command receipts across reconnect and cannot play the same cards twice', () => {
    const fixture = setup(); fixture.start();
    const initial = fixture.host.view().self; if (!initial) throw new Error('self');
    const hint = selfHint(initial); if (!hint) throw new Error('hint');
    const action = { type: 'play', cardIds: hint.cardIds, declaration: hint.declaration,
      expectedVersion: initial.public.version };
    const accepted = fixture.host.send(action, 'committed-but-ack-lost');
    fixture.host.disconnect(); expect(fixture.host.resume()).toBe(true);
    expect(fixture.host.send(action, 'committed-but-ack-lost')).toEqual(accepted);
    expect(fixture.host.send({ ...action, cardIds: ['0:clubs:2'] }, 'committed-but-ack-lost')).toMatchObject({ code: 'request-conflict' });
    fixture.host.send({ type: 'sync' });
    expect(fixture.host.view().self?.public.version).toBe(initial.public.version + 1);
    expect(fixture.host.send(action, 'different-id')).toMatchObject({ code: 'stale-version' });
  });
  it('releases waiting seats, transfers host to the earliest online seat and reuses gaps safely', () => {
    const fixture = setup(3);
    const guest = fixture.players[1]; const last = fixture.players[2];
    if (!guest || !last) throw new Error('members');
    guest.disconnect();
    expect(fixture.host.send({ type: 'leave' })).toMatchObject({ type: 'left', retained: false });
    expect(last.view().room.hostPlayerId).toBe(last.id);
    const newcomer = fixture.player(); newcomer.send({ type: 'join-room', roomId: fixture.roomId, roundId: null });
    expect(newcomer.view().room.players.find((member) => member.playerId === newcomer.id)?.seat).toBe(0);
    expect(newcomer.view().room.hostPlayerId).toBe(last.id);
    expect(fixture.host.send({ type: 'sync', roomId: fixture.roomId })).toMatchObject({ code: 'forbidden' });
    // Cached responses must not leak a former room snapshot after explicit departure.
    expect(fixture.host.send({ type: 'create-room', capacity: 3, rules: createRules(), roomId: null,
      roundId: null, expectedVersion: 0 }, 'r1')).toMatchObject({ code: 'forbidden' });
  });
  it('retains active host seat and authoritative state on leave; no forfeit or fabricated score', () => {
    const fixture = setup(); fixture.start(); const before = fixture.host.view();
    expect(fixture.host.send({ type: 'leave' })).toMatchObject({ type: 'left', retained: true });
    const guest = fixture.players[1]; if (!guest) throw new Error('guest');
    expect(guest.view().room.hostPlayerId).toBe(fixture.host.id);
    expect(guest.view().self?.public).toEqual(before.self?.public);
    expect(fixture.host.send({ type: 'pass', expectedVersion: before.self?.public.version })).toMatchObject({ code: 'forbidden' });
    fixture.host.disconnect(); expect(fixture.host.resume()).toBe(true);
    expect(fixture.host.view().self).toEqual(before.self);
  });
  it('warns once per turn, never changes cards/version/scores and expires only all-offline rooms', () => {
    const fixture = setup(); fixture.start(); const before = fixture.host.view();
    fixture.advance(100);
    expect(fixture.host.inbox.filter((entry) => entry.type === 'notice')).toHaveLength(1);
    fixture.advance(100);
    expect(fixture.host.inbox.filter((entry) => entry.type === 'notice')).toHaveLength(1);
    fixture.host.send({ type: 'sync' });
    expect(fixture.host.view().room).toEqual(before.room); expect(fixture.host.view().self).toEqual(before.self);
    fixture.players.forEach((member) => member.disconnect()); fixture.advance(999);
    expect(fixture.host.resume()).toBe(true);
    fixture.host.disconnect(); fixture.advance(1001);
    expect(fixture.host.resume()).toBe(false);
    const newcomer = fixture.player();
    expect(newcomer.send({ type: 'join-room', roomId: fixture.roomId, roundId: null })).toMatchObject({ code: 'room-not-found' });
  });
  it('validates private handshake frames and rejects extra fields or snapshots for another identity', () => {
    expect(parseResumeRequest({ protocolVersion: 1, type: 'resume', resumeToken: 'f'.repeat(64), playerId: 'spoof' }).ok).toBe(false);
    expect(parseSessionCredentials({ protocolVersion: 1, type: 'session', selfPlayerId: 'guest', resumeToken: 'f'.repeat(64),
      resumed: false, snapshot: setup().host.view() }).ok).toBe(false);
  });
  it('cannot settle again after reconnecting and replaying the winning request', () => {
    const fixture = setup(); fixture.start();
    let winning: { readonly player: typeof fixture.host; readonly action: object; readonly id: string; readonly reply: ServerMessage } | null = null;
    for (let step = 0; step < 2000; step += 1) {
      const state = fixture.host.view().self?.public;
      if (!state || state.status !== 'playing') break;
      const actor = fixture.players.find((member) => member.id === state.turnPlayerId);
      const view = actor?.view().self; if (!actor || !view) throw new Error('actor');
      const hint = selfHint(view);
      const action = hint ? { type: 'play', expectedVersion: state.version, cardIds: hint.cardIds, declaration: hint.declaration }
        : { type: 'pass', expectedVersion: state.version };
      const id = `turn-${step}`; const reply = actor.send(action, id);
      if (actor.view().self?.public.status === 'finished') { winning = { player: actor, action, id, reply }; break; }
    }
    if (!winning) throw new Error('No completed fixture');
    const settlement = fixture.host.view().self?.public.settlement;
    expect(settlement).not.toBeNull();
    winning.player.disconnect(); expect(winning.player.resume()).toBe(true);
    expect(winning.player.send(winning.action, winning.id)).toEqual(winning.reply);
    expect(winning.player.send({ type: 'pass', expectedVersion: winning.player.view().self?.public.version }, 'settle-again'))
      .toMatchObject({ code: 'game-finished' });
    winning.player.send({ type: 'sync' });
    expect(winning.player.view().self?.public.settlement).toEqual(settlement);
  });
  it('does not let one broken recipient prevent authority commit, receipts or other broadcasts', () => {
    const fixture = setup(3); fixture.start();
    fixture.players[1]?.breakTransport();
    const view = fixture.host.view().self; if (!view) throw new Error('view');
    const hint = selfHint(view); if (!hint) throw new Error('hint');
    const action = { type: 'play', expectedVersion: view.public.version, cardIds: hint.cardIds, declaration: hint.declaration };
    const accepted = fixture.host.send(action, 'broadcast-failure');
    expect(accepted.type).toBe('sync');
    expect(fixture.players[2]?.view().self?.public.version).toBe(view.public.version + 1);
    expect(fixture.host.send(action, 'broadcast-failure')).toEqual(accepted);
  });
});
