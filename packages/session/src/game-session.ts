import type { Hand, HandDeclaration, TablePlay } from '../../rules/src';
import type { SelfGameView } from '../../protocol/src';
import type { LegalPlay } from './play-assistance';

export interface SessionSnapshot {
  readonly view: SelfGameView;
  readonly lastPlay: TablePlay | null;
  readonly message: string;
}

/** Consumers must handle both immediate local outcomes and asynchronous remote outcomes. */
export interface GameSession {
  readonly selfPlayerId: string;
  readonly isHumanTurn: boolean;
  readonly isPlaying: boolean;
  snapshot(): SessionSnapshot;
  play(cardIds: readonly string[], declaration?: HandDeclaration): boolean | Promise<boolean>;
  pass(): boolean | Promise<boolean>;
  hint(): LegalPlay | null;
  selectedInterpretations(cardIds: readonly string[]): readonly Hand[];
}
