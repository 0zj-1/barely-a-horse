import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { API_CREATE_ROOM, WS_PREFIX, isRoomCode } from '@bah/shared';
import { randomId } from './ids';
import { handleClose, handleMessage } from './protocol';
import type { Conn } from './room';
import { RoomRegistry } from './rooms';

/**
 * Node version of the game server: serves the built client and runs all rooms in
 * one process. The Cloudflare version (worker.ts) runs the same Room/protocol code.
 */

// PORT is honoured in production (hosting platforms set it). In dev it's often set for
// the Vite side, so the game server uses SERVER_PORT (default 3001).
const PORT = Number(
  process.env.SERVER_PORT ?? (process.env.NODE_ENV === 'production' ? process.env.PORT : undefined) ?? 3001,
);
const CLIENT_DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../client/dist/client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const rooms = new RoomRegistry();

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');

  if (url.pathname === API_CREATE_ROOM && req.method === 'POST') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: rooms.create().code }));
    return;
  }

  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('barely a horse server. build the client first: `npm run build`.');
    return;
  }
  let file = normalize(join(CLIENT_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(CLIENT_DIST)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 1e6 });

http.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const code = path.startsWith(WS_PREFIX) ? path.slice(WS_PREFIX.length).toUpperCase() : '';
  if (!isRoomCode(code)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, code));
});

function onConnection(ws: WebSocket, code: string) {
  const conn: Conn = {
    id: randomId(),
    playerId: null,
    send: (t, d) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ t, d })),
    ack: (id, d) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ t: 'ack', id, d })),
    close: (c, reason) => ws.close(c, reason),
  };
  // Look the room up per message: the room may be created after the socket opened.
  ws.on('message', (data) => handleMessage(rooms.get(code), conn, data.toString()));
  ws.on('close', () => handleClose(rooms.get(code), conn));
}

http.listen(PORT, () => {
  console.log(`[barely-a-horse] server on http://localhost:${PORT}`);
});
