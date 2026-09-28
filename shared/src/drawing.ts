import { DRAWING } from './config';
import type { Drawing, Stroke } from './types';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function drawingBBox(d: Drawing): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of d.strokes) {
    const r = s.size / 2;
    for (let i = 0; i < s.points.length; i += 2) {
      const x = s.points[i], y = s.points[i + 1];
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Transform that fits the drawing inside a (w x h) box, centered, keeping aspect ratio.
 * Pure scale + translate: the strokes themselves are never altered.
 */
export function fitTransform(bbox: BBox, w: number, h: number) {
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const scale = Math.min(w / bw, h / bh);
  return {
    scale,
    // maps drawing point -> box-local point centered at (0,0)
    ox: -(bbox.minX + bw / 2),
    oy: -(bbox.minY + bh / 2),
  };
}

/** Returns an error string, or null when the drawing is acceptable. */
export function validateDrawing(d: unknown): string | null {
  if (!d || typeof d !== 'object' || !Array.isArray((d as Drawing).strokes)) return 'bad drawing';
  const strokes = (d as Drawing).strokes;
  if (strokes.length === 0) return 'draw something first';
  if (strokes.length > DRAWING.maxStrokes) return 'too many strokes';
  let total = 0;
  for (const s of strokes as Stroke[]) {
    if (!s || typeof s.size !== 'number' || !Array.isArray(s.points)) return 'bad stroke';
    if (!(s.size >= DRAWING.minBrush && s.size <= DRAWING.maxBrush)) return 'bad brush size';
    if (s.points.length < 2 || s.points.length % 2 !== 0) return 'bad stroke';
    total += s.points.length / 2;
    if (total > DRAWING.maxTotalPoints) return 'drawing too detailed';
    for (const v of s.points) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -50 || v > Math.max(DRAWING.width, DRAWING.height) + 50) {
        return 'bad point';
      }
    }
  }
  return null;
}

/** Copy only the fields we know about (drops anything extra a client might send). */
export function sanitizeDrawing(d: Drawing): Drawing {
  return {
    strokes: d.strokes.map((s) => ({
      size: s.size,
      points: s.points.map((v) => Math.round(v * 10) / 10),
    })),
  };
}
