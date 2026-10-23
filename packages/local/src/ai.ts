import type { GameCommand } from '../../rules/src';
import { findLegalPlays, type AiContext } from '../../session/src';
export { findLegalPlays } from '../../session/src';
export type { AiContext, LegalPlay } from '../../session/src';

export function chooseAiCommand(context: AiContext): GameCommand | null {
  const play = findLegalPlays(context)[0];
  if (play) return { type: 'play', playerId: context.playerId, expectedVersion: context.version,
    cardIds: play.cardIds, declaration: play.declaration };
  return context.previous ? { type: 'pass', playerId: context.playerId, expectedVersion: context.version } : null;
}
