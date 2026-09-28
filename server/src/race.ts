import { RACE, type HorseTick, type PlayerId, type RaceEvent, type RaceResult, type RaceTick } from '@bah/shared';

interface HorseState {
  id: PlayerId;
  nickname: string;
  pos: number;
  vel: number;
  boost: number;
  fatigue: number;
  noise: number;
  noiseTarget: number;
  nextNoiseAt: number;
  lastPressAt: number;
  finishMs: number | null;
  effect: { kind: EffectKind; label: string; until: number } | null;
}

type EffectKind = 'stumble' | 'zoomies' | 'confused';

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
    rng: () => number = Math.random,
  ) {
    this.rng = rng;
    this.horses = racers.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      pos: 0,
      vel: 0,
      boost: 0,
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
      const resting = now - h.lastPressAt > 400;
      const recovery = resting ? RACE.fatigueRestRecoveryPerSec : RACE.fatigueRecoveryPerSec;
      h.fatigue = Math.max(0, h.fatigue - recovery * dt);

      if (now >= h.nextNoiseAt) {
        h.noiseTarget = (this.rng() * 2 - 1) * RACE.noiseAmplitude;
        h.nextNoiseAt = now + RACE.noiseRerollMs * (0.6 + this.rng() * 0.8);
      }
      h.noise += (h.noiseTarget - h.noise) * Math.min(1, dt * 3);

      if (h.effect && now >= h.effect.until) h.effect = null;
      // Random events: identical odds for every horse, none in the first 1.5s.
      if (!h.effect && elapsed > 1500 && this.rng() < RACE.eventChancePerSec * dt) {
        const e = EFFECTS[Math.floor(this.rng() * EFFECTS.length)];
        h.effect = { kind: e.kind, label: e.label, until: now + e.durationMs };
        const text = e.texts[Math.floor(this.rng() * e.texts.length)].replace('{n}', h.nickname);
        this.onEvent({ playerId: h.id, text, t: now });
      }

      let target =
        RACE.baseSpeed + h.boost * RACE.boostSpeed + h.noise - h.fatigue ** 1.5 * RACE.fatiguePenalty; // gentle when a bit tired, harsh when exhausted
      if (h.effect) target = EFFECT_SPEED[h.effect.kind](target);
      target = Math.max(RACE.minSpeed, target);

      h.vel += (target - h.vel) * Math.min(1, dt * RACE.acceleration);
      const prev = h.pos;
      h.pos += h.vel * dt;

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
