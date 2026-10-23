import { createGame } from '../../packages/rules/src';
import { projectGameSync, type PublicRoomView } from '../../packages/protocol/src';
import { seededRandom } from './helpers';

export function fixture() {
  const state = createGame({ playerIds: ['alice', 'bob'], dealerIndex: 0 }, seededRandom(2026));
  const room: PublicRoomView = { roomId: 'room-1', version: 2, roundId: 'round-1', status: 'playing',
    capacity: 2, hostPlayerId: 'alice', rules: state.rules, players: ['alice', 'bob'].map((playerId, seat) =>
      ({ playerId, displayName: playerId, seat, ready: true, connected: true })) };
  const sync = projectGameSync(state, room, 'alice', 'req-1');
  return { state, room, sync };
}
