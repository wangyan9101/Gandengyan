import { once } from 'node:events';
import WebSocket from 'ws';
import { describe, it, expect } from 'vitest';
import { createRoomServer } from '../../server/src/ws-server';
import { LobbyClient, SocketNetworkClient } from '../../packages/remote/src';
import { createRules } from '../../packages/rules/src';
import { seededRandom } from '../rules/helpers';

function newClient() {
  return new LobbyClient(new SocketNetworkClient((url, handlers) => {
    const socket = new WebSocket(url);
    socket.on('message', (data) => handlers.message(data.toString('utf8')));
    socket.on('close', handlers.close); socket.on('error', handlers.error);
    return { send: (data) => socket.send(data), close: () => socket.close() };
  }, (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); }));
}
async function eventually(check: () => boolean) {
  for (let index = 0; index < 300; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Snapshot synchronization timed out');
}
describe('complete WebSocket multiplayer rounds', () => {
  for (const count of [2, 6, 8]) for (const deckCount of [1, 2] as const) {
    it(`${count} clients / ${deckCount} decks finish and continue in the same room`, async () => {
      let rng = seededRandom(2026);
      // Fast automated turns use trusted test configuration. The CLI retains its human-rate limit.
      const server = createRoomServer({ port: 0, random: () => rng(), messageLimit: 10000 });
      const clients = Array.from({ length: count }, newClient);
      try {
        await once(server, 'listening'); const address = server.address();
        if (!address || typeof address === 'string') throw new Error('address');
        await Promise.all(clients.map((client) => client.connect(`ws://127.0.0.1:${address.port}/rooms`)));
        const host = clients[0]; if (!host) throw new Error('host');
        expect(await host.create(count, createRules({ deckCount, roundPointCap: 20 }))).toBe(true);
        const roomId = host.room?.roomId; if (!roomId) throw new Error('room');
        for (const client of clients.slice(1)) expect(await client.join(roomId)).toBe(true);
        await eventually(() => clients.every((client) => client.room?.players.length === count));
        for (const client of clients) {
          expect(await client.ready(true)).toBe(true);
          await eventually(() => clients.every((entry) => entry.room?.version === client.room?.version));
        }
        expect(await host.start()).toBe(true);
        await eventually(() => clients.every((client) => !!client.game));
        const initialRound = host.room?.roundId;
        let lastWinner: string | null = null;
        for (let step = 0; step < 2000; step += 1) {
          const first = host.game?.snapshot().view; if (!first) throw new Error('view');
          if (first.public.status !== 'playing') {
            expect(first.public.status).toBe('finished');
            const scores = first.public.settlement?.scores;
            expect(scores?.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
            lastWinner = first.public.settlement?.winnerId || null; break;
          }
          const actor = clients.find((client) => client.network.selfPlayerId === first.public.turnPlayerId);
          if (!actor?.game) throw new Error('actor');
          const hint = actor.game.hint();
          expect(await (hint ? actor.game.play(hint.cardIds, hint.declaration) : actor.game.pass())).toBe(true);
          const nextVersion = first.public.version + 1;
          await eventually(() => clients.every((client) => client.game?.snapshot().view.public.version === nextVersion));
          const views = clients.map((client) => client.game?.snapshot().view);
          const held = views.flatMap((view) => view?.hand.map((card) => card.cardId) || []);
          expect(new Set(held).size).toBe(held.length);
          for (let index = 0; index < views.length; index += 1) {
            const view = views[index]; if (!view) throw new Error('view');
            expect(view.selfPlayerId).toBe(clients[index]?.network.selfPlayerId);
            expect(view.public).toEqual(views[0]?.public);
            const serialized = JSON.stringify(view);
            for (let other = 0; other < views.length; other += 1) if (other !== index) {
              for (const card of views[other]?.hand || []) expect(serialized).not.toContain(card.cardId);
            }
          }
        }
        expect(lastWinner).not.toBeNull();
        const previousGame = host.game;
        for (const client of clients) {
          expect(await client.ready(true)).toBe(true);
          await eventually(() => clients.every((entry) => entry.room?.version === client.room?.version));
        }
        rng = seededRandom(2026);
        expect(await host.start()).toBe(true);
        await eventually(() => clients.every((client) => client.room?.roundId !== initialRound));
        expect(host.game).not.toBe(previousGame);
        expect(host.game?.snapshot().view.public).toMatchObject({ version: 0, turnPlayerId: lastWinner, bombCount: 0, settlement: null });
        expect(clients.find((client) => client.network.selfPlayerId === lastWinner)?.game?.snapshot().view.hand.length).toBe(6);
        if (count === 6 && deckCount === 2) {
          let completed = false;
          for (let step = 0; step < 2000; step += 1) {
            const state = host.game?.snapshot().view.public; if (!state) throw new Error('next state');
            if (state.status !== 'playing') { expect(state.status).toBe('finished'); completed = true; break; }
            const actor = clients.find((client) => client.network.selfPlayerId === state.turnPlayerId);
            if (!actor?.game) throw new Error('next actor');
            const hint = actor.game.hint();
            expect(await (hint ? actor.game.play(hint.cardIds, hint.declaration) : actor.game.pass())).toBe(true);
            await eventually(() => clients.every((client) => client.game?.snapshot().view.public.version === state.version + 1));
          }
          expect(completed).toBe(true);
        }
      } finally {
        clients.forEach((client) => client.dispose()); server.clients.forEach((socket) => socket.terminate());
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }, 30000);
  }
});
