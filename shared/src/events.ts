import { ROOM } from './config';
import type { Drawing, PlayerId, RaceEvent, RaceTick, RoomSnapshot } from './types';

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export type Ack<T = object> = (res: AckResult<T>) => void;

export interface Session {
  roomCode: string;
  playerId: PlayerId;
  token: string;
}

/**
 * Messages a client sends. The last function argument (if any) is the ack callback.
 * A room is created over HTTP first (POST API_CREATE_ROOM), then joined like any other.
 */
export interface ClientToServerEvents {
  'room:join': (p: { roomCode: string; nickname: string }, ack: Ack<{ session: Session }>) => void;
  /** takeover: this tab owned the session (reload) — replace any lingering old connection. */
  'room:resume': (p: Session & { takeover?: boolean }, ack: Ack<{ session: Session }>) => void;
  'room:leave': () => void;

  'player:startDrawing': () => void;
  'player:submitDrawing': (p: { drawing: Drawing }, ack: Ack) => void;

  'host:startRace': (ack: Ack) => void;
  'host:raceAgain': (ack: Ack) => void;
  'host:drawNew': (ack: Ack) => void;
  'host:addBot': (ack: Ack) => void;
  'host:removeBot': (p: { playerId: PlayerId }, ack: Ack) => void;

  'race:giddy': () => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void;
  /** drawing === null means removed. */
  'drawing:update': (p: { playerId: PlayerId; drawing: Drawing | null }) => void;
  'drawing:all': (p: Record<PlayerId, Drawing>) => void;
  'race:tick': (t: RaceTick) => void;
  'race:event': (e: RaceEvent) => void;
  /** This connection was replaced by another connection for the same player. */
  'room:kicked': (p: { reason: string }) => void;
}

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventData<K extends ServerEventName> = Parameters<ServerToClientEvents[K]>[0];

// ---------- wire format (JSON over a plain WebSocket) ----------

/** Client -> server. `id` is set when the client expects an ack. */
export interface ClientMessage {
  t: string;
  d?: unknown;
  id?: number;
}

/** Server -> client: an event, or the ack for a client message. */
export type ServerMessage = { t: ServerEventName; d: unknown } | { t: 'ack'; id: number; d: AckResult<object> };

/** POST here to reserve a new room code: `{ code }`. */
export const API_CREATE_ROOM = '/api/rooms';
/** WebSocket endpoint for one room: `/ws/<CODE>`. */
export const WS_PREFIX = '/ws/';
/** Close code the server uses when a newer connection took over this player. */
export const CLOSE_REPLACED = 4000;

const CODE_RE = new RegExp(`^[${ROOM.codeAlphabet}]{${ROOM.codeLength}}$`);
export const isRoomCode = (s: string) => CODE_RE.test(s);
