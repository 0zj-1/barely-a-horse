/** Race + room tuning. Shared so the client can show meters that match the server. */
export const ROOM = {
  codeLength: 6,
  codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // no 0/O/1/I
  minPlayers: 2,
  maxPlayers: 8,
  maxNicknameLength: 16,
  /** How long a disconnected player keeps their seat. */
  reconnectGraceMs: 60_000,
  /** Empty rooms are deleted after this. */
  emptyRoomTtlMs: 5 * 60_000,
} as const;

export const RACE = {
  distance: 100, // meters
  countdownMs: 3_000,
  tickHz: 20,
  /** Race is cut off here; unfinished horses are DNF. */
  maxDurationMs: 45_000,
  /** Pause after everybody finished before showing results. */
  resultsDelayMs: 1_800,

  baseSpeed: 6.2, // m/s — everybody gets this
  boostSpeed: 3.0, // m/s at full boost
  boostPerPress: 0.2,
  boostDecayPerSec: 0.7,
  /** Presses closer together than this are ignored (anti-autoclicker). */
  minPressIntervalMs: 60,

  fatiguePerPress: 0.005,
  /** Extra fatigue for pressing when boost is already (nearly) full — mashing is wasteful. */
  fatigueOverflowPerPress: 0.022,
  fatigueRecoveryPerSec: 0.05,
  /** Faster recovery after ~0.4s without pressing — rests are rewarded. */
  fatigueRestRecoveryPerSec: 0.22,
  fatiguePenalty: 4.0, // m/s at full fatigue

  noiseAmplitude: 0.7, // m/s
  noiseRerollMs: 700,
  acceleration: 2.6, // how fast velocity chases target speed (1/s)
  minSpeed: 1.2,

  /** Chance per horse per second of a random event. Same for everybody. */
  eventChancePerSec: 0.035,
} as const;

export const DRAWING = {
  width: 600,
  height: 400,
  maxStrokes: 400,
  maxTotalPoints: 12_000,
  minBrush: 2,
  maxBrush: 28,
} as const;
