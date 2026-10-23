import { createPlayerView, isCard, type GameState } from '../../rules/src';
import type { PublicRoomView, ServerMessage } from './messages';
import { parseServerMessage } from './validation';

/** Trusted host boundary: room and authenticatedMemberId MUST come from server authentication
 * and authoritative membership, never from request payloads. null means unauthenticated.
 * Runtime DTO validation cannot authenticate a caller. */
export function projectGameSync(state: GameState, room: PublicRoomView,
  authenticatedMemberId: string | null, requestId: string | null): ServerMessage {
  if (authenticatedMemberId === null ||
      !room.players.some((player) => player.playerId === authenticatedMemberId) ||
      !state.players.some((player) => player.playerId === authenticatedMemberId)) {
    return Object.freeze({ protocolVersion: 1, type: 'error', requestId: requestId || 'unauthorized',
      roomId: room.roomId, roundId: room.roundId, code: 'unauthorized' });
  }
  const view = createPlayerView(state, authenticatedMemberId);
  const parsed = parseServerMessage({ protocolVersion: 1, type: 'sync', requestId, room,
    self: { selfPlayerId: authenticatedMemberId, public: view.public, hand: view.hand.filter(isCard) } });
  if (!parsed.ok) throw new Error('Inconsistent trusted projection');
  return parsed.value;
}
