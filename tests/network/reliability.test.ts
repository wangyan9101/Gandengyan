import { once } from 'node:events';
import WebSocket from 'ws';
import { describe, expect, it } from 'vitest';
import { createRoomServer } from '../../server/src/ws-server';
import { LobbyClient, SocketNetworkClient } from '../../packages/remote/src';
import { createRules } from '../../packages/rules/src';
import { parseServerMessage } from '../../packages/protocol/src';
import { seededRandom } from '../rules/helpers';

function newClient() {
  let socket: WebSocket | null = null;
  let dropAcknowledgement = false;
  const lobby = new LobbyClient(new SocketNetworkClient((url, handlers) => {
    const current = new WebSocket(url); socket = current;
    current.on('message', (data) => {
      const input = data.toString('utf8');
      const parsed = parseServerMessage(input);
      if (dropAcknowledgement && parsed.ok && parsed.value.type === 'sync' && parsed.value.requestId?.startsWith('game-')) {
        dropAcknowledgement = false; current.terminate(); return;
      }
      handlers.message(input);
    });
    current.on('close', (code) => handlers.close(code)); current.on('error', handlers.error);
    return { send: (data) => current.send(data), close: () => current.close() };
  }, (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); }));
  return { lobby, drop: () => { socket?.terminate(); }, loseNextAcknowledgement: () => { dropAcknowledgement = true; } };
}
async function eventually(check: () => boolean) {
  for (let index = 0; index < 600; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Recovery timed out');
}
describe('real WebSocket reliability', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8]) {
    it(`${count} clients recover a committed action with a lost acknowledgement and an all-offline round`, async () => {
      const server = createRoomServer({ port: 0, random: seededRandom(2026), messageLimit: 10000 });
      const clients = Array.from({ length: count }, newClient);
      try {
        await once(server, 'listening'); const address = server.address();
        if (!address || typeof address === 'string') throw new Error('address');
        const url = `ws://127.0.0.1:${address.port}/rooms`;
        await Promise.all(clients.map((client) => client.lobby.connect(url)));
        const host = clients[0]; if (!host) throw new Error('host');
        expect(await host.lobby.create(count, createRules({ deckCount: 2 }))).toBe(true);
        const roomId = host.lobby.room?.roomId; if (!roomId) throw new Error('room');
        for (const client of clients.slice(1)) expect(await client.lobby.join(roomId)).toBe(true);
        await eventually(() => clients.every((client) => client.lobby.room?.version === host.lobby.room?.version));
        for (const client of clients) {
          expect(await client.lobby.ready(true)).toBe(true);
          await eventually(() => clients.every((entry) => entry.lobby.room?.version === client.lobby.room?.version));
        }
        expect(await host.lobby.start()).toBe(true);
        await eventually(() => clients.every((client) => !!client.lobby.game));
        const initial = host.lobby.game?.snapshot().view; const hint = host.lobby.game?.hint();
        if (!initial || !hint) throw new Error('game');
        const ids = clients.map((client) => client.lobby.network.selfPlayerId);
        const roundId = host.lobby.room?.roundId;
        host.loseNextAcknowledgement();
        expect(await host.lobby.game?.play(hint.cardIds, hint.declaration)).toBe(false);
        await eventually(() => host.lobby.network.status === 'connected' && host.lobby.game?.snapshot().view.public.version === 1);
        expect(host.lobby.network.selfPlayerId).toBe(ids[0]);
        expect(host.lobby.game?.snapshot().view.hand.map((card) => card.cardId).sort())
          .toEqual(initial.hand.filter((card) => !hint.cardIds.includes(card.cardId)).map((card) => card.cardId).sort());
        const snapshots = clients.map((client) => client.lobby.game?.snapshot().view);
        clients.forEach((client) => client.drop());
        await eventually(() => clients.every((client) => client.lobby.network.status !== 'connected'));
        await eventually(() => clients.every((client, index) => client.lobby.network.status === 'connected' &&
          client.lobby.network.selfPlayerId === ids[index] && client.lobby.game?.snapshot().view.public.version === 1));
        clients.forEach((client, index) => {
          expect(client.lobby.room?.roundId).toBe(roundId);
          expect(client.lobby.game?.snapshot().view).toEqual(snapshots[index]);
          const own = client.lobby.game?.snapshot().view;
          for (const other of snapshots.filter((view) => view?.selfPlayerId !== own?.selfPlayerId)) {
            for (const card of other?.hand || []) expect(JSON.stringify(own)).not.toContain(card.cardId);
          }
        });
        const actor = clients.find((client) => client.lobby.network.selfPlayerId === host.lobby.game?.snapshot().view.public.turnPlayerId);
        expect(await actor?.lobby.game?.pass()).toBe(true);
        await eventually(() => clients.every((client) => client.lobby.game?.snapshot().view.public.version === 2));
      } finally {
        clients.forEach((client) => client.lobby.dispose()); server.clients.forEach((socket) => socket.terminate());
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }, 30000);
  }
  it('explicit waiting-room departure transfers host and frees the seat over the real transport', async () => {
    const server = createRoomServer({ port: 0 }); const a = newClient(); const b = newClient(); const c = newClient();
    try {
      await once(server, 'listening'); const address = server.address();
      if (!address || typeof address === 'string') throw new Error('address');
      const url = `ws://127.0.0.1:${address.port}/rooms`;
      await Promise.all([a, b, c].map((client) => client.lobby.connect(url)));
      expect(await a.lobby.create(2)).toBe(true); const roomId = a.lobby.room?.roomId;
      if (!roomId) throw new Error('room');
      expect(await b.lobby.join(roomId)).toBe(true);
      await eventually(() => a.lobby.room?.version === b.lobby.room?.version);
      expect(await a.lobby.leave()).toBe(true);
      await eventually(() => b.lobby.room?.hostPlayerId === b.lobby.network.selfPlayerId);
      expect(await c.lobby.join(roomId)).toBe(true);
      expect(c.lobby.room?.players).toHaveLength(2);
      expect(a.lobby.network.status).toBe('disconnected');
    } finally {
      [a, b, c].forEach((client) => client.lobby.dispose()); server.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
