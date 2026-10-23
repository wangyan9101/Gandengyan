import { describe, expect, it } from 'vitest';
import { bombMultiplier, settleRound } from '../../packages/rules/src';

describe('global multiplier and loss-capped, zero-sum settlement', () => {
  it('matches the documented three-player example, allowing winner income over cap', () => {
    const result = settleRound([
      { playerId: 'winner', remainingCards: 0 },
      { playerId: 'a', remainingCards: 3 },
      { playerId: 'b', remainingCards: 7 },
    ], 'winner', 2, 20);
    expect(result.multiplier).toBe(4);
    expect(result.scores.map((score) => score.delta)).toEqual([32, -12, -20]);
  });
  for (const cap of [5, 20, 50]) {
    for (const count of [2, 3, 8]) {
      for (const bombs of [0, 1, 2, 6, 18, 36]) {
        it(`is zero sum: cap ${cap}, players ${count}, bombs ${bombs}`, () => {
          const players = Array.from({ length: count }, (_, i) => ({ playerId: `p${i}`, remainingCards: i === 0 ? 0 : i }));
          const result = settleRound(players, 'p0', bombs, cap);
          expect(result.scores.reduce((sum, score) => sum + score.delta, 0)).toBe(0);
          for (const score of result.scores.slice(1)) {
            expect(score.delta).toBeLessThan(0);
            expect(score.delta).toBeGreaterThanOrEqual(-cap);
            expect(Number.isSafeInteger(score.delta)).toBe(true);
          }
          expect(result.scores[0]?.delta).toBe(-result.scores.slice(1).reduce((sum, score) => sum + score.delta, 0));
        });
      }
    }
  }
  it('uses remaining card counts at B=0, including a joker as one physical card', () => {
    expect(settleRound([{ playerId: 'a', remainingCards: 1 }, { playerId: 'b', remainingCards: 0 }],
      'b', 0, 50).scores.map((score) => score.delta)).toEqual([-1, 1]);
  });
  it.each([-1, 0.5, 37, NaN, Infinity])('rejects invalid bomb count %s', (count) => {
    expect(() => bombMultiplier(count)).toThrow(RangeError);
  });
  it.each([4, 51, 5.5, NaN])('rejects invalid cap %s', (cap) => {
    expect(() => settleRound([{ playerId: 'a', remainingCards: 0 }, { playerId: 'b', remainingCards: 5 }],
      'a', 0, cap)).toThrow(RangeError);
  });
  it('rejects nonexistent winners, unemptied winners, multiple empty hands and duplicate IDs', () => {
    const valid = [{ playerId: 'a', remainingCards: 0 }, { playerId: 'b', remainingCards: 1 }];
    expect(() => settleRound(valid, 'c', 0, 5)).toThrow();
    expect(() => settleRound(valid, 'b', 0, 5)).toThrow();
    expect(() => settleRound([{ playerId: 'a', remainingCards: 0 }, { playerId: 'b', remainingCards: 0 }], 'a', 0, 5)).toThrow();
    expect(() => settleRound([{ playerId: 'a', remainingCards: 0 }, { playerId: 'a', remainingCards: 2 }], 'a', 0, 5)).toThrow();
    expect(() => settleRound([{ playerId: 'a', remainingCards: 0 }, { playerId: 'b', remainingCards: -1 }], 'a', 0, 5)).toThrow();
    expect(() => settleRound([{ playerId: 'a', remainingCards: 0 }, { playerId: 'b', remainingCards: 109 }], 'a', 0, 5)).toThrow();
  });
  it('freezes output, preserves input and never copies extra private fields into scores', () => {
    const players = Object.freeze([
      Object.freeze({ playerId: 'a', remainingCards: 0, secret: 'hidden' }),
      Object.freeze({ playerId: 'b', remainingCards: 1, secret: 'hidden' }),
    ]);
    const result = settleRound(players, 'a', 1, 20);
    expect(JSON.stringify(result)).not.toContain('hidden');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scores)).toBe(true);
    expect(Object.isFrozen(result.scores[0])).toBe(true);
  });
});
