import { DurableObject } from 'cloudflare:workers';
import { API_CREATE_ROOM, ROOM, WS_PREFIX, isRoomCode } from '@bah/shared';
import { makeRoomCode, randomId } from './ids';
import { handleClose, handleMessage } from './protocol';
import { Room, type Conn } from './room';

/**
 * Cloudflare Worker entry. Static files are served by Workers Assets; only
 * /api/* and /ws/* reach this code (see run_worker_first in wrangler.jsonc).
 * Each room is one Durable Object, addressed by its room code.
 */

interface Attachment {
  id: string;
  playerId: string | null;
}

export class RoomDO extends DurableObject<Env> {
  private code: string | null = null;
  private room: Room | undefined;
  private conns = new Map<WebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.code = (await ctx.storage.get<string>('code')) ?? null;
    });
  }

  /** Reserve this object for a new room. False if the code is already in use. */
  async claim(code: string): Promise<boolean> {
    if (this.code) return false;
    await this.ctx.storage.put('code', code);
    this.code = code;
    await this.scheduleCleanup();
    return true;
  }

  /**
   * The live room. Game state is kept in memory: while anyone is in the room its
   * timers keep this object awake. If it was evicted, the code still exists and
   * the room starts over empty.
   */
  private getRoom(): Room | undefined {
    if (!this.code) return undefined;
    return (this.room ??= new Room(this.code));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: randomId(), playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private connFor(ws: WebSocket): Conn {
    let conn = this.conns.get(ws);
    if (conn) return conn;
    const att = ws.deserializeAttachment() as Attachment;
    let playerId = att.playerId;
    conn = {
      id: att.id,
      get playerId() {
        return playerId;
      },
      set playerId(v) {
        playerId = v;
        ws.serializeAttachment({ id: att.id, playerId: v } satisfies Attachment);
      },
      send: (t, d) => safeSend(ws, JSON.stringify({ t, d })),
      ack: (id, d) => safeSend(ws, JSON.stringify({ t: 'ack', id, d })),
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
    };
    this.conns.set(ws, conn);
    return conn;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    handleMessage(this.getRoom(), this.connFor(ws), raw);
    await this.scheduleCleanup();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.dropConn(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
    await this.scheduleCleanup();
  }

  async webSocketError(ws: WebSocket) {
    this.dropConn(ws);
    await this.scheduleCleanup();
  }

  private dropConn(ws: WebSocket) {
    handleClose(this.room, this.connFor(ws));
    this.conns.delete(ws);
  }

  /** Forget an abandoned room code after a while, so storage doesn't pile up. */
  private async scheduleCleanup() {
    if (this.room && this.room.players.size > 0) return;
    await this.ctx.storage.setAlarm(Date.now() + ROOM.emptyRoomTtlMs);
  }

  async alarm() {
    if (this.room && this.room.players.size > 0) return;
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM.emptyRoomTtlMs);
      return;
    }
    this.room?.dispose();
    this.room = undefined;
    this.code = null;
    await this.ctx.storage.deleteAll();
  }
}

function safeSend(ws: WebSocket, data: string) {
  try {
    ws.send(data);
  } catch {
    /* socket already closed */
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === API_CREATE_ROOM) {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      for (let i = 0; i < 8; i++) {
        const code = makeRoomCode();
        if (await env.ROOMS.getByName(code).claim(code)) return Response.json({ code });
      }
      return Response.json({ error: 'could not create a room, try again' }, { status: 503 });
    }

    if (url.pathname.startsWith(WS_PREFIX)) {
      const code = url.pathname.slice(WS_PREFIX.length).toUpperCase();
      if (!isRoomCode(code)) return new Response('bad room code', { status: 400 });
      return env.ROOMS.getByName(code).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
