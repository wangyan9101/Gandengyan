import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { applyCommand, createGame, type GameState, type RandomSource, type Settlement, createRules } from '../../packages/rules/src';
import { parseClientMessage, parseServerMessage, encodeClientMessage,
  projectGameSync, parseResumeRequest, type SessionCredentials, type ClientMessage, type ServerMessage, type PublicRoomView } from '../../packages/protocol/src';

import { secureRandom } from './secure-random';

interface HostedRoom {
  readonly view: PublicRoomView;
  readonly game: GameState | null;
  readonly settlements: ReadonlyMap<string, Settlement>;
}
type Code = Extract<ServerMessage, { type: 'error' }>['code'];
interface Peer {
  send: (message: ServerMessage) => void;
  credentials: ((message: SessionCredentials) => void) | undefined;
  revoke: (() => void) | undefined;
  connectionId: string | null;
  readonly token: string;
  disconnectedAt: number | null;
  roomId: string | null;
  readonly receipts: Map<string, { readonly payload: string; readonly reply: ServerMessage }>;
}
export interface ReliabilityOptions {
  readonly now?: () => number;
  readonly retentionMs?: number;
  readonly turnTimeoutMs?: number;
}
/** Single writer: state, request receipt and settlement commit before any socket sends. */
export class RoomService {
  private readonly peers = new Map<string, Peer>();
  private readonly rooms = new Map<string, HostedRoom>();
  private readonly connections = new Map<string, string>();
  private readonly tokens = new Map<string, string>();
  private readonly turns = new Map<string, { readonly roundId: string; readonly version: number;
    readonly deadline: number; warned: boolean }>();
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly turnTimeoutMs: number;

  public constructor(private readonly random: RandomSource = secureRandom, options: ReliabilityOptions = {}) {
    this.now = options.now || Date.now;
    this.retentionMs = options.retentionMs ?? 30 * 60 * 1000;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 60000;
    if (!Number.isFinite(this.retentionMs) || this.retentionMs <= 0 ||
        !Number.isFinite(this.turnTimeoutMs) || this.turnTimeoutMs <= 0) throw new Error('Invalid reliability configuration');
  }

  public connect(send: Peer['send'], credentials?: Peer['credentials'], revoke?: () => void): string {
    this.tick();
    if (this.peers.size >= 2048) throw new Error('Session limit');
    const playerId = randomUUID();
    const token = randomBytes(32).toString('hex');
    this.peers.set(playerId, { send, credentials, revoke, connectionId: playerId, token,
      disconnectedAt: null, roomId: null, receipts: new Map() });
    this.connections.set(playerId, playerId); this.tokens.set(token, playerId);
    send({ protocolVersion: 1, type: 'welcome', requestId: null, selfPlayerId: playerId });
    credentials?.({ protocolVersion: 1, type: 'session', selfPlayerId: playerId, resumeToken: token, resumed: false, snapshot: null });
    return playerId;
  }
  /** connectionId is server-owned; a public playerId never authenticates a replacement connection. */
  public resume(connectionId: string, input: unknown): boolean {
    this.tick();
    const parsed = parseResumeRequest(input);
    const temporaryId = this.connections.get(connectionId);
    const temporary = temporaryId ? this.peers.get(temporaryId) : undefined;
    const playerId = parsed.ok ? this.tokens.get(parsed.value.resumeToken) : undefined;
    const peer = playerId ? this.peers.get(playerId) : undefined;
    if (!parsed.ok || !temporary || temporary.roomId || !playerId || !peer) return false;
    if (peer !== temporary) {
      const oldConnection = peer.connectionId;
      if (oldConnection) this.connections.delete(oldConnection);
      peer.revoke?.();
      this.peers.delete(temporaryId || ''); this.tokens.delete(temporary.token);
      peer.send = temporary.send; peer.credentials = temporary.credentials; peer.revoke = temporary.revoke;
    }
    this.connections.set(connectionId, playerId); peer.connectionId = connectionId; peer.disconnectedAt = null;
    const hosted = peer.roomId ? this.rooms.get(peer.roomId) : undefined;
    if (hosted) {
      const view = { ...hosted.view, version: hosted.view.version + 1,
        players: hosted.view.players.map((member) => member.playerId === playerId ? { ...member, connected: true, ready: false } : member) };
      this.rooms.set(view.roomId, { ...hosted, view });
    }
    const current = peer.roomId ? this.rooms.get(peer.roomId) : undefined;
    const message = current ? this.snapshot(current, playerId, null) : null;
    if (message && message.type !== 'sync') throw new Error('Invalid resume projection');
    peer.credentials?.({ protocolVersion: 1, type: 'session', selfPlayerId: playerId,
      resumeToken: peer.token, resumed: true, snapshot: message });
    if (peer.roomId) this.broadcast(peer.roomId, playerId);
    return true;
  }
  public disconnect(connectionId: string): void {
    const playerId = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    if (!playerId) return;
    const peer = this.peers.get(playerId);
    if (!peer || peer.connectionId !== connectionId) return;
    peer.connectionId = null; peer.disconnectedAt = this.now();
    const hosted = peer?.roomId ? this.rooms.get(peer.roomId) : undefined;
    if (!hosted) return;
    const room = hosted.view;
    const players = room.players.map((player) => player.playerId === playerId
      ? { ...player, connected: false, ready: false } : player);
    this.rooms.set(room.roomId, { ...hosted, view: { ...room, version: room.version + 1, players } });
    this.broadcast(room.roomId);
  }
  public receive(connectionId: string, input: unknown): void {
    this.tick();
    const playerId = this.connections.get(connectionId);
    if (!playerId) return;
    const peer = this.peers.get(playerId);
    if (!peer) return;
    const parsed = parseClientMessage(input);
    if (!parsed.ok) {
      this.deliver(peer, { protocolVersion: 1, type: 'error', requestId: 'invalid', roomId: null, roundId: null, code: 'invalid-message' });
      return;
    }
    const request = parsed.value;
    const fail = (code: Code): ServerMessage => ({ protocolVersion: 1, type: 'error', requestId: request.requestId,
      roomId: request.roomId, roundId: request.roundId, code });
    const payload = encodeClientMessage(request);
    const receipt = peer.receipts.get(request.requestId);
    if (receipt) {
      if (receipt.reply.type === 'sync' && peer.roomId !== receipt.reply.room.roomId) { this.deliver(peer, fail('forbidden')); return; }
      this.deliver(peer, receipt.payload === payload ? receipt.reply : fail('request-conflict')); return;
    }
    if (peer.receipts.size >= 1024) { this.deliver(peer, fail('limit-exceeded')); return; }
    const result = this.apply(playerId, peer, request, fail);
    peer.receipts.set(request.requestId, { payload, reply: result.reply });
    this.deliver(peer, result.reply);
    if (result.changedRoomId) this.broadcast(result.changedRoomId, playerId);
  }
  /** Injected clock makes retention and advisory deadlines deterministic in tests. Never mutates rules state. */
  public tick(): void {
    const now = this.now();
    for (const [roomId, hosted] of this.rooms) {
      const members = hosted.view.players.map((member) => this.peers.get(member.playerId));
      if (members.every((peer) => peer?.connectionId === null && peer.disconnectedAt !== null &&
          peer.disconnectedAt !== undefined && now - peer.disconnectedAt >= this.retentionMs)) {
        this.rooms.delete(roomId); this.turns.delete(roomId);
        members.forEach((peer) => { if (peer) peer.roomId = null; });
        continue;
      }
      const game = hosted.game;
      if (!game || game.status !== 'playing' || !hosted.view.roundId) { this.turns.delete(roomId); continue; }
      let turn = this.turns.get(roomId);
      if (!turn || turn.version !== game.version || turn.roundId !== hosted.view.roundId) {
        turn = { roundId: hosted.view.roundId, version: game.version, deadline: now + this.turnTimeoutMs, warned: false };
        this.turns.set(roomId, turn);
      }
      if (!turn.warned && now >= turn.deadline) {
        turn.warned = true;
        const actor = game.players[game.turnIndex];
        if (actor) this.peers.forEach((peer) => {
          if (peer.connectionId && peer.roomId === roomId) this.deliver(peer, { protocolVersion: 1, type: 'notice', requestId: null,
            roomId, roundId: turn.roundId, gameVersion: game.version, playerId: actor.playerId, code: 'turn-timeout' });
        });
      }
    }
    for (const [playerId, peer] of this.peers) {
      if (!peer.roomId && peer.disconnectedAt !== null && now - peer.disconnectedAt >= this.retentionMs) {
        this.peers.delete(playerId); this.tokens.delete(peer.token);
      }
    }
  }
  private deliver(peer: Peer, message: ServerMessage): void {
    try { peer.send(message); }
    catch {
      // Transport failure cannot roll back a committed command or prevent other members receiving it.
      try { peer.revoke?.(); } catch { /* Gateway owns closing/heartbeat; no private error logging. */ }
    }
  }
  private snapshot(hosted: HostedRoom, playerId: string, requestId: string | null): ServerMessage {
    if (hosted.game) return projectGameSync(hosted.game, hosted.view, playerId, requestId);
    const parsed = parseServerMessage({ protocolVersion: 1, type: 'sync', requestId, room: hosted.view, self: null });
    if (!parsed.ok) throw new Error('Invalid internal room snapshot');
    return parsed.value;
  }
  private broadcast(roomId: string, except?: string): void {
    const hosted = this.rooms.get(roomId);
    if (!hosted) return;
    this.peers.forEach((peer, playerId) => {
      // Generate EACH recipient's own projection. Never share an array of private views.
      if (peer.connectionId && peer.roomId === roomId && playerId !== except) this.deliver(peer, this.snapshot(hosted, playerId, null));
    });
  }
  private apply(playerId: string, peer: Peer, request: ClientMessage, fail: (code: Code) => ServerMessage):
    { readonly reply: ServerMessage; readonly changedRoomId?: string } {
    const reject = (code: Code) => ({ reply: fail(code) });
    if (request.type === 'create-room') {
      if (peer.roomId) return reject('wrong-phase');
      if (this.rooms.size >= 100) return reject('limit-exceeded');
      let roomId: string;
      do { roomId = String(randomInt(100000, 1000000)); } while (this.rooms.has(roomId));
      const room: PublicRoomView = { roomId, version: 0, roundId: null, status: 'waiting', capacity: request.capacity,
        rules: createRules({ deckCount: request.rules.deckCount, roundPointCap: request.rules.roundPointCap,
          allowedBombSizes: request.rules.allowedBombSizes, straightMinLength: request.rules.straightMinLength,
          consecutivePairsMinLength: request.rules.consecutivePairsMinLength }),
        hostPlayerId: playerId, players: [{ playerId, displayName: '玩家 1', seat: 0, ready: false, connected: true }] };
      const hosted: HostedRoom = { view: room, game: null, settlements: new Map() };
      this.rooms.set(roomId, hosted); peer.roomId = roomId;
      return { reply: this.snapshot(hosted, playerId, request.requestId) };
    }
    const hosted = this.rooms.get(request.roomId);
    if (!hosted) return reject('room-not-found');
    const room = hosted.view;
    if (request.type === 'join-room') {
      if (peer.roomId === room.roomId) return { reply: this.snapshot(hosted, playerId, request.requestId) };
      if (peer.roomId || room.status !== 'waiting') return reject('wrong-phase');
      if (room.players.length >= room.capacity) return reject('room-full');
      const seat = Array.from({ length: room.capacity }, (_, index) => index).find((index) => !room.players.some((player) => player.seat === index));
      if (seat === undefined) return reject('room-full');
      const next: PublicRoomView = { ...room, version: room.version + 1, players: [...room.players,
        { playerId, displayName: `玩家 ${seat + 1}`, seat, ready: false, connected: true }].sort((left, right) => left.seat - right.seat) };
      const nextHosted = { ...hosted, view: next };
      this.rooms.set(room.roomId, nextHosted); peer.roomId = room.roomId;
      return { reply: this.snapshot(nextHosted, playerId, request.requestId), changedRoomId: room.roomId };
    }
    if (peer.roomId !== room.roomId || !room.players.some((player) => player.playerId === playerId)) return reject('forbidden');
    if (request.type === 'sync') return { reply: this.snapshot(hosted, playerId, request.requestId) };
    if (request.roundId !== room.roundId) return reject('wrong-round');
    if (request.type === 'leave') {
      if (request.expectedVersion !== room.version) return reject('stale-version');
      if (room.status !== 'waiting') {
        const next = { ...hosted, view: { ...room, version: room.version + 1,
          players: room.players.map((member) => member.playerId === playerId ? { ...member, connected: false, ready: false } : member) } };
        this.rooms.set(room.roomId, next);
        return { reply: { protocolVersion: 1, type: 'left', requestId: request.requestId, roomId: room.roomId, retained: true }, changedRoomId: room.roomId };
      }
      const players = room.players.filter((member) => member.playerId !== playerId);
      peer.roomId = null;
      if (!players.length) this.rooms.delete(room.roomId);
      else {
        const nextHost = room.hostPlayerId === playerId ? (players.find((member) => member.connected) || players[0])?.playerId : room.hostPlayerId;
        if (!nextHost) throw new Error('Missing host');
        this.rooms.set(room.roomId, { ...hosted, view: { ...room, version: room.version + 1, players, hostPlayerId: nextHost } });
      }
      return { reply: { protocolVersion: 1, type: 'left', requestId: request.requestId, roomId: room.roomId, retained: false }, changedRoomId: room.roomId };
    }
    if (!room.players.some((member) => member.playerId === playerId && member.connected)) return reject('forbidden');
    if (request.type === 'play' || request.type === 'pass') {
      const game = hosted.game;
      if (!game || !room.roundId) return reject('wrong-phase');
      const command = request.type === 'pass'
        ? { type: 'pass', playerId, expectedVersion: request.expectedVersion }
        : { type: 'play', playerId, expectedVersion: request.expectedVersion, cardIds: request.cardIds,
            ...(request.declaration ? { declaration: request.declaration } : {}) };
      const result = applyCommand(game, command);
      if (!result.ok) return reject(result.error === 'unknown-player' ? 'forbidden' : result.error);
      const nextRoom: PublicRoomView = { ...room, status: result.state.status, version: room.version + 1,
        players: result.state.status === 'finished' ? room.players.map((player) => ({ ...player, ready: false })) : room.players };
      const settlements = new Map(hosted.settlements);
      if (result.state.settlement) {
        if (settlements.has(room.roundId)) throw new Error('Duplicate internal settlement');
        settlements.set(room.roundId, result.state.settlement);
      }
      const nextHosted: HostedRoom = { view: nextRoom, game: result.state, settlements };
      this.rooms.set(room.roomId, nextHosted);
      return { reply: this.snapshot(nextHosted, playerId, request.requestId), changedRoomId: room.roomId };
    }
    if (room.status !== 'waiting' && room.status !== 'finished') return reject('wrong-phase');
    if (request.expectedVersion !== room.version) return reject('stale-version');
    if (request.type === 'ready') {
      const next: PublicRoomView = { ...room, version: room.version + 1,
        players: room.players.map((player) => player.playerId === playerId ? { ...player, ready: request.ready } : player) };
      const nextHosted = { ...hosted, view: next };
      this.rooms.set(room.roomId, nextHosted);
      return { reply: this.snapshot(nextHosted, playerId, request.requestId), changedRoomId: room.roomId };
    }
    if (room.hostPlayerId !== playerId) return reject('forbidden');
    if (room.players.length !== room.capacity) return reject('not-full');
    if (!room.players.every((player) => player.connected && player.ready)) return reject('not-ready');
    // First seat hosts the first round; the prior winner deals the following round.
    const dealerId = hosted.game?.settlement?.winnerId || room.hostPlayerId;
    const dealerIndex = room.players.findIndex((player) => player.playerId === dealerId);
    const game = createGame({ playerIds: room.players.map((player) => player.playerId), dealerIndex, rules: room.rules }, this.random);
    const next: PublicRoomView = { ...room, status: game.status, roundId: randomUUID(), version: room.version + 1 };
    const nextHosted: HostedRoom = { ...hosted, view: next, game };
    this.rooms.set(room.roomId, nextHosted);
    return { reply: this.snapshot(nextHosted, playerId, request.requestId), changedRoomId: room.roomId };
  }
}
