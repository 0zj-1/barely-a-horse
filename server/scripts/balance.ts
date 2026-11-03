/**
 * Offline balance check: how long each way of playing takes over the 100m,
 * including obstacles. Run after changing anything in RACE (shared/src/config.ts).
 *   npm run balance -w server
 */
import { POSE_CLEARS, RACE, type Pose } from '@bah/shared';
import { BotDriver } from '../src/bots';
import { RaceSim, makeObstacles } from '../src/race';

type Player = { taps: number; voice: (t: number) => number; poseSkill: number | null };
const PLAYERS: Record<string, Player> = {
  'tap+keys perfect   ': { taps: 5, voice: () => 0, poseSkill: 1 },
  'tap+keys sloppy 60%': { taps: 5, voice: () => 0, poseSkill: 0.6 },
  'tap only, no poses ': { taps: 5, voice: () => 0, poseSkill: 0 },
  'voice bursts +poses': { taps: 0, voice: (t) => (t % 3 < 2 ? 1 : 0), poseSkill: 1 },
  'bot (BotDriver)    ': { taps: -1, voice: () => 0, poseSkill: null },
};

for (const [name, p] of Object.entries(PLAYERS)) {
  const times: number[] = [];
  let hits = 0;
  for (let run = 0; run < 40; run++) {
    const obstacles = makeObstacles();
    const sim = new RaceSim([{ id: 'a', nickname: 'a' }], 0, () => hits++, obstacles);
    const bots = p.taps === -1 ? new BotDriver(['a']) : null;
    let now = 0, nextPress = 0, decidedFor = -1, willPose = false;
    while (sim.step(now, 0.05) && now < 60000) {
      now += 50;
      const t = now / 1000;
      if (bots) bots.update(now, sim);
      else {
        while (p.taps > 0 && nextPress <= now) { sim.press('a', nextPress); nextPress += 1000 / p.taps; }
        if (p.taps === 0) nextPress = now;
        sim.shout('a', p.voice(t), now);
        const h = sim.horses[0];
        const ob = obstacles[h.nextObstacle];
        if (ob && p.poseSkill !== null && ob.at - h.pos < Math.max(4, h.vel * 1.1)) {
          // Decide once per obstacle, like a player does — not afresh every tick.
          if (decidedFor !== h.nextObstacle) {
            decidedFor = h.nextObstacle;
            willPose = Math.random() < p.poseSkill;
          }
          if (willPose) sim.setPose('a', POSE_CLEARS[ob.kind][0], now);
        }
      }
    }
    times.push(sim.results()[0].timeMs ?? 99999);
  }
  const avg = times.reduce((a, b) => a + b) / times.length / 1000;
  console.log(name, 'avg', avg.toFixed(2), ' crashes/race', (hits / 40).toFixed(1), `(of ${RACE.obstacleCount})`);
}
