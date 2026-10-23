import { describe, it, expect } from 'vitest';
import { RoomService } from '../../server/src/room-service';
import { createRules } from '../../packages/rules/src';
import { parseServerMessage, type ServerMessage, type PublicRoomView } from '../../packages/protocol/src';

function peer(service: RoomService) {
  const messages: ServerMessage[] = [];
  const id = service.connect((message) => { expect(parseServerMessage(message).ok).toBe(true); messages.push(message); });
  let sequence = 0;
  return { id, messages, send(action: object, requestId?: string) {
    sequence += 1;
    service.receive(id, { protocolVersion: 1, requestId: requestId || `r${sequence}`, roomId: null,
      roundId: null, expectedVersion: 0, ...action });
    const reply = messages[messages.length - 1];
    if (!reply) throw new Error('No reply');
    return reply;
  } };
}
function room(message: ServerMessage): PublicRoomView {
  if (message.type !== 'sync') throw new Error(`Not snapshot: ${message.type}`);
  if (message.room.status === 'waiting') expect(message.self).toBeNull();
  return message.room;
}
function create(host: ReturnType<typeof peer>, capacity = 2) {
  return room(host.send({ type: 'create-room', capacity, rules: createRules() }));
}
describe('authoritative room service', () => {
  for (const capacity of [2, 3, 4, 5, 6, 7, 8]) for (const deckCount of [1, 2] as const) {
    it(`allocates ${capacity} seats with ${deckCount} decks and rejects overflow`, () => {
      const service = new RoomService(); const host = peer(service);
      let view = room(host.send({ type: 'create-room', capacity, rules: createRules({ deckCount, roundPointCap: 50 }) }));
      expect(view.roomId).toMatch(/^\d{6}$/);
      for (let index = 1; index < capacity; index += 1) {
        const player = peer(service); view = room(player.send({ type: 'join-room', roomId: view.roomId }));
        expect(view.players[index]?.playerId).toBe(player.id);
      }
      expect(view.rules.deckCount).toBe(deckCount);
      expect(view.rules.roundPointCap).toBe(50);
      expect(new Set(view.players.map((player) => player.seat)).size).toBe(capacity);
      expect(peer(service).send({ type: 'join-room', roomId: view.roomId })).toMatchObject({ type: 'error', code: 'room-full' });
      expect(room(host.messages[host.messages.length - 1] as ServerMessage).players.length).toBe(capacity);
    });
  }
  it('broadcasts ready/cancel, requires full room and only a prepared host may start it', () => {
    const service = new RoomService(); const host = peer(service); const guest = peer(service);
    let view = create(host);
    expect(host.send({ type: 'start', roomId: view.roomId })).toMatchObject({ code: 'not-full' });
    view = room(guest.send({ type: 'join-room', roomId: view.roomId }));
    expect(guest.send({ type: 'start', roomId: view.roomId, expectedVersion: view.version })).toMatchObject({ code: 'forbidden' });
    expect(host.send({ type: 'start', roomId: view.roomId, expectedVersion: view.version })).toMatchObject({ code: 'not-ready' });
    view = room(host.send({ type: 'ready', ready: true, roomId: view.roomId, expectedVersion: view.version }));
    expect(room(guest.messages[guest.messages.length - 1] as ServerMessage).players[0]?.ready).toBe(true);
    view = room(host.send({ type: 'ready', ready: false, roomId: view.roomId, expectedVersion: view.version }));
    expect(view.players[0]?.ready).toBe(false);
    view = room(host.send({ type: 'ready', ready: true, roomId: view.roomId, expectedVersion: view.version }));
    view = room(guest.send({ type: 'ready', ready: true, roomId: view.roomId, expectedVersion: view.version }));
    view = room(host.send({ type: 'start', roomId: view.roomId, expectedVersion: view.version }));
    expect(view.status).toBe('playing'); expect(view.roundId).not.toBeNull();
    expect(peer(service).send({ type: 'join-room', roomId: view.roomId })).toMatchObject({ code: 'wrong-phase' });
    expect(host.send({ type: 'play', roomId: view.roomId, roundId: 'fake', cardIds: ['0:clubs:3'], declaration: null })).toMatchObject({ code: 'wrong-round' });
  });
  it('rejects cross-room writes, spoofed fields, stale changes and malformed config without changing state', () => {
    const service = new RoomService(); const host = peer(service); const outsider = peer(service);
    const view = create(host);
    for (const type of ['sync', 'ready', 'start']) expect(outsider.send({ type, roomId: view.roomId,
      ...(type === 'ready' ? { ready: true } : {}) })).toMatchObject({ code: 'forbidden' });
    expect(outsider.send({ type: 'ready', roomId: view.roomId, ready: true, playerId: host.id })).toMatchObject({ code: 'invalid-message' });
    expect(host.send({ type: 'ready', roomId: view.roomId, ready: true, expectedVersion: 99 })).toMatchObject({ code: 'stale-version' });
    expect(peer(service).send({ type: 'create-room', capacity: 9, rules: createRules() })).toMatchObject({ code: 'invalid-message' });
    expect(room(host.send({ type: 'sync', roomId: view.roomId }))).toEqual(view);
  });
  it('deduplicates creation and ready requests, rejecting same ID with different payload', () => {
    const service = new RoomService(); const host = peer(service);
    const action = { type: 'create-room', capacity: 2, rules: createRules() };
    const first = host.send(action, 'create'); expect(host.send(action, 'create')).toEqual(first);
    const view = room(first);
    const ready = { type: 'ready', roomId: view.roomId, expectedVersion: view.version, ready: true };
    const accepted = host.send(ready, 'ready'); expect(host.send(ready, 'ready')).toEqual(accepted);
    expect(host.send({ ...ready, ready: false }, 'ready')).toMatchObject({ code: 'request-conflict' });
    expect(room(host.send({ type: 'sync', roomId: view.roomId })).version).toBe(1);
  });
  it('marks disconnection without transferring host or generating private game data', () => {
    const service = new RoomService(); const host = peer(service); const guest = peer(service);
    const view = create(host); guest.send({ type: 'join-room', roomId: view.roomId });
    service.disconnect(host.id);
    const snapshot = room(guest.messages[guest.messages.length - 1] as ServerMessage);
    expect(snapshot.players[0]).toMatchObject({ connected: false, ready: false });
    expect(snapshot.hostPlayerId).toBe(host.id);
    expect(JSON.stringify(snapshot)).not.toMatch(/hand|drawPile|token|secret/i);
    service.disconnect(guest.id);
    // Stage 4.4 retains all-offline rooms during the recovery window.
    expect(peer(service).send({ type: 'join-room', roomId: view.roomId })).toMatchObject({ code: 'room-full' });
  });
});
