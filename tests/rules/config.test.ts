import { describe, expect, it } from 'vitest';
import { createRules, DEFAULT_RULES, validateSetupConstraints, type SetupConstraints } from '../../packages/rules/src';

const valid: SetupConstraints = {
  playerCount: 2,
  deckCount: 1,
  allowedBombSizes: [3, 4, 5, 6, 7, 8],
  roundPointCap: 5,
  bombMultiplierScope: 'global',
};

describe('confirmed setup constraints', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('accepts %i players', (playerCount) => {
    expect(validateSetupConstraints({ ...valid, playerCount })).toEqual([]);
  });
  it('accepts the upper cap and two decks', () => {
    expect(validateSetupConstraints({ ...valid, deckCount: 2, roundPointCap: 50 })).toEqual([]);
  });
  it.each([1, 9, 2.5, NaN, Infinity, '2', null])('rejects player count %s', (playerCount) => {
    expect(validateSetupConstraints({ ...valid, playerCount })).toEqual([
      expect.objectContaining({ field: 'playerCount' }),
    ]);
  });
  it.each([4, 51, 5.5, NaN, Infinity, '5'])('rejects point cap %s', (roundPointCap) => {
    expect(validateSetupConstraints({ ...valid, roundPointCap })).toEqual([
      expect.objectContaining({ field: 'roundPointCap' }),
    ]);
  });
  it.each([[], [2], [9], [3, 3], [3.5], ['3'], null].map((sizes) => ({ sizes })))
  ('rejects invalid bomb sizes $sizes', ({ sizes: allowedBombSizes }) => {
    expect(validateSetupConstraints({ ...valid, allowedBombSizes })).toEqual([
      expect.objectContaining({ field: 'allowedBombSizes' }),
    ]);
  });
  it.each([null, undefined, [], 'setup', 1])('rejects non-object %j', (input) => {
    expect(validateSetupConstraints(input)).toEqual([expect.objectContaining({ field: '$' })]);
  });
  it('reports missing fields together', () => {
    expect(validateSetupConstraints({}).map((issue) => issue.field)).toEqual([
      'playerCount', 'deckCount', 'allowedBombSizes', 'roundPointCap', 'bombMultiplierScope',
    ]);
  });
  it('rejects unsupported deck and multiplier scope', () => {
    expect(validateSetupConstraints({ ...valid, deckCount: 3, bombMultiplierScope: 'personal' })
      .map((issue) => issue.field)).toEqual(['deckCount', 'bombMultiplierScope']);
  });
  it('does not mutate caller configuration', () => {
    const input = Object.freeze({ ...valid, allowedBombSizes: Object.freeze([3, 8]) });
    expect(validateSetupConstraints(input)).toEqual([]);
    expect(input.allowedBombSizes).toEqual([3, 8]);
  });
});

describe('versioned playable profile', () => {
  it('publishes the documented defaults without sharing caller-owned arrays', () => {
    expect(DEFAULT_RULES).toEqual({ version: 'gdy-default-v1', deckCount: 1,
      allowedBombSizes: [3, 4, 5, 6, 7, 8], roundPointCap: 20,
      straightMinLength: 3, consecutivePairsMinLength: 2 });
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RULES.allowedBombSizes)).toBe(true);
    const sizes: (3 | 4)[] = [3, 4];
    const rules = createRules({ allowedBombSizes: sizes });
    sizes.pop();
    expect(rules.allowedBombSizes).toEqual([3, 4]);
  });
  it.each([
    { deckCount: 0 }, { roundPointCap: 4 }, { roundPointCap: 51 },
    { allowedBombSizes: [] }, { allowedBombSizes: [3, 3] }, { allowedBombSizes: [9] },
    { allowedBombSizes: new Array(1) }, { straightMinLength: 2 }, { straightMinLength: 13 },
    { straightMinLength: 3.5 }, { consecutivePairsMinLength: 1 }, { consecutivePairsMinLength: 13 },
    { consecutivePairsMinLength: NaN }, { version: 'custom' }, { unknownOption: true }, null, [],
  ])('rejects malformed or unsupported profile %j', (options) => {
    expect(() => createRules(options)).toThrow(RangeError);
  });
});
