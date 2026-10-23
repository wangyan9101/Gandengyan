import { object, oneOf, booleanValue, nullable, stringValue, invalid, type Schema } from './schema';
import { parseServerMessage, type ParseResult } from './validation';
import type { ServerMessage } from './messages';

/** Private transport credentials. Never put these frames in room broadcasts or logs. */
export interface ResumeRequest {
  readonly protocolVersion: 1;
  readonly type: 'resume';
  readonly resumeToken: string;
}
export interface SessionCredentials {
  readonly protocolVersion: 1;
  readonly type: 'session';
  readonly selfPlayerId: string;
  readonly resumeToken: string;
  readonly resumed: boolean;
  readonly snapshot: Extract<ServerMessage, { type: 'sync' }> | null;
}
const token: Schema<string> = (input) => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input) ? input : invalid();
const resumeSchema = object<ResumeRequest>({ protocolVersion: oneOf(1), type: oneOf('resume'), resumeToken: token });
const snapshot: Schema<SessionCredentials['snapshot']> = nullable((input) => {
  const parsed = parseServerMessage(input);
  return parsed.ok && parsed.value.type === 'sync' ? parsed.value : invalid();
});
const sessionSchema: Schema<SessionCredentials> = (input) => {
  const result = object<SessionCredentials>({ protocolVersion: oneOf(1), type: oneOf('session'),
    selfPlayerId: stringValue(128), resumeToken: token, resumed: booleanValue, snapshot })(input);
  if ((!result.resumed && result.snapshot !== null) || (result.snapshot &&
      (!result.snapshot.room.players.some((member) => member.playerId === result.selfPlayerId) ||
      (result.snapshot.self && result.snapshot.self.selfPlayerId !== result.selfPlayerId)))) return invalid();
  return result;
};
function parse<T>(input: unknown, schema: Schema<T>): ParseResult<T> {
  try {
    const value: unknown = typeof input === 'string' && input.length <= 65536 ? JSON.parse(input) as unknown : input;
    return { ok: true, value: schema(value) };
  } catch { return { ok: false, error: 'invalid-message' }; }
}
export function parseResumeRequest(input: unknown): ParseResult<ResumeRequest> { return parse(input, resumeSchema); }
export function parseSessionCredentials(input: unknown): ParseResult<SessionCredentials> { return parse(input, sessionSchema); }
