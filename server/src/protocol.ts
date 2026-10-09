import {
  CLOSE_REPLACED,
  ROOM,
  sanitizeDrawing,
  validateDrawing,
  type AckResult,
  type ClientMessage,
  type Drawing,
  type PlayerId,
  type Pose,
} from '@bah/shared';
import type { Conn, Room } from './room';

const POSES: Pose[] = ['RUN', 'DUCK', 'JUMP', 'BIGJUMP'];

/**
 * Transport-independent message handling, shared by the Node server and the
 * Cloudflare Durable Object. `room` is the room this connection's URL points at,
 * or undefined if no such room exists.
 */

function cleanNick(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.replace(/\s+/g, ' ').trim().slice(0, ROOM.maxNicknameLength);
  return n.length ? n : null;
}

function currentPlayer(room: Room | undefined, conn: Conn): PlayerId | null {
  return room && conn.playerId && room.players.has(conn.playerId) ? conn.playerId : null;
}

function leaveCurrent(room: Room | undefined, conn: Conn) {
  const id = currentPlayer(room, conn);
  if (room && id) room.removePlayer(id);
  conn.playerId = null;
}

type Payload = any;

export function handleMessage(room: Room | undefined, conn: Conn, raw: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.t !== 'string') return;
  const p = (msg.d ?? {}) as Payload;
  const ack = (r: AckResult<Record<string, unknown>>) => {
    if (typeof msg.id === 'number') conn.ack(msg.id, r);
  };
  const ok = (err: string | null) => ack(err ? { ok: false, error: err } : { ok: true });
  const session = (playerId: PlayerId) => {
    const player = room!.players.get(playerId)!;
    return { roomCode: room!.code, playerId, token: player.token };
  };
  const me = currentPlayer(room, conn);

  switch (msg.t) {
    case 'room:join': {
      const nickname = cleanNick(p.nickname);
      if (!nickname) return ack({ ok: false, error: 'pick a nickname' });
      if (!room) return ack({ ok: false, error: 'no room with that code' });
      if (room.isFull() && !room.bumpBotForHuman()) return ack({ ok: false, error: 'room is full (8 horses max)' });
      if (room.nicknameTaken(nickname)) return ack({ ok: false, error: 'that name is taken in this room' });
      leaveCurrent(room, conn);
      const player = room.addPlayer(nickname);
      room.attach(player, conn);
      return ack({ ok: true, session: session(player.id) });
    }

    case 'room:resume': {
      const player = room && typeof p.playerId === 'string' ? room.players.get(p.playerId) : undefined;
      if (!room || !player || player.token !== p.token) return ack({ ok: false, error: 'session expired' });
      const old = room.connOf(player.id);
      if (old && old.id !== conn.id) {
        if (!p.takeover) return ack({ ok: false, error: 'already connected in another tab' });
        old.send('room:kicked', { reason: 'this horse was opened somewhere else' });
        room.detach(old);
        old.close(CLOSE_REPLACED, 'replaced');
      }
      room.attach(player, conn);
      return ack({ ok: true, session: session(player.id) });
    }

    case 'room:leave':
      return leaveCurrent(room, conn);

    case 'race:giddy':
      if (room && me) room.press(me);
      return;

    case 'race:shout':
      if (room && me && typeof p.level === 'number') room.shout(me, p.level, p.pitch, p.base);
      return;

    case 'race:pose':
      if (room && me && POSES.includes(p.pose)) room.setPose(me, p.pose);
      return;

    case 'player:startDrawing':
      if (room && me) room.startDrawing(me);
      return;
  }

  // Everything below needs a joined player.
  if (!room || !me) return ack({ ok: false, error: 'not in a room' });

  switch (msg.t) {
    case 'player:submitDrawing': {
      const err = validateDrawing(p.drawing);
      if (err) return ok(err);
      return ok(room.submitDrawing(me, sanitizeDrawing(p.drawing as Drawing)));
    }
    case 'host:startRace':
      return ok(room.startRace(me));
    case 'host:raceAgain':
      return ok(room.raceAgain(me));
    case 'host:drawNew':
      return ok(room.drawNew(me));
    case 'host:addBot':
      return ok(room.addBot(me));
    case 'host:removeBot':
      return ok(typeof p.playerId === 'string' ? room.removeBot(me, p.playerId) : 'bad request');
    default:
      return ack({ ok: false, error: 'unknown message' });
  }
}

/** The connection closed. */
export function handleClose(room: Room | undefined, conn: Conn) {
  room?.detach(conn);
}
