import type { RoomPhase } from './types';

/**
 * Client-side screen state machine. The client only moves between these via
 * `canTransition`; the server is the source of truth for the room phase.
 */
export type ClientState =
  | 'HOME'
  | 'JOINING'
  | 'LOBBY'
  | 'DRAWING'
  | 'READY'
  | 'COUNTDOWN'
  | 'RACING'
  | 'RESULTS';

// Spectators (joined mid-race, or still drawing) can sit in DRAWING while the room
// is racing, which is why DRAWING can jump straight to RACING / RESULTS.
const CLIENT_TRANSITIONS: Record<ClientState, readonly ClientState[]> = {
  HOME: ['JOINING'],
  // A resumed session can land anywhere, even mid-race.
  JOINING: ['HOME', 'LOBBY', 'DRAWING', 'READY', 'COUNTDOWN', 'RACING', 'RESULTS'],
  LOBBY: ['HOME', 'DRAWING', 'COUNTDOWN'],
  DRAWING: ['HOME', 'READY', 'COUNTDOWN', 'RACING', 'RESULTS'],
  READY: ['HOME', 'DRAWING', 'COUNTDOWN'],
  COUNTDOWN: ['HOME', 'RACING', 'LOBBY', 'READY'], // back to lobby if racers drop out
  RACING: ['HOME', 'RESULTS'],
  RESULTS: ['HOME', 'COUNTDOWN', 'DRAWING'], // race again / draw new horse
};

/** Every state may go HOME (leave room) or JOINING (socket reconnect -> resume). */
export function canTransition(from: ClientState, to: ClientState): boolean {
  return from === to || to === 'JOINING' || CLIENT_TRANSITIONS[from].includes(to);
}

const PHASE_TRANSITIONS: Record<RoomPhase, readonly RoomPhase[]> = {
  LOBBY: ['COUNTDOWN'],
  COUNTDOWN: ['RACING', 'LOBBY'], // back to LOBBY if racers drop out
  RACING: ['RESULTS'],
  RESULTS: ['COUNTDOWN', 'LOBBY'], // race again / draw new horse
};

export function canPhaseTransition(from: RoomPhase, to: RoomPhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}
