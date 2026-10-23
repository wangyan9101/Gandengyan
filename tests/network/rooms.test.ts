import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import WebSocket from 'ws';
import { createRoomServer } from '../../server/src/ws-server';
import { SocketNetworkClient, LobbyClient } from '../../packages/remote/src';
import { createRules } from '../../packages/rules/src';

function client() {
  const network = new SocketNetworkClient((url, handlers) => {
    const socket = new WebSocket(url);
    socket.on('message', (data) => handlers.message(data.toString('utf8')));
    socket.on('close', handlers.close); socket.on('error', handlers.error);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  }, (callback, milliseconds) => { const timer = setTimeout(callback, milliseconds); return () => clearTimeout(timer); });
  return new LobbyClient(network);
}
async function eventually(condition: () => boolean) {
  for (let count = 0; count < 100; count += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected broadcast not received');
}
describe('real loopback WebSocket room integration', () => {
  it('connects eight clients, broadcasts seats and ready state, rejects a ninth and deals on host start', async () => {
    const server = createRoomServer({ port: 0 });
    const clients = Array.from({ length: 9 }, client);
    try {
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('address');
      const url = `ws://127.0.0.1:${address.port}/rooms`;
      await Promise.all(clients.map((client) => client.connect(url)));
      expect(clients.every((client) => client.network.status === 'connected')).toBe(true);
      expect(new Set(clients.map((client) => client.network.selfPlayerId)).size).toBe(9);
      const host = clients[0]; if (!host) throw new Error('host');
      expect(await host.create(8, createRules({ deckCount: 2, roundPointCap: 5, allowedBombSizes: [4, 5, 6, 7, 8] }))).toBe(true);
      const roomId = host.room?.roomId; if (!roomId) throw new Error('room');
      for (const guest of clients.slice(1, 8)) expect(await guest.join(roomId)).toBe(true);
      await eventually(() => clients.slice(0, 8).every((client) => client.room?.players.length === 8));
      expect(await clients[8]?.join(roomId)).toBe(false);
      expect(clients[8]?.error).toBe('room-full');
      for (const player of clients.slice(0, 8)) {
        await eventually(() => player.room?.version === host.room?.version);
        expect(await player.ready(true)).toBe(true);
        await eventually(() => clients.slice(0, 8).every((client) => client.room?.version === player.room?.version));
      }
      expect(await clients[1]?.start()).toBe(false);
      expect(clients[1]?.error).toBe('forbidden');
      expect(await host.start()).toBe(true);
      await eventually(() => clients.slice(0, 8).every((client) => client.room?.status === 'playing'));
      expect(host.room?.rules).toMatchObject({ deckCount: 2, roundPointCap: 5, allowedBombSizes: [4, 5, 6, 7, 8] });
      expect(JSON.stringify(host.room)).not.toContain('hand');
    } finally {
      clients.forEach((client) => client.dispose());
      server.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
  it('handles simultaneous joins and readiness conflicts without overfilling or overwriting', async () => {
    const server = createRoomServer({ port: 0 }); const clients = Array.from({ length: 3 }, client);
    try {
      await once(server, 'listening'); const address = server.address();
      if (!address || typeof address === 'string') throw new Error('address');
      await Promise.all(clients.map((client) => client.connect(`ws://127.0.0.1:${address.port}/rooms`)));
      const host = clients[0]; if (!host) throw new Error('host');
      await host.create(2); const roomId = host.room?.roomId; if (!roomId) throw new Error('room');
      const joined = await Promise.all(clients.slice(1).map((client) => client.join(roomId)));
      expect(joined.filter(Boolean).length).toBe(1);
      await eventually(() => host.room?.players.length === 2);
      const guest = clients.slice(1).find((client) => client.room); if (!guest) throw new Error('guest');
      const results = await Promise.all([host.ready(true), guest.ready(true)]);
      expect(results.filter(Boolean).length).toBe(1);
      const stale = results[0] ? guest : host;
      expect(stale.error).toBe('stale-version');
      expect(await stale.ready(true)).toBe(true);
      await eventually(() => host.room?.players.every((player) => player.ready) === true);
      guest.close();
      await eventually(() => host.room?.players.some((player) => !player.connected) === true);
      expect(await host.start()).toBe(false); expect(host.error).toBe('not-ready');
    } finally {
      clients.forEach((client) => client.dispose()); server.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
