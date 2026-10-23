import { createRoomServer } from './ws-server';
const rawPort = process.env.PORT || '8787';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer from 1 to 65535'); process.exit(1);
}
const host = process.env.HOST || '127.0.0.1';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (allowedOrigins.some((origin) => {
  try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; }
  catch { return true; }
})) { console.error('ALLOWED_ORIGINS must contain exact HTTP/HTTPS origins, separated by commas'); process.exit(1); }
const server = createRoomServer({ port, host, allowedOrigins });
server.on('listening', () => { console.log(`Room server: ws://${host}:${port}/rooms (stage4.4 reliable multiplayer)`); });
server.on('error', (error: Error) => { console.error(`Room server failed: ${error.message}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.clients.forEach((socket) => socket.terminate()); server.close();
});
