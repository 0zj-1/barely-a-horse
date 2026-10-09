import { POSE_CLEARS, type ObstacleKind, type PlayerId, type Pose } from '@bah/shared';
import type { RaceSim } from './race';

interface Brain {
  id: PlayerId;
  /** Preferred presses per second: some bots are calm, some are mashers. */
  rate: number;
  nextPressAt: number;
  /** Bots occasionally take a breather, or panic-mash for a second. */
  moodUntil: number;
  mood: 'normal' | 'rest' | 'panic';
  /** How often this bot gets an obstacle right. */
  skill: number;
  /** Obstacle index it has already made up its mind about, and whether it will clear it. */
  decidedFor: number;
  willClear: boolean;
}

/** Drives bot racers by pressing GIDDY UP through the same path humans use. */
export class BotDriver {
  private brains: Brain[];

  constructor(ids: PlayerId[], private rng: () => number = Math.random) {
    this.brains = ids.map((id) => ({
      id,
      rate: 2.5 + rng() * 4.5, // 2.5–7/s: the best human rhythm is ~4–6/s
      nextPressAt: 0,
      moodUntil: 0,
      mood: 'normal',
      skill: 0.6 + rng() * 0.35, // 60-95%: good, but beatable
      decidedFor: -1,
      willClear: false,
    }));
  }

  /** Bots "see" the obstacle ahead and (usually) strike the right pose in time. */
  private handleObstacles(now: number, race: RaceSim, b: Brain) {
    const h = race.horses.find((x) => x.id === b.id);
    if (!h || h.finishMs !== null) return;
    const ob = race.obstacles[h.nextObstacle];
    if (!ob) return;
    const distance = ob.at - h.pos;
    // Start posing about a second out, which is roughly a horse length or two.
    if (distance > Math.max(4, h.vel * 1.1)) return;
    if (b.decidedFor !== h.nextObstacle) {
      b.decidedFor = h.nextObstacle;
      b.willClear = this.rng() < b.skill;
    }
    const pose: Pose = b.willClear ? POSE_CLEARS[ob.kind as ObstacleKind][0] : 'RUN';
    race.setPose(b.id, pose, now);
  }

  update(now: number, race: RaceSim) {
    if (now < race.startAt) return;
    for (const b of this.brains) {
      this.handleObstacles(now, race, b);
      if (now >= b.moodUntil) {
        const roll = this.rng();
        b.mood = roll < 0.15 ? 'rest' : roll < 0.25 ? 'panic' : 'normal';
        b.moodUntil = now + (b.mood === 'normal' ? 2000 + this.rng() * 3000 : 600 + this.rng() * 900);
      }
      if (b.mood === 'rest' || now < b.nextPressAt) continue;
      race.press(b.id, now);
      const rate = b.mood === 'panic' ? 12 : b.rate;
      b.nextPressAt = now + (1000 / rate) * (0.75 + this.rng() * 0.5);
    }
  }
}
