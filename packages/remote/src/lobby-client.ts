import { createRules, type RuleConfig } from '../../rules/src';
import { parseClientMessage, type ClientMessage, type PublicRoomView, type ServerMessage } from '../../protocol/src';
import { RemoteSession } from './remote-session';
import type { NetworkClient } from './network-client';

export class LobbyClient {
  public room: PublicRoomView | null = null;
  public game: RemoteSession | null = null;
  public error = '';
  public busy = false;
  private sequence = 0;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: readonly (() => void)[];
  public constructor(public readonly network: NetworkClient) {
    this.unsubscribe = [network.onMessage((message) => this.receive(message)), network.onStatus(() => {
      if (network.status !== 'connected') { if (this.game) this.error = 'connection-lost'; this.game?.dispose(); this.game = null; this.room = null; }
      else this.error = '';
      this.notify();
    })];
  }
  public subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { this.listeners.forEach((listener) => listener()); }
  private receive(message: ServerMessage): void {
    if (message.type === 'notice') {
      if (message.roomId === this.room?.roomId && this.game?.acceptMessage(message)) this.notify();
      return;
    }
    if (message.type !== 'sync') return;
    if (!message.room.players.some((player) => player.playerId === this.network.selfPlayerId) ||
        (message.self !== null && message.self.selfPlayerId !== this.network.selfPlayerId)) return;
    if (this.room && (message.room.roomId !== this.room.roomId || message.room.version < this.room.version)) return;
    const sameRound = this.room?.roundId === message.room.roundId;
    if (message.self) {
      if (sameRound && this.game) this.game.acceptMessage(message);
      else {
        this.game?.dispose();
        this.game = new RemoteSession(message.self.selfPlayerId, message, {
          request: async (encoded) => this.network.request(parseLobbyRequest(encoded)),
        }, () => { this.sequence += 1; return `game-${this.sequence}`; });
      }
    }
    this.room = message.room; this.notify();
  }
  public async connect(url: string): Promise<void> {
    this.generation += 1; const generation = this.generation;
    this.error = ''; this.room = null; this.busy = false;
    try { await this.network.connect(url); if (generation === this.generation) this.error = ''; } catch { if (generation === this.generation) this.error = 'connection-failed'; }
    if (generation === this.generation) this.notify();
  }
  public create(capacity: number, rules: RuleConfig = createRules()): Promise<boolean> {
    return this.send({ type: 'create-room', roomId: null, roundId: null, expectedVersion: 0, capacity, rules });
  }
  public join(roomId: string): Promise<boolean> {
    return this.send({ type: 'join-room', roomId: roomId.trim(), roundId: null, expectedVersion: 0 });
  }
  public ready(ready: boolean): Promise<boolean> {
    if (!this.room) return Promise.resolve(false);
    return this.send({ type: 'ready', roomId: this.room.roomId, roundId: this.room.roundId, expectedVersion: this.room.version, ready });
  }
  public start(): Promise<boolean> {
    if (!this.room) return Promise.resolve(false);
    return this.send({ type: 'start', roomId: this.room.roomId, roundId: this.room.roundId, expectedVersion: this.room.version });
  }
  public async leave(): Promise<boolean> {
    if (!this.room || this.busy || this.network.status !== 'connected') return false;
    this.busy = true; this.error = ''; this.notify();
    const room = this.room; const generation = this.generation;
    try {
      this.sequence += 1;
      const reply = await this.network.request({ protocolVersion: 1, requestId: `lobby-${this.sequence}`,
        type: 'leave', roomId: room.roomId, roundId: room.roundId, expectedVersion: room.version });
      if (generation !== this.generation) return false;
      if (reply.type === 'left' && reply.roomId === room.roomId) { this.close(); return true; }
      this.error = reply.type === 'error' ? reply.code : 'request-failed';
      return false;
    } catch { this.error = 'request-failed'; return false; }
    finally { if (generation === this.generation) { this.busy = false; this.notify(); } }
  }
  private async send(action: Omit<Extract<ClientMessage, { type: 'create-room' }>, 'protocolVersion' | 'requestId'> |
    Omit<Extract<ClientMessage, { type: 'join-room' | 'start' }>, 'protocolVersion' | 'requestId'> |
    Omit<Extract<ClientMessage, { type: 'ready' }>, 'protocolVersion' | 'requestId'>): Promise<boolean> {
    if (this.busy || this.network.status !== 'connected') return false;
    const generation = this.generation;
    this.busy = true; this.error = ''; this.notify();
    try {
      this.sequence += 1;
      // Runtime encoder is the boundary for the discriminated union assembled here.
      const request = { ...action, protocolVersion: 1, requestId: `lobby-${this.sequence}` };
      const parsed = parseLobbyRequest(request);
      const reply = await this.network.request(parsed);
      if (generation !== this.generation || this.network.status !== 'connected') return false;
      if (reply.type === 'error') {
        this.error = reply.code;
        if (reply.code === 'stale-version' && this.room) {
          this.sequence += 1;
          const fresh = await this.network.request({ protocolVersion: 1, requestId: `lobby-${this.sequence}`,
            type: 'sync', roomId: this.room.roomId, roundId: null, expectedVersion: this.room.version });
          if (generation === this.generation) this.receive(fresh);
        }
        return false;
      }
      this.receive(reply);
      return reply.type === 'sync' && this.room?.roomId === reply.room.roomId &&
        reply.room.players.some((player) => player.playerId === this.network.selfPlayerId);
    } catch { if (generation === this.generation) this.error = 'request-failed'; return false; }
    finally { if (generation === this.generation) { this.busy = false; this.notify(); } }
  }
  public close(): void { this.generation += 1; this.busy = false; this.error = ''; this.network.close(); this.room = null; this.error = ''; this.notify(); }
  public dispose(): void { this.close(); this.unsubscribe.forEach((unsubscribe) => unsubscribe()); this.listeners.clear(); }
}
function parseLobbyRequest(input: unknown): ClientMessage {
  const parsed = parseClientMessage(input);
  if (!parsed.ok) throw new Error('invalid-message');
  return parsed.value;
}
