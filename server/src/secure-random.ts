import { randomBytes } from 'node:crypto';
import type { RandomSource } from '../../packages/rules/src';
/** Uniform 48-bit sample in [0,1); entropy never comes from a client or Math.random. */
export const secureRandom: RandomSource = () => randomBytes(6).readUIntBE(0, 6) / 281474976710656;
