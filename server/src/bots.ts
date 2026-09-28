import type { PlayerId } from '@bah/shared';
import type { RaceSim } from './race';

interface Brain {
  id: PlayerId;
  /** Preferred presses per second: some bots are calm, some are mashers. */
  rate: number;
  nextPressAt: number;
  /** Bots occasionally take a breather, or panic-mash for a second. */
  moodUntil: number;
  mood: 'normal' | 'rest' | 'panic';
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
    }));
  }

  update(now: number, race: RaceSim) {
    if (now < race.startAt) return;
    for (const b of this.brains) {
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
