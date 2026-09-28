import WebSocket from 'ws';
import { API_CREATE_ROOM, GameClient, type WSConstructor } from '@bah/shared';

/** Where the test scripts connect: the dev server by default. */
export const BASE_URL = process.env.URL ?? 'http://localhost:5173';

export const newClient = () => new GameClient(WebSocket as unknown as WSConstructor, BASE_URL.replace(/^http/, 'ws'));

/** Reserve a new room code, like the browser does before joining. */
export async function createRoomCode(): Promise<string> {
  const res = await fetch(BASE_URL + API_CREATE_ROOM, { method: 'POST' });
  const body = (await res.json()) as { code?: string; error?: string };
  if (!body.code) throw new Error(body.error ?? `create failed: ${res.status}`);
  return body.code;
}
