import type { DeckCount } from './card';

export type BombSize = 3 | 4 | 5 | 6 | 7 | 8;
export type HandKind = 'single' | 'pair' | 'straight' | 'consecutive-pairs' | 'bomb';

/** Confirmed setup boundaries only. This is NOT a playable rule profile. */
export interface SetupConstraints {
  readonly playerCount: number;
  readonly deckCount: DeckCount;
  readonly allowedBombSizes: readonly BombSize[];
  readonly roundPointCap: number;
  readonly bombMultiplierScope: 'global';
}

export interface ValidationIssue {
  readonly field: keyof SetupConstraints | '$';
  readonly message: string;
}

/** Accepts untrusted input; validates only confirmed setup constraints. */
export function validateSetupConstraints(input: unknown): readonly ValidationIssue[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ field: '$', message: 'Setup must be an object' }];
  }
  const value = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const integerInRange = (number: unknown, min: number, max: number): boolean =>
    typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max;

  if (!integerInRange(value.playerCount, 2, 8)) {
    issues.push({ field: 'playerCount', message: 'Expected an integer from 2 to 8' });
  }
  if (value.deckCount !== 1 && value.deckCount !== 2) {
    issues.push({ field: 'deckCount', message: 'Expected 1 or 2 decks' });
  }
  if (
    !Array.isArray(value.allowedBombSizes) ||
    value.allowedBombSizes.length === 0 ||
    Array.from(value.allowedBombSizes).some((size: unknown) => !integerInRange(size, 3, 8)) ||
    new Set(value.allowedBombSizes).size !== value.allowedBombSizes.length
  ) {
    issues.push({ field: 'allowedBombSizes', message: 'Expected unique bomb sizes from 3 to 8' });
  }
  if (!integerInRange(value.roundPointCap, 5, 50)) {
    issues.push({ field: 'roundPointCap', message: 'Expected an integer from 5 to 50' });
  }
  if (value.bombMultiplierScope !== 'global') {
    issues.push({ field: 'bombMultiplierScope', message: 'Expected global multiplier scope' });
  }
  return issues;
}

export interface RuleConfig {
  readonly version: 'gdy-default-v1';
  readonly deckCount: DeckCount;
  readonly allowedBombSizes: readonly BombSize[];
  readonly roundPointCap: number;
  readonly straightMinLength: number;
  readonly consecutivePairsMinLength: number;
}

export type RuleOptions = Partial<Omit<RuleConfig, 'version'>>;

/** Validates, copies and freezes a rule profile. Defaults are documented in RULES.md. */
export function createRules(options: RuleOptions = {}): RuleConfig {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new RangeError('Rule options must be an object');
  }
  const supported = ['deckCount', 'allowedBombSizes', 'roundPointCap', 'straightMinLength', 'consecutivePairsMinLength'];
  if (Object.keys(options).some((key) => supported.indexOf(key) < 0)) throw new RangeError('Unknown rule option');
  const rules: RuleConfig = {
    version: 'gdy-default-v1',
    deckCount: options.deckCount === undefined ? 1 : options.deckCount,
    allowedBombSizes: options.allowedBombSizes === undefined ? [3, 4, 5, 6, 7, 8] : options.allowedBombSizes,
    roundPointCap: options.roundPointCap === undefined ? 20 : options.roundPointCap,
    straightMinLength: options.straightMinLength === undefined ? 3 : options.straightMinLength,
    consecutivePairsMinLength: options.consecutivePairsMinLength === undefined ? 2 : options.consecutivePairsMinLength,
  };
  const issues = validateSetupConstraints({ ...rules, playerCount: 2, bombMultiplierScope: 'global' });
  if (issues.length > 0 ||
      !Number.isInteger(rules.straightMinLength) || rules.straightMinLength < 3 || rules.straightMinLength > 12 ||
      !Number.isInteger(rules.consecutivePairsMinLength) ||
      rules.consecutivePairsMinLength < 2 || rules.consecutivePairsMinLength > 12) {
    throw new RangeError('Invalid rule configuration');
  }
  return Object.freeze({ ...rules, allowedBombSizes: Object.freeze([...rules.allowedBombSizes]) });
}

export const DEFAULT_RULES = createRules();
