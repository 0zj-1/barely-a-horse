export type PlayerId = string;

/** A single brush stroke, in drawing-pad coordinates (DRAWING.width x DRAWING.height). */
export interface Stroke {
  size: number;
  /** Flat list: x0, y0, x1, y1, ... */
  points: number[];
}

export interface Drawing {
  strokes: Stroke[];
}

/** WAITING = in room, hasn't started drawing. */
export type PlayerStatus = 'WAITING' | 'DRAWING' | 'READY';

export interface PlayerPublic {
  id: PlayerId;
  nickname: string;
  status: PlayerStatus;
  connected: boolean;
  isHost: boolean;
  hasDrawing: boolean;
  /** Server-controlled filler horse. */
  isBot: boolean;
}

/** Server-side room phase. */
export type RoomPhase = 'LOBBY' | 'COUNTDOWN' | 'RACING' | 'RESULTS';

export interface RaceResult {
  playerId: PlayerId;
  nickname: string;
  /** Finish time in ms, or null for DNF. */
  timeMs: number | null;
  place: number;
}

export interface RoomSnapshot {
  code: string;
  phase: RoomPhase;
  players: PlayerPublic[];
  /** Players taking part in the current/last race (in lane order). */
  racers: PlayerId[];
  /** Server epoch ms when the race starts (COUNTDOWN / RACING). */
  raceStartAt: number | null;
  results: RaceResult[] | null;
  /** Obstacles for the current race (empty in the lobby). */
  obstacles: Obstacle[];
  /** Server clock at the time this snapshot was sent. */
  serverNow: number;
}

/** What the horse is doing right now. Driven by your voice (or the fallback keys). */
export type Pose = 'RUN' | 'DUCK' | 'JUMP' | 'BIGJUMP';

/** Obstacles sit at the same distances in every lane. */
export type ObstacleKind = 'DUCK' | 'JUMP' | 'BIGJUMP';

export interface Obstacle {
  /** Meters from the start line. */
  at: number;
  /** The pose needed to get past it. */
  kind: ObstacleKind;
}

export interface HorseTick {
  id: PlayerId;
  /** Meters from start. */
  pos: number;
  /** m/s */
  vel: number;
  boost: number; // 0..1 — from tapping
  voice: number; // 0..1 — from shouting
  pose: Pose;
  fatigue: number; // 0..1
  finished: boolean;
  /** Short-lived modifier active on this horse, if any. */
  effect: string | null;
}

export interface RaceTick {
  /** Server epoch ms. */
  t: number;
  /** ms since race start. */
  elapsed: number;
  horses: HorseTick[];
}

export interface RaceEvent {
  playerId: PlayerId;
  text: string;
  t: number;
}
