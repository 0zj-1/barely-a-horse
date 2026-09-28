import { drawingBBox, fitTransform, type BBox, type Drawing, type Stroke } from '@bah/shared';

export const INK = '#111';

/** Draws strokes exactly as recorded: straight segments, round caps. No smoothing. */
export function strokePath(ctx: CanvasRenderingContext2D, s: Stroke, lineWidth: number) {
  const p = s.points;
  ctx.lineWidth = lineWidth;
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
  ctx.stroke();
}

interface Prepared {
  bbox: BBox;
}
const cache = new WeakMap<Drawing, Prepared | null>();
function prepare(d: Drawing): Prepared | null {
  if (!cache.has(d)) {
    const bbox = drawingBBox(d);
    cache.set(d, bbox ? { bbox } : null);
  }
  return cache.get(d)!;
}

export interface HorseAnim {
  /** Gait phase in radians. */
  phase: number;
  /** 0 = standing, 1 = full gallop. */
  intensity: number;
  /** Extra chaos from a race effect. */
  effect?: string | null;
  time?: number;
}

/**
 * Render a drawing into a (w x h) box centered at (cx, cy).
 * Normalization is a uniform scale, so proportions and ugliness are preserved.
 * Animation is layered on top: bounce, tilt, squash/stretch, and a sway of the
 * lower part of the drawing (where the legs probably are).
 */
export function drawHorse(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  cx: number,
  cy: number,
  w: number,
  h: number,
  anim: HorseAnim = { phase: 0, intensity: 0 },
) {
  const prep = prepare(d);
  if (!prep) return;
  const { bbox } = prep;
  const fit = fitTransform(bbox, w, h);
  const bw = bbox.maxX - bbox.minX || 1;
  const bh = bbox.maxY - bbox.minY || 1;

  const k = anim.intensity;
  const ph = anim.phase;
  let bounce = -Math.abs(Math.sin(ph)) * h * 0.1 * k;
  let rot = Math.sin(ph) * 0.07 * k;
  const stretch = 1 + Math.sin(ph * 2) * 0.07 * k;
  let legAmp = bw * 0.09 * k;
  let shakeX = 0;

  const t = anim.time ?? 0;
  if (anim.effect === 'STUMBLE') {
    rot += 0.45 + Math.sin(t / 60) * 0.1;
    bounce += h * 0.08;
  } else if (anim.effect === 'ZOOMIES') {
    shakeX = Math.sin(t / 25) * w * 0.02;
    legAmp *= 1.8;
    rot -= 0.12;
  } else if (anim.effect === '???') {
    rot += Math.sin(t / 150) * 0.35;
    legAmp *= 0.3;
  }

  ctx.save();
  ctx.translate(cx + shakeX, cy + h / 2 + bounce); // pivot at the feet
  ctx.rotate(rot);
  ctx.scale(fit.scale * stretch, fit.scale / stretch);
  ctx.translate(fit.ox, fit.oy - bh / 2);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const minWidth = 0.9 / fit.scale;

  for (const s of d.strokes) {
    const lw = Math.max(minWidth, s.size);
    if (legAmp < 0.01) {
      strokePath(ctx, s, lw);
      continue;
    }
    // Leg wobble: points in the bottom 45% sway back and forth, more the lower they are.
    // Alternating direction across the width makes front/back "legs" move opposite.
    const p = s.points;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) {
      const nx = (p[i] - bbox.minX) / bw;
      const ny = (p[i + 1] - bbox.minY) / bh;
      const legness = Math.max(0, (ny - 0.55) / 0.45);
      const dx = legness * legness * legAmp * Math.sin(ph * 2 + (nx > 0.5 ? Math.PI : 0) + nx * 2);
      const x = p[i] + dx;
      if (i === 0) ctx.moveTo(x, p[i + 1]);
      else ctx.lineTo(x, p[i + 1]);
    }
    if (p.length === 2) {
      ctx.arc(p[0], p[1], lw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.stroke();
  }
  ctx.restore();
}
