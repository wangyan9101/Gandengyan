import type { Card, HandDeclaration, RuleConfig, createPublicView } from '../../rules/src';

export const PROTOCOL_VERSION = 1;
export type PublicGameView = ReturnType<typeof createPublicView>;
export interface SelfGameView {
  readonly selfPlayerId: string;
  readonly public: PublicGameView;
  readonly hand: readonly Card[];
}
export interface PublicRoomView {
  readonly roomId: string;
  readonly version: number;
  readonly roundId: string | null;
  readonly status: 'waiting' | 'locked' | 'playing' | 'finished' | 'awaiting-rule';
  readonly capacity: number;
  readonly hostPlayerId: string;
  readonly rules: RuleConfig;
  readonly players: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly seat: number;
    readonly ready: boolean;
    readonly connected: boolean;
  }[];
}
interface RequestBase {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly roomId: string | null;
  readonly roundId: string | null;
  readonly expectedVersion: number;
}
export type ClientMessage = RequestBase & (
  | { readonly type: 'create-room'; readonly roomId: null; readonly roundId: null;
      readonly capacity: number; readonly rules: RuleConfig }
  | { readonly type: 'join-room'; readonly roomId: string; readonly roundId: null }
  | { readonly type: 'start'; readonly roomId: string; readonly roundId: string | null }
  | { readonly type: 'ready'; readonly roomId: string; readonly roundId: string | null; readonly ready: boolean }
  | { readonly type: 'play'; readonly roomId: string; readonly roundId: string;
      readonly cardIds: readonly string[]; readonly declaration: HandDeclaration | null }
  | { readonly type: 'pass'; readonly roomId: string; readonly roundId: string }
  | { readonly type: 'sync'; readonly roomId: string }
  | { readonly type: 'leave'; readonly roomId: string }
);
export const ERROR_CODES = ['unauthorized', 'forbidden', 'invalid-message', 'room-full', 'room-not-found',
  'wrong-phase', 'stale-version', 'invalid-play', 'not-your-turn', 'request-conflict', 'internal-error', 'not-ready', 'not-full', 'limit-exceeded', 'wrong-round', 'cannot-pass', 'not-owned', 'game-finished', 'awaiting-rule', 'invalid-command'] as const;
export type ServerMessage =
  | { readonly protocolVersion: 1; readonly type: 'welcome'; readonly requestId: null; readonly selfPlayerId: string }
  | { readonly protocolVersion: 1; readonly type: 'left'; readonly requestId: string; readonly roomId: string;
      readonly retained: boolean }
  | { readonly protocolVersion: 1; readonly type: 'notice'; readonly requestId: null; readonly roomId: string;
      readonly roundId: string; readonly gameVersion: number; readonly playerId: string; readonly code: 'turn-timeout' }
  | { readonly protocolVersion: 1; readonly type: 'sync'; readonly requestId: string | null;
      readonly room: PublicRoomView; readonly self: SelfGameView | null }
  | { readonly protocolVersion: 1; readonly type: 'error'; readonly requestId: string;
      readonly roomId: string | null; readonly roundId: string | null;
      readonly code: (typeof ERROR_CODES)[number] };
