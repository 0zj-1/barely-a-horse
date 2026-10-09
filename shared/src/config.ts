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

  // --- voice input: shouting is a second, independent way to push the horse ---
  // Shouting feeds the same push as tapping (boostSpeed), so neither input dominates.
  /** How fast the server-side voice level follows the mic, per second. */
  voiceAttackPerSec: 5.0,
  voiceReleasePerSec: 2.5,
  /** No shout updates for this long = the player went quiet. */
  voiceTimeoutMs: 450,
  /** Minimum gap between accepted shout updates. */
  minShoutIntervalMs: 50,
  /** Tapping and shouting combine as max() + this much of the smaller one. */
  comboBonus: 0.45,
  /** Hard cap on the combined push. */
  maxDrive: 1.3,
  /** Shouting tires the horse too: at full volume, this much fatigue per second. */
  fatigueVoicePerSec: 0.04,
  /** ...and the longer you keep shouting without a breath, the worse it gets. */
  fatigueVoiceHoldPerSec: 0.5,
  /** Below this the horse counts as "not being shouted at" for recovery. */
  voiceRestLevel: 0.2,

  // --- poses: your voice decides what the horse does ---
  /** Below this there isn't enough voice to read a pitch from. */
  poseQuietLevel: 0.14,
  /** Loud = jump. */
  poseJumpLevel: 0.55,
  /** Very loud = big jump. */
  poseBigJumpLevel: 0.82,
  /** Dropping to this fraction of your own normal pitch crouches the horse. */
  lowPitchRatio: 0.8,
  /** Fallback when we haven't learnt the player's normal pitch yet (Hz). */
  lowPitchHz: 130,
  /** Crouching and jumping cost a little speed, whatever controls you use. */
  poseSpeedFactor: { RUN: 1, DUCK: 0.92, JUMP: 0.97, BIGJUMP: 0.93 } as Record<string, number>,
  /** Keyboard/touch poses expire if the client stops refreshing them. */
  poseHoldMs: 900,

  // --- obstacles ---
  obstacleCount: 7,
  /** No obstacles before this or after RACE.distance - obstacleEndGap. */
  obstacleStartAt: 16,
  obstacleEndGap: 10,
  obstacleMinGap: 8,
  /** Hitting one: speed multiplier and how long it lasts. */
  hitSpeedFactor: 0.4,
  hitDurationMs: 900,
  hitFatigue: 0.04,

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

/**
 * The one place that turns a voice into a pose, so the server and the
 * on-screen mic check always agree.
 */
export function poseForVoice(level: number, pitchHz = 0, pitchBase = 0): import('./types').Pose {
  if (level >= RACE.poseBigJumpLevel) return 'BIGJUMP';
  if (level >= RACE.poseJumpLevel) return 'JUMP';
  // Quiet is just running (with no push behind it) — only a deep voice crouches,
  // measured against the player's own normal pitch so deep voices aren't stuck down there.
  if (pitchHz > 0 && level >= RACE.poseQuietLevel) {
    const threshold = pitchBase > 0 ? pitchBase * RACE.lowPitchRatio : RACE.lowPitchHz;
    if (pitchHz < threshold) return 'DUCK';
  }
  return 'RUN';
}

/** Which poses get a horse past which obstacle. A big jump also clears a hurdle. */
export const POSE_CLEARS: Record<import('./types').ObstacleKind, readonly import('./types').Pose[]> = {
  DUCK: ['DUCK'],
  JUMP: ['JUMP', 'BIGJUMP'],
  BIGJUMP: ['BIGJUMP'],
};

export const OBSTACLE_LABEL: Record<import('./types').ObstacleKind, string> = {
  DUCK: 'DUCK',
  JUMP: 'JUMP',
  BIGJUMP: 'BIG JUMP',
};
