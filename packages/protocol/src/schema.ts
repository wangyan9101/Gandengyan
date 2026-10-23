/** Small JSON-only schema helpers. Objects are rebuilt and frozen; unknown keys are rejected. */
export type Schema<T> = (input: unknown) => T;
export function invalid(): never { throw new Error('Invalid protocol message'); }
export const stringValue = (max: number): Schema<string> => (value) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0
    ? value : invalid();
export const integer = (min: number, max: number): Schema<number> => (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
export const booleanValue: Schema<boolean> = (value) => typeof value === 'boolean' ? value : invalid();
export function oneOf<T extends string | number>(...values: readonly T[]): Schema<T> {
  return (input) => values.find((value) => value === input) ?? invalid();
}
export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return (input) => input === null ? null : schema(input);
}
export function array<T>(schema: Schema<T>, min: number, max: number): Schema<readonly T[]> {
  return (input) => {
    if (!Array.isArray(input) || input.length < min || input.length > max) return invalid();
    const values: T[] = [];
    for (let index = 0; index < input.length; index += 1) values.push(schema(input[index]));
    return Object.freeze(values);
  };
}
export function record(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return invalid();
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return input as Record<string, unknown>;
}
export function object<T extends object>(fields: { readonly [K in keyof T]: Schema<T[K]> }): Schema<T> {
  return (input) => {
    const value = record(input);
    const keys = Object.keys(fields) as (keyof T & string)[];
    if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !Object.prototype.hasOwnProperty.call(fields, key))) return invalid();
    // Each own field is checked by its corresponding schema before constructing T.
    const result = {} as { -readonly [K in keyof T]: T[K] };
    for (const key of keys) result[key] = fields[key](value[key]);
    return Object.freeze(result);
  };
}

export const nullValue: Schema<null> = (input) => input === null ? null : invalid();
