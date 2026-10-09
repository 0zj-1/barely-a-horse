import { useSyncExternalStore } from 'react';
import {
  canTransition,
  type ClientState,
  type Drawing,
  type PlayerId,
  type RaceEvent,
  type RaceTick,
  type Pose,
  type RoomSnapshot,
  type Session,
} from '@bah/shared';
import { clearSession, loadSession, requestRoomCode, sampleServerTime, saveSession, socket } from './net/socket';

export interface Store {
  state: ClientState;
  session: Session | null;
  room: RoomSnapshot | null;
  drawings: Record<PlayerId, Drawing>;
  events: RaceEvent[];
  connected: boolean;
  notice: string | null;
  /** Which form JOINING shows when entered from HOME. */
  joinMode: 'create' | 'join' | 'resume';
}

let store: Store = {
  state: 'HOME',
  session: null,
  room: null,
  drawings: {},
  events: [],
  connected: false,
  notice: null,
  joinMode: 'create',
};

/** Race ticks live outside React state: the renderer reads them every frame. */
export const raceBuffer: { ticks: RaceTick[]; finishOrder: PlayerId[] } = { ticks: [], finishOrder: [] };

const listeners = new Set<() => void>();
function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

export function useStore(): Store {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
}
export const getStore = () => store;

// ---------- state machine ----------

export function go(to: ClientState, extra: Partial<Store> = {}) {
  if (!canTransition(store.state, to)) {
    console.warn(`[state] refused invalid transition ${store.state} -> ${to}`);
    return false;
  }
  if (to !== store.state) console.debug(`[state] ${store.state} -> ${to}`);
  if (to === 'COUNTDOWN' || (to === 'RACING' && store.state !== 'COUNTDOWN')) {
    raceBuffer.ticks = [];
    raceBuffer.finishOrder = [];
    extra = { events: [], ...extra };
  }
  set({ ...extra, state: to });
  return true;
}

/** Which screen the authoritative room snapshot implies for this player. */
function deriveState(room: RoomSnapshot, myId: PlayerId): ClientState | null {
  const me = room.players.find((p) => p.id === myId);
  if (!me) return null;
  const racing = room.racers.includes(myId);
  if (room.phase === 'LOBBY') {
    return me.status === 'WAITING' ? 'LOBBY' : me.status;
  }
  // Non-racers who are busy drawing keep drawing while the others race.
  if (!racing && me.status === 'DRAWING') return 'DRAWING';
  return room.phase;
}

// ---------- socket wiring ----------

// The socket is per room: opened when we join/resume, closed when we leave.
// Every (re)connect while we hold a seat resumes it.
let resumeOnConnect: { session: Session; takeover: boolean } | null = null;

socket.on('connect', () => {
  set({ connected: true });
  if (store.session && store.state !== 'JOINING') resume(store.session, true); // reconnect
  else if (resumeOnConnect) resume(resumeOnConnect.session, resumeOnConnect.takeover); // page load
  resumeOnConnect = null;
});
socket.on('disconnect', () => set({ connected: false }));

// The server sends the first room:state before the create/join ack arrives,
// so remember it until we know our player id.
let lastSnapshot: RoomSnapshot | null = null;

socket.on('room:state', (room) => {
  sampleServerTime(room.serverNow);
  lastSnapshot = room;
  const myId = store.session?.playerId;
  if (!myId || room.code !== store.session?.roomCode) return;
  const next = deriveState(room, myId);
  if (!next) {
    // We're no longer in this room.
    leaveRoom('you were removed from the room');
    return;
  }
  go(next, { room });
  if (store.room !== room) set({ room }); // keep data fresh even if transition was refused
});

socket.on('drawing:all', (all) => set({ drawings: all }));
socket.on('drawing:update', ({ playerId, drawing }) => {
  const drawings = { ...store.drawings };
  if (drawing) drawings[playerId] = drawing;
  else delete drawings[playerId];
  set({ drawings });
});

socket.on('race:tick', (t) => {
  sampleServerTime(t.t);
  const buf = raceBuffer.ticks;
  buf.push(t);
  if (buf.length > 60) buf.splice(0, buf.length - 60);
  for (const h of t.horses) {
    if (h.finished && !raceBuffer.finishOrder.includes(h.id)) raceBuffer.finishOrder.push(h.id);
  }
});

socket.on('room:kicked', ({ reason }) => {
  socket.connect(null);
  clearSession(true); // leave localStorage alone: it belongs to the tab that took over
  go('HOME', { session: null, room: null, drawings: {}, events: [], notice: reason });
});

socket.on('race:event', (e) => set({ events: [...store.events.slice(-4), e] }));

{
  const saved = loadSession();
  if (saved) {
    resumeOnConnect = { session: saved.session, takeover: saved.fromTab };
    go('JOINING', { joinMode: 'resume', session: saved.session });
    socket.connect(saved.session.roomCode);
  }
}

// ---------- actions ----------

function enterRoom(session: Session) {
  saveSession(session);
  set({ session, notice: null });
  // The room:state that arrives with the join moves us out of JOINING.
  if (lastSnapshot?.code === session.roomCode) {
    const next = deriveState(lastSnapshot, session.playerId);
    if (next) go(next, { room: lastSnapshot });
  }
}

function resume(s: Session, takeover: boolean) {
  go('JOINING', { joinMode: 'resume', session: s, room: null });
  socket.emit('room:resume', { ...s, takeover }, (res) => {
    if (res.ok) return enterRoom(res.session);
    socket.connect(null);
    const elsewhere = res.error === 'already connected in another tab';
    // If another tab is playing with this session, leave its stored copy alone.
    if (elsewhere) clearSession(true);
    else clearSession();
    go('HOME', {
      session: null,
      room: null,
      drawings: {},
      notice: elsewhere
        ? '(you also have a horse racing in another tab)'
        : res.error === 'session expired'
          ? 'your old seat expired. start again!'
          : res.error,
    });
  });
}

export function openJoin(mode: 'create' | 'join') {
  go('JOINING', { joinMode: mode, notice: null });
}

export function backHome() {
  go('HOME', { notice: null });
}

export async function createRoom(nickname: string): Promise<string | null> {
  try {
    return await joinRoom(await requestRoomCode(), nickname);
  } catch (e) {
    return e instanceof Error ? e.message : 'could not create a room';
  }
}

export function joinRoom(roomCode: string, nickname: string): Promise<string | null> {
  socket.connect(roomCode.toUpperCase());
  return new Promise((done) => {
    socket.emit('room:join', { roomCode, nickname }, (res) => {
      if (!res.ok) {
        socket.connect(null);
        return done(res.error);
      }
      enterRoom(res.session);
      done(null);
    });
  });
}

export function leaveRoom(notice: string | null = null) {
  socket.emit('room:leave');
  socket.connect(null);
  clearSession();
  go('HOME', { session: null, room: null, drawings: {}, events: [], notice });
}

export const startDrawing = () => socket.emit('player:startDrawing');

export function submitDrawing(drawing: Drawing): Promise<string | null> {
  return new Promise((done) =>
    socket.emit('player:submitDrawing', { drawing }, (res) => done(res.ok ? null : res.error)),
  );
}

const hostCall = (ev: 'host:startRace' | 'host:raceAgain' | 'host:drawNew' | 'host:addBot') =>
  new Promise<string | null>((done) => socket.emit(ev, (res) => done(res.ok ? null : res.error)));
export const startRace = () => hostCall('host:startRace');
export const raceAgain = () => hostCall('host:raceAgain');
export const drawNew = () => hostCall('host:drawNew');
export const addBot = () => hostCall('host:addBot');
export const removeBot = (playerId: PlayerId) =>
  new Promise<string | null>((done) =>
    socket.emit('host:removeBot', { playerId }, (res) => done(res.ok ? null : res.error)),
  );

export const giddyUp = () => socket.emit('race:giddy');
/** Mic loudness 0..1 (+ pitch in Hz). The server clamps it and owns the resulting speed. */
export const shout = (level: number, pitch = 0, base = 0) => socket.emit('race:shout', { level, pitch, base });
/** Keyboard / touch pose, for players without a microphone. */
export const setPose = (pose: Pose) => socket.emit('race:pose', { pose });

// This module owns the socket listeners and session: hot-swapping it would
// leave a stale store behind, so do a full reload (which resumes the session).
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

if (import.meta.env.DEV) {
  (window as unknown as { __bah: unknown }).__bah = { raceBuffer, getStore, shout, giddyUp, setPose };
}
