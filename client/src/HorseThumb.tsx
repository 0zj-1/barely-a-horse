import { useEffect, useRef } from 'react';
import type { Drawing } from '@bah/shared';
import { drawHorse } from './render/horse';

/** Static (optionally wiggling) preview of a player's drawing. */
export function HorseThumb({ drawing, w = 90, h = 60, wiggle = false }: { drawing?: Drawing; w?: number; h?: number; wiggle?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    const paint = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (drawing) {
        drawHorse(ctx, drawing, w / 2, h / 2, w - 8, h - 8, wiggle ? { phase: t / 160, intensity: 0.8, time: t } : undefined);
      }
      if (wiggle) raf = requestAnimationFrame(paint);
    };
    paint(0);
    return () => cancelAnimationFrame(raf);
  }, [drawing, w, h, wiggle]);
  return <canvas ref={ref} className="thumb" style={{ width: w, height: h }} />;
}
