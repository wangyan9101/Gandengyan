import { describe, expect, it } from 'vitest';
import { SocketNetworkClient, type SocketHandlers } from '../../packages/remote/src';
import { fixture } from './protocol-fixtures';

function setup() {
  const handlers: SocketHandlers[] = [];
  const timers = new Set<() => void>(); const sent: string[] = [];
  const network = new SocketNetworkClient((_url, callbacks) => {
    handlers.push(callbacks);
    return { send: (data) => { sent.push(data); }, close: () => {} };
  }, (callback) => { timers.add(callback); return () => { timers.delete(callback); }; });
  const latest = () => { const value = handlers[handlers.length - 1]; if (!value) throw new Error('no socket'); return value; };
  const welcome = () => latest().message(JSON.stringify({ protocolVersion: 1, type: 'welcome', requestId: null, selfPlayerId: 'alice' }));
  return { network, handlers, latest, welcome, sent, timeout: () => Array.from(timers).forEach((callback) => callback()) };
}
const request = { protocolVersion: 1, requestId: 'q1', type: 'sync', roomId: 'room-1', roundId: null, expectedVersion: 0 } as const;
describe('network lifecycle and boundary', () => {
  it('requires the validated welcome before accepting requests', async () => {
    const { network, welcome, latest, sent } = setup();
    const connecting = network.connect('ws://localhost:8787/rooms');
    expect(network.status).toBe('connecting');
    await expect(network.request(request)).rejects.toThrow('not-connected');
    welcome(); await connecting;
    expect(network.selfPlayerId).toBe('alice');
    const response = network.request(request);
    expect(JSON.parse(sent[0] || '{}')).toMatchObject(request);
    latest().message(JSON.stringify({ protocolVersion: 1, type: 'error', requestId: 'q1', roomId: 'room-1', roundId: null, code: 'forbidden' }));
    await expect(response).resolves.toMatchObject({ code: 'forbidden' });
    network.close();
  });
  it('rejects a malformed welcome and preserves no claimed identity', async () => {
    const { network, latest } = setup();
    const connection = network.connect('ws://localhost:8787/rooms');
    const rejected = expect(connection).rejects.toThrow();
    latest().message(JSON.stringify({ protocolVersion: 1, type: 'welcome', requestId: null, selfPlayerId: 'alice', token: 'secret' }));
    await rejected; expect(network.status).toBe('error'); expect(network.selfPlayerId).toBeNull();
  });
  it('times out handshakes and requests, and rejects duplicates', async () => {
    const first = setup(); const connection = first.network.connect('ws://localhost:8787/rooms');
    const failed = expect(connection).rejects.toThrow(); first.timeout(); await failed;
    const second = setup(); const connected = second.network.connect('ws://localhost:8787/rooms'); second.welcome(); await connected;
    const response = second.network.request(request); const timedOut = expect(response).rejects.toThrow('request-timeout');
    await expect(second.network.request(request)).rejects.toThrow('request-conflict');
    second.timeout(); await timedOut; second.network.close();
  });
  it('rejects in-flight requests on close and ignores old socket events after reconnect', async () => {
    const { network, welcome, latest, handlers } = setup();
    const initial = network.connect('ws://localhost:8787/rooms'); welcome(); await initial;
    const old = latest();
    const pending = network.request(request); const closed = expect(pending).rejects.toThrow('connection-closed');
    network.close(); await closed;
    const next = network.connect('ws://localhost:8787/rooms');
    old.message(JSON.stringify({ protocolVersion: 1, type: 'welcome', requestId: null, selfPlayerId: 'intruder' }));
    expect(network.status).toBe('connecting');
    welcome(); await next; expect(handlers.length).toBe(2); expect(network.selfPlayerId).toBe('alice'); network.close();
  });
  it('does not deliver unvalidated private fields to subscribers', async () => {
    const { network, welcome, latest } = setup(); let delivered = 0;
    network.onMessage(() => { delivered += 1; });
    const initial = network.connect('ws://localhost:8787/rooms'); welcome(); await initial;
    latest().message(JSON.stringify({ protocolVersion: 1, type: 'error', requestId: 'q1', roomId: null,
      roundId: null, code: 'unauthorized', hand: ['private-card'] }));
    expect(delivered).toBe(0); expect(network.status).toBe('error');
  });
});

function recoverySetup() {
  const handlers: SocketHandlers[] = []; const sent: string[] = [];
  const timers = new Map<() => void, number>();
  let throwFactory = false;
  const network = new SocketNetworkClient((_url, callbacks) => {
    if (throwFactory) throw new Error('platform failure');
    handlers.push(callbacks); return { send: (data) => { sent.push(data); }, close: () => {} };
  }, (callback, delay) => { timers.set(callback, delay); return () => { timers.delete(callback); }; });
  const latest = () => { const value = handlers[handlers.length - 1]; if (!value) throw new Error('socket'); return value; };
  const welcome = () => latest().message({ protocolVersion: 1, type: 'welcome', requestId: null, selfPlayerId: 'alice' });
  const credential = (resumed: boolean) => latest().message({ protocolVersion: 1, type: 'session', selfPlayerId: 'alice',
    resumeToken: 'f'.repeat(64), resumed, snapshot: resumed ? fixture().sync : null });
  const fire = (delay: number) => {
    const entry = [...timers].find((item) => item[1] === delay);
    if (!entry) throw new Error(`Missing timer ${delay}`);
    timers.delete(entry[0]); entry[0]();
  };
  return { network, handlers, sent, latest, welcome, credential, timers, fire, failFactory: () => { throwFactory = true; } };
}
describe('automatic authenticated recovery', () => {
  it('recovers the same identity, ignores temporary guest credentials and delivers only the fresh own snapshot', async () => {
    const setup = recoverySetup(); const { network } = setup;
    const delivered: string[] = []; network.onMessage((message) => delivered.push(message.type));
    const connected = network.connect('ws://localhost/rooms'); setup.welcome(); await connected; setup.credential(false);
    const old = setup.latest(); const pending = network.request(request);
    const failed = expect(pending).rejects.toThrow('connection-closed');
    old.close(); await failed; expect(network.status).toBe('reconnecting');
    await expect(network.request(request)).rejects.toThrow('not-connected');
    setup.fire(250); setup.welcome();
    expect(JSON.parse(setup.sent[setup.sent.length - 1] || '{}')).toEqual({ protocolVersion: 1, type: 'resume', resumeToken: 'f'.repeat(64) });
    setup.credential(false); expect(network.status).toBe('connecting');
    setup.credential(true); expect(network.status).toBe('connected'); expect(network.selfPlayerId).toBe('alice');
    expect(delivered).toEqual(['sync']);
    old.close(); expect(network.status).toBe('connected'); network.close();
  });
  it('cancels retries on explicit close and never reuses a credential for another endpoint', async () => {
    const setup = recoverySetup(); const connected = setup.network.connect('ws://localhost/rooms');
    setup.welcome(); await connected; setup.credential(false); setup.latest().close();
    expect([...setup.timers.values()]).toContain(250);
    setup.network.close(); expect(setup.timers.size).toBe(0);
    const different = setup.network.connect('ws://localhost:9999/rooms'); setup.welcome(); await different;
    expect(setup.sent).toHaveLength(0); setup.network.close();
  });
  it('stops on expired/replaced sessions instead of an endless takeover loop', async () => {
    for (const code of [4000, 4001]) {
      const setup = recoverySetup(); const connected = setup.network.connect('ws://localhost/rooms');
      setup.welcome(); await connected; setup.credential(false); setup.latest().close(code);
      expect(setup.network.status).toBe('error'); expect(setup.timers.size).toBe(0);
    }
  });
  it('has a finite exponential retry budget even when socket creation throws synchronously', async () => {
    const setup = recoverySetup(); const connected = setup.network.connect('ws://localhost/rooms');
    setup.welcome(); await connected; setup.credential(false); setup.failFactory(); setup.latest().close();
    for (let retry = 0; retry < 10; retry += 1) setup.fire(Math.min(250 * 2 ** retry, 8000));
    expect(setup.network.status).toBe('error'); expect(setup.timers.size).toBe(0);
    await Promise.resolve();
  });
  it('recovers an authoritative snapshot after a request acknowledgement times out', async () => {
    const setup = recoverySetup(); const connected = setup.network.connect('ws://localhost/rooms');
    setup.welcome(); await connected; setup.credential(false);
    const pending = setup.network.request(request); const failed = expect(pending).rejects.toThrow('request-timeout');
    setup.fire(5000); await failed; expect(setup.network.status).toBe('reconnecting');
    setup.fire(250); setup.welcome(); setup.credential(true);
    expect(setup.network.status).toBe('connected');
    expect(setup.sent.filter((data) => JSON.parse(data).type === 'sync')).toHaveLength(1);
    setup.network.close();
  });
});
