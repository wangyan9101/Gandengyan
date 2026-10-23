import { WebSocketServer, WebSocket } from 'ws';
import { encodeServerMessage, parseResumeRequest, parseSessionCredentials } from '../../packages/protocol/src';
import type { RandomSource } from '../../packages/rules/src';
import { RoomService, type ReliabilityOptions } from './room-service';

export interface ServerOptions extends ReliabilityOptions { readonly port: number; readonly host?: string; readonly random?: RandomSource; readonly messageLimit?: number; readonly allowedOrigins?: readonly string[] }
export function createRoomServer(options: ServerOptions): WebSocketServer {
  const service = new RoomService(options.random, options);
  const server = new WebSocketServer({ port: options.port, host: options.host || '127.0.0.1',
    path: '/rooms', maxPayload: 65536, perMessageDeflate: false,
    verifyClient: ({ origin }: { readonly origin: string }) => {
      if (!origin) return true; // Native clients have no browser Origin; identities are still connection-bound.
      if (options.allowedOrigins?.includes(origin)) return true;
      try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { return false; }
    },
  });
  const maintenance = setInterval(() => service.tick(), 1000);
  maintenance.unref();
  server.on('close', () => clearInterval(maintenance));
  server.on('connection', (socket) => {
    socket.on('error', () => { socket.terminate(); });
    if (server.clients.size > 128) { socket.close(1013, 'Connection limit'); return; }
    let playerId: string;
    try { playerId = service.connect((message) => {
      if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 262144) { socket.terminate(); return; }
        socket.send(encodeServerMessage(message));
      }
    }, (message) => {
      const parsed = parseSessionCredentials(message);
      if (!parsed.ok) throw new Error('Invalid private session frame');
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(parsed.value));
    }, () => socket.close(4000, 'Session replaced')); }
    catch { socket.close(1013, 'Session limit'); return; }
    let windowStart = Date.now();
    let count = 0;
    let alive = true;
    socket.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false; socket.ping();
    }, 15000);
    socket.on('message', (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (binary) { socket.close(1003, 'Text messages only'); return; }
      const now = Date.now();
      if (now - windowStart >= 10000) { windowStart = now; count = 0; }
      count += 1;
      if (count > (options.messageLimit || 60)) { socket.close(1008, 'Message rate limit'); return; }
      try {
        const input = data.toString('utf8');
        const resume = parseResumeRequest(input);
        if (resume.ok) {
          if (!service.resume(playerId, resume.value)) socket.close(4001, 'Session expired');
        } else service.receive(playerId, input);
      }
      catch { socket.close(1011, 'Request failed'); }
    });
    socket.on('close', () => { clearInterval(heartbeat); service.disconnect(playerId); });
  });
  return server;
}
