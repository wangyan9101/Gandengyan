import type { ClientMessage, ServerMessage } from './messages';
import { ERROR_CODES } from './messages';
import { object, oneOf, nullable, integer, array, stringValue, booleanValue, record, invalid, nullValue, type Schema } from './schema';
import { id, version, rulesSchema, declaration, roomSchema, selfGameSchema } from './views';

export const MAX_MESSAGE_LENGTH = 65536;
const base = { protocolVersion: oneOf(1), requestId: id, roomId: nullable(id), roundId: nullable(id), expectedVersion: version };
const clientSchema: Schema<ClientMessage> = (input) => {
  const value = record(input);
  switch (value.type) {
    case 'create-room': return object({ ...base, type: oneOf('create-room'), roomId: nullValue,
      roundId: nullValue, expectedVersion: integer(0, 0), capacity: integer(2, 8), rules: rulesSchema })(input);
    case 'join-room': return object({ ...base, type: oneOf('join-room'), roomId: id, roundId: nullValue })(input);
    case 'start': return object({ ...base, type: oneOf('start'), roomId: id })(input);
    case 'ready': return object({ ...base, type: oneOf('ready'), roomId: id, ready: booleanValue })(input);
    case 'play': {
      const message = object({ ...base, type: oneOf('play'), roomId: id, roundId: id,
        cardIds: array(stringValue(64), 1, 24), declaration: nullable(declaration) })(input);
      if (new Set(message.cardIds).size !== message.cardIds.length) return invalid();
      return message;
    }
    case 'pass': return object({ ...base, type: oneOf('pass'), roomId: id, roundId: id })(input);
    case 'sync': return object({ ...base, type: oneOf('sync'), roomId: id })(input);
    case 'leave': return object({ ...base, type: oneOf('leave'), roomId: id })(input);
    default: return invalid();
  }
};
const serverSchema: Schema<ServerMessage> = (input) => {
  const value = record(input);
  if (value.type === 'welcome') return object({ protocolVersion: oneOf(1), type: oneOf('welcome'), requestId: nullValue, selfPlayerId: id })(input);
  if (value.type === 'left') return object({ protocolVersion: oneOf(1), type: oneOf('left'), requestId: id,
    roomId: id, retained: booleanValue })(input);
  if (value.type === 'notice') return object({ protocolVersion: oneOf(1), type: oneOf('notice'), requestId: nullValue,
    roomId: id, roundId: id, gameVersion: version, playerId: id, code: oneOf('turn-timeout') })(input);
  if (value.type === 'error') return object({ protocolVersion: oneOf(1), type: oneOf('error'), requestId: id,
    roomId: nullable(id), roundId: nullable(id), code: oneOf(...ERROR_CODES) })(input);
  const message = object({ protocolVersion: oneOf(1), type: oneOf('sync'), requestId: nullable(id),
    room: roomSchema, self: nullable(selfGameSchema) })(input);
  if (message.room.status === 'waiting' || message.room.status === 'locked') {
    if (message.self !== null) return invalid();
  } else {
    const self = message.self;
    if (!self || self.public.status !== message.room.status ||
        JSON.stringify(self.public.rules) !== JSON.stringify(message.room.rules) ||
        self.public.players.length !== message.room.players.length ||
        self.public.players.some((player) => !message.room.players.some((member) => member.playerId === player.playerId))) return invalid();
  }
  return message;
};
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: 'invalid-message' };
function parse<T>(input: unknown, schema: Schema<T>): ParseResult<T> {
  try {
    let value: unknown = input;
    if (typeof input === 'string') {
      if (input.length > MAX_MESSAGE_LENGTH) return invalid();
      value = JSON.parse(input) as unknown;
    }
    const parsed = schema(value);
    if (JSON.stringify(parsed).length > MAX_MESSAGE_LENGTH) return invalid();
    return { ok: true, value: parsed };
  } catch { return { ok: false, error: 'invalid-message' }; }
}
export function parseClientMessage(input: unknown): ParseResult<ClientMessage> { return parse(input, clientSchema); }
export function parseServerMessage(input: unknown): ParseResult<ServerMessage> { return parse(input, serverSchema); }
/** Outbound data must pass the same privacy whitelist as inbound data. */
export function encodeClientMessage(input: unknown): string {
  const result = parseClientMessage(input);
  return result.ok ? JSON.stringify(result.value) : invalid();
}
export function encodeServerMessage(input: unknown): string {
  const result = parseServerMessage(input);
  return result.ok ? JSON.stringify(result.value) : invalid();
}
