export interface PlayerScore {
  readonly playerId: string;
  readonly remainingCards: number;
  readonly delta: number;
}

export interface Settlement {
  readonly winnerId: string;
  readonly bombCount: number;
  readonly multiplier: number;
  readonly pointCap: number;
  readonly scores: readonly PlayerScore[];
}

/** A physical 108-card round can have at most floor(108 / 3) bombs. */
export function bombMultiplier(bombCount: number): number {
  if (!Number.isInteger(bombCount) || bombCount < 0 || bombCount > 36) {
    throw new RangeError('bombCount must be an integer from 0 to 36');
  }
  return 2 ** bombCount;
}

export function settleRound(
  players: readonly { readonly playerId: string; readonly remainingCards: number }[],
  winnerId: string, bombCount: number, pointCap: number,
): Settlement {
  const multiplier = bombMultiplier(bombCount);
  if (!Number.isInteger(pointCap) || pointCap < 5 || pointCap > 50 ||
      players.length < 2 || players.length > 8 ||
      new Set(players.map((player) => player.playerId)).size !== players.length ||
      players.some((player) => typeof player.playerId !== 'string' || player.playerId.trim().length === 0 ||
        !Number.isInteger(player.remainingCards) || player.remainingCards < 0 || player.remainingCards > 108) ||
      players.reduce((sum, player) => sum + player.remainingCards, 0) > 108 ||
      !players.some((player) => player.playerId === winnerId && player.remainingCards === 0) ||
      players.some((player) => player.playerId !== winnerId && player.remainingCards === 0)) {
    throw new RangeError('Invalid settlement inputs or winner');
  }
  let winnings = 0;
  const losses = players.map((player) => {
    const loss = player.playerId === winnerId ? 0 : Math.min(player.remainingCards * multiplier, pointCap);
    winnings += loss;
    return loss;
  });
  const scores = players.map((player, index): PlayerScore => Object.freeze({
    playerId: player.playerId, remainingCards: player.remainingCards,
    delta: player.playerId === winnerId ? winnings : -(losses[index] || 0),
  }));
  return Object.freeze({ winnerId, bombCount, multiplier, pointCap, scores: Object.freeze(scores) });
}
