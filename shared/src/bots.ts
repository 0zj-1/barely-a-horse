import { DRAWING } from './config';
import type { Drawing, Stroke } from './types';

export const BOT_NAMES = [
  'Bot Bessie',
  'Neigh-tron',
  'Hoofbot 9000',
  'Clippy Clop',
  'Robo Trot',
  'Unit 734',
  'Sir Glitchalot',
  'Mr. Hay.exe',
  'Gallopatron',
  'Horse.jpg',
];

/**
 * A procedurally scribbled horse for bot players: wobbly polylines, a random
 * number of legs, questionable neck. Deliberately as bad as a human's.
 */
export function botDrawing(rng: () => number = Math.random): Drawing {
  const r = (a: number, b: number) => a + rng() * (b - a);
  const j = (amt: number) => (rng() - 0.5) * 2 * amt;
  const clampX = (x: number) => Math.min(DRAWING.width - 5, Math.max(5, x));
  const clampY = (y: number) => Math.min(DRAWING.height - 5, Math.max(5, y));
  const size = Math.round(r(4, 10));
  const line = (pts: number[][], s = size): Stroke => ({
    size: s,
    points: pts.flatMap(([x, y]) => [clampX(x + j(6)), clampY(y + j(6))]),
  });

  const cx = r(230, 290);
  const cy = r(170, 210);
  const rx = r(80, 150);
  const ry = r(28, 60);

  // body: a lumpy loop
  const body: number[][] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = i === n ? 1 : r(0.85, 1.15);
    body.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  body[n] = body[0];

  const strokes: Stroke[] = [line(body)];

  // legs: usually four. usually.
  const legCount = [4, 4, 4, 4, 3, 5, 6, 2][Math.floor(rng() * 8)];
  const legLen = r(70, 150);
  for (let i = 0; i < legCount; i++) {
    const t = legCount === 1 ? 0.5 : i / (legCount - 1);
    const x = cx - rx * 0.75 + t * rx * 1.5 + j(10);
    const top = cy + ry * 0.7;
    const knee = [x + j(25), top + legLen * r(0.4, 0.6)];
    strokes.push(line([[x, top], knee, [knee[0] + j(20), top + legLen]]));
  }

  // neck + head
  const nx = cx + rx * 0.8;
  const ny = cy - ry * 0.3;
  const hx = nx + r(30, 90);
  const hy = ny - r(50, 130);
  strokes.push(line([[nx, ny], [(nx + hx) / 2 + j(15), (ny + hy) / 2], [hx, hy]]));
  const hl = r(35, 70);
  strokes.push(line([[hx - 10, hy - 10], [hx + hl, hy + j(10)], [hx + hl + j(8), hy + r(15, 30)], [hx, hy + 15]]));
  strokes.push(line([[hx + 5, hy - 8], [hx + j(8), hy - r(20, 40)]])); // ear
  if (rng() < 0.8) {
    const ex = hx + hl * 0.5, ey = hy + 2;
    strokes.push({ size: Math.round(r(6, 12)), points: [clampX(ex), clampY(ey), clampX(ex), clampY(ey)] });
  }

  // tail
  const tx = cx - rx;
  strokes.push(line([[tx, cy - ry * 0.2], [tx - r(20, 50), cy + j(20)], [tx - r(30, 70), cy + r(30, 80)]]));

  return { strokes };
}
