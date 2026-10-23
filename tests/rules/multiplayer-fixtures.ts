import { RoomService } from '../../server/src/room-service';
import { createRules, type DeckCount, type RandomSource } from '../../packages/rules/src';
import type { ServerMessage } from '../../packages/protocol/src';
import { seededRandom } from './helpers';

type Sync = Extract<ServerMessage, { type: 'sync' }>;
export function setupMultiplayer(count: number, deckCount: DeckCount = 1, pointCap = 20, source?: RandomSource) {
  let rng = seededRandom(2026);
  const service = new RoomService(source || (() => rng()));
  const players = Array.from({ length: count }, () => {
    const inbox: ServerMessage[] = [];
    let latest: Sync | null = null;
    const id = service.connect((message) => { inbox.push(message); if (message.type === 'sync') latest = message; });
    let sequence = 0;
    return { id, inbox, view(): Sync { if (!latest) throw new Error('Missing snapshot'); return latest; },
      send(action: object, requestId?: string): ServerMessage {
        sequence += 1;
        service.receive(id, { protocolVersion: 1, requestId: requestId || `request-${sequence}`,
          roomId: latest?.room.roomId || null, roundId: latest?.room.roundId || null,
          expectedVersion: latest?.room.version || 0, ...action });
        const reply = inbox[inbox.length - 1]; if (!reply) throw new Error('Missing reply'); return reply;
      },
    };
  });
  const host = players[0]; if (!host) throw new Error('host');
  host.send({ type: 'create-room', capacity: count, rules: createRules({ deckCount, roundPointCap: pointCap }) });
  const roomId = host.view().room.roomId;
  for (const player of players.slice(1)) player.send({ type: 'join-room', roomId, roundId: null, expectedVersion: 0 });
  for (const player of players) player.send({ type: 'ready', ready: true });
  const first = host.send({ type: 'start' }); if (first.type !== 'sync' || !first.self) throw new Error('start');
  return { service, players, host, roomId, resetRandom: () => { rng = seededRandom(2026); } };
}
export type MultiplayerFixture = ReturnType<typeof setupMultiplayer>;
