import {
  OBSTACLE_LABEL,
  POSE_CLEARS,
  RACE,
  poseForVoice,
  type HorseTick,
  type Obstacle,
  type ObstacleKind,
  type PlayerId,
  type Pose,
  type RaceEvent,
  type RaceResult,
  type RaceTick,
} from '@bah/shared';

/** Obstacle layout for one race: the same in every lane, so nobody gets an easier run. */
export function makeObstacles(rng: () => number = Math.random): Obstacle[] {
  const kinds: ObstacleKind[] = ['DUCK', 'JUMP', 'BIGJUMP'];
  const last = RACE.distance - RACE.obstacleEndGap;
  const span = last - RACE.obstacleStartAt;
  const obstacles: Obstacle[] = [];
  for (let i = 0; i < RACE.obstacleCount; i++) {
    // Evenly spread, then jittered, so every race feels a bit different.
    const slot = RACE.obstacleStartAt + (span * i) / Math.max(1, RACE.obstacleCount - 1);
    const at = Math.max(RACE.obstacleStartAt, Math.min(last, slot + (rng() - 0.5) * RACE.obstacleMinGap));
    obstacles.push({ at: Math.round(at * 10) / 10, kind: kinds[Math.floor(rng() * kinds.length)] });
  }
  return obstacles.sort((a, b) => a.at - b.at);
}

interface HorseState {
  id: PlayerId;
  nickname: string;
  pos: number;
  vel: number;
  boost: number;
  /** Smoothed shout level, 0..1. */
  voice: number;
  /** Last level the player reported. */
  voiceTarget: number;
  lastShoutAt: number;
  /** Pitch of the player's voice, and their normal speaking pitch, in Hz (0 = unknown). */
  pitchHz: number;
  pitchBase: number;
  pose: Pose;
  /** Pose from the keyboard/touch fallback, and when it was last refreshed. */
  manualPose: Pose | null;
  manualPoseAt: number;
  /** Index of the next obstacle this horse has to deal with. */
  nextObstacle: number;
  /** When each pose was last held, for the "you jumped early" window. */
  poseSeenAt: Record<Pose, number>;
  /** An obstacle already passed, still waiting to see a late pose. */
  pending: { kind: ObstacleKind; deadline: number } | null;
  /** Seconds of uninterrupted shouting (resets when you take a breath). */
  shoutHeldFor: number;
  fatigue: number;
  noise: number;
  noiseTarget: number;
  nextNoiseAt: number;
  lastPressAt: number;
  finishMs: number | null;
  effect: { kind: EffectKind; label: string; until: number } | null;
}

type EffectKind = 'stumble' | 'zoomies' | 'confused' | 'crash' | 'clear';

const EFFECTS: { kind: EffectKind; label: string; durationMs: number; texts: string[] }[] = [
  {
    kind: 'stumble',
    label: 'STUMBLE',
    durationMs: 900,
    texts: ["{n}'s horse briefly forgot how legs work", '{n} tripped over nothing', "{n}'s horse remembered something embarrassing"],
  },
  {
    kind: 'zoomies',
    label: 'ZOOMIES',
    durationMs: 1100,
    texts: ['{n} got the zoomies', "{n}'s horse smelled a carrot", '{n} is suddenly very motivated'],
  },
  {
    kind: 'confused',
    label: '???',
    durationMs: 1300,
    texts: ["{n}'s horse is having an existential moment", '{n} is questioning the concept of racing', "{n}'s horse waved at the crowd"],
  },
];

const EFFECT_SPEED: Record<EffectKind, (v: number) => number> = {
  crash: (v) => v * RACE.hitSpeedFactor,
  clear: (v) => v, // just a label, no speed change
  stumble: (v) => v * 0.35,
  zoomies: (v) => v + 2.2,
  confused: (v) => v * 0.7,
};

/**
 * Server-authoritative race simulation. Clients only ever call `press()`.
 * Every horse gets the same base speed and the same random distributions;
 * the drawing plays no part in any of this.
 */
export class RaceSim {
  readonly horses: HorseState[];
  private finishedOrder: PlayerId[] = [];
  private rng: () => number;

  constructor(
    racers: { id: PlayerId; nickname: string }[],
    readonly startAt: number,
    private onEvent: (e: RaceEvent) => void,
    readonly obstacles: Obstacle[] = [],
    rng: () => number = Math.random,
  ) {
    this.rng = rng;
    this.horses = racers.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      pos: 0,
      vel: 0,
      boost: 0,
      voice: 0,
      voiceTarget: 0,
      lastShoutAt: -Infinity,
      pitchHz: 0,
      pitchBase: 0,
      pose: 'RUN',
      manualPose: null,
      manualPoseAt: -Infinity,
      nextObstacle: 0,
      poseSeenAt: { RUN: 0, DUCK: 0, JUMP: 0, BIGJUMP: 0 },
      pending: null,
      shoutHeldFor: 0,
      fatigue: 0,
      noise: 0,
      noiseTarget: 0,
      nextNoiseAt: 0,
      lastPressAt: -Infinity,
      finishMs: null,
      effect: null,
    }));
  }

  press(id: PlayerId, now: number) {
    const h = this.horses.find((x) => x.id === id);
    if (!h || h.finishMs !== null || now < this.startAt) return;
    if (now - h.lastPressAt < RACE.minPressIntervalMs) return;
    h.lastPressAt = now;
    const overflow = Math.max(0, h.boost + RACE.boostPerPress - 1);
    h.boost = Math.min(1, h.boost + RACE.boostPerPress);
    // Fatigue always grows a bit per press, and grows much more when the boost was already
    // full — so mashing as fast as possible is worse than keeping a rhythm.
    h.fatigue = Math.min(1, h.fatigue + RACE.fatiguePerPress + (overflow / RACE.boostPerPress) * RACE.fatigueOverflowPerPress);
  }

  /** The pose this horse should hold, from the voice (or the fallback controls). */
  private poseFor(h: HorseState, now: number): Pose {
    if (h.manualPose && now - h.manualPoseAt < RACE.poseHoldMs) return h.manualPose;
    if (now - h.lastShoutAt > RACE.voiceTimeoutMs) return 'RUN'; // no mic, no pose control
    // Poses read the level the mic just reported, not the smoothed one the speed uses:
    // waiting for the smoothing would put the jump a few metres late.
    return poseForVoice(h.voiceTarget, h.pitchHz, h.pitchBase);
  }

  private faceplant(h: HorseState, kind: ObstacleKind, now: number) {
    h.pending = null;
    h.effect = { kind: 'crash', label: 'OOF', until: now + RACE.hitDurationMs };
    h.fatigue = Math.min(1, h.fatigue + RACE.hitFatigue);
    h.vel *= RACE.hitSpeedFactor;
    this.onEvent({
      playerId: h.id,
      text: `${h.nickname} forgot to ${OBSTACLE_LABEL[kind].toLowerCase()}`,
      t: now,
    });
  }

  /** Keyboard / touch pose control, for players without a microphone. */
  setPose(id: PlayerId, pose: Pose, now: number) {
    const h = this.horses.find((x) => x.id === id);
    if (!h || h.finishMs !== null) return;
    h.manualPose = pose;
    h.manualPoseAt = now;
  }

  /** A player's microphone reported how loud they are. */
  shout(id: PlayerId, level: number, now: number, pitchHz = 0, pitchBase = 0) {
    const h = this.horses.find((x) => x.id === id);
    if (!h || h.finishMs !== null || now < this.startAt) return;
    if (now - h.lastShoutAt < RACE.minShoutIntervalMs) return;
    // Out-of-range values are rejected, not clamped: clamping would hand anyone
    // sending `level: 999` a permanent full-volume boost.
    if (!(typeof level === 'number' && level >= 0 && level <= 1)) return;
    h.lastShoutAt = now;
    h.voiceTarget = level;
    if (typeof pitchHz === 'number' && pitchHz >= 0 && pitchHz < 2000) h.pitchHz = pitchHz;
    if (typeof pitchBase === 'number' && pitchBase >= 0 && pitchBase < 2000) h.pitchBase = pitchBase;
  }

  /** Advance simulation to `now`. Returns true while the race is still running. */
  step(now: number, dt: number): boolean {
    const elapsed = now - this.startAt;
    if (elapsed < 0) return true;

    for (const h of this.horses) {
      if (h.finishMs !== null) {
        h.vel *= Math.max(0, 1 - dt * 2); // trot to a stop past the line
        h.pos += h.vel * dt;
        continue;
      }

      h.boost = Math.max(0, h.boost - RACE.boostDecayPerSec * dt);

      // Voice: follow the reported level, and fall silent if updates stop.
      if (now - h.lastShoutAt > RACE.voiceTimeoutMs) h.voiceTarget = 0;
      const voiceRate = h.voiceTarget > h.voice ? RACE.voiceAttackPerSec : RACE.voiceReleasePerSec;
      h.voice += Math.max(-voiceRate * dt, Math.min(voiceRate * dt, h.voiceTarget - h.voice));
      h.voice = Math.min(1, Math.max(0, h.voice));
      // Shouting tires the horse, and holding one long scream tires it faster:
      // taking a breath between shouts beats screaming the whole way.
      if (h.voice >= RACE.voiceRestLevel) h.shoutHeldFor += dt;
      else h.shoutHeldFor = 0;
      const hold = 1 + h.shoutHeldFor * RACE.fatigueVoiceHoldPerSec;
      h.fatigue = Math.min(1, h.fatigue + RACE.fatigueVoicePerSec * h.voice ** 2 * hold * dt);

      const resting = now - h.lastPressAt > 400 && h.voice < RACE.voiceRestLevel;
      const recovery = resting ? RACE.fatigueRestRecoveryPerSec : RACE.fatigueRecoveryPerSec;
      h.fatigue = Math.max(0, h.fatigue - recovery * dt);

      if (now >= h.nextNoiseAt) {
        h.noiseTarget = (this.rng() * 2 - 1) * RACE.noiseAmplitude;
        h.nextNoiseAt = now + RACE.noiseRerollMs * (0.6 + this.rng() * 0.8);
      }
      h.noise += (h.noiseTarget - h.noise) * Math.min(1, dt * 3);

      h.pose = this.poseFor(h, now);
      h.poseSeenAt[h.pose] = now;

      if (h.effect && now >= h.effect.until) h.effect = null;
      // Random events: identical odds for every horse, none in the first 1.5s.
      if (!h.effect && elapsed > 1500 && this.rng() < RACE.eventChancePerSec * dt) {
        const e = EFFECTS[Math.floor(this.rng() * EFFECTS.length)];
        h.effect = { kind: e.kind, label: e.label, until: now + e.durationMs };
        const text = e.texts[Math.floor(this.rng() * e.texts.length)].replace('{n}', h.nickname);
        this.onEvent({ playerId: h.id, text, t: now });
      }

      // Tapping and shouting are alternatives, not additives: take the stronger one
      // plus a small bonus for doing both, so neither input makes the other pointless.
      const drive = Math.min(
        RACE.maxDrive,
        Math.max(h.boost, h.voice) + RACE.comboBonus * Math.min(h.boost, h.voice),
      );
      let target =
        RACE.baseSpeed + drive * RACE.boostSpeed + h.noise - h.fatigue ** 1.5 * RACE.fatiguePenalty; // gentle when a bit tired, harsh when exhausted
      target *= RACE.poseSpeedFactor[h.pose] ?? 1;
      if (h.effect) target = EFFECT_SPEED[h.effect.kind](target);
      target = Math.max(RACE.minSpeed, target);

      h.vel += (target - h.vel) * Math.min(1, dt * RACE.acceleration);
      const prev = h.pos;
      h.pos += h.vel * dt;

      // Obstacles: reaching one with the right pose clears it. Posing a moment early
      // counts too, and a pose that lands just after still saves the horse — both sides
      // are forgiving because the player is reacting to a screen that lags the server.
      while (h.nextObstacle < this.obstacles.length && h.pos >= this.obstacles[h.nextObstacle].at) {
        const ob = this.obstacles[h.nextObstacle++];
        if (h.pending) this.faceplant(h, h.pending.kind, now); // never got the last one
        const clears = POSE_CLEARS[ob.kind];
        const early = clears.some((p) => now - h.poseSeenAt[p] <= RACE.poseEarlyMs);
        if (early) {
          h.effect = { kind: 'clear', label: 'YEP', until: now + 450 };
        } else {
          h.pending = { kind: ob.kind, deadline: now + RACE.poseGraceMs };
        }
      }

      if (h.pending) {
        if (POSE_CLEARS[h.pending.kind].includes(h.pose)) {
          h.pending = null;
          h.effect = { kind: 'clear', label: 'PHEW', until: now + 450 };
        } else if (now >= h.pending.deadline) {
          this.faceplant(h, h.pending.kind, now);
        }
      }

      if (h.pos >= RACE.distance) {
        // Interpolate the exact crossing moment inside this tick.
        const frac = h.vel > 0 ? (RACE.distance - prev) / (h.pos - prev) : 1;
        h.finishMs = Math.round(elapsed - dt * 1000 * (1 - frac));
        this.finishedOrder.push(h.id);
      }
    }

    const allDone = this.horses.every((h) => h.finishMs !== null);
    return !allDone && elapsed < RACE.maxDurationMs;
  }

  get allFinished() {
    return this.horses.every((h) => h.finishMs !== null);
  }

  tick(now: number): RaceTick {
    return {
      t: now,
      elapsed: Math.max(0, now - this.startAt),
      horses: this.horses.map(
        (h): HorseTick => ({
          id: h.id,
          pos: round2(h.pos),
          vel: round2(h.vel),
          boost: round2(h.boost),
          voice: round2(h.voice),
          pose: h.pose,
          fatigue: round2(h.fatigue),
          finished: h.finishMs !== null,
          effect: h.effect?.label ?? null,
        }),
      ),
    };
  }

  results(): RaceResult[] {
    const finished = this.horses
      .filter((h) => h.finishMs !== null)
      .sort((a, b) => a.finishMs! - b.finishMs!);
    const dnf = this.horses.filter((h) => h.finishMs === null).sort((a, b) => b.pos - a.pos);
    return [...finished, ...dnf].map((h, i) => ({
      playerId: h.id,
      nickname: h.nickname,
      timeMs: h.finishMs,
      place: i + 1,
    }));
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;
