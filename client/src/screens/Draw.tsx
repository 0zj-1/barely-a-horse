import { useEffect, useRef, useState } from 'react';
import { DRAWING, type Stroke } from '@bah/shared';
import { INK, strokePath } from '../render/horse';
import { submitDrawing, useStore } from '../store';
import { PlayerList, RoomHeader } from './Lobby';

const PROMPTS = [
  'draw a horse. any horse.',
  'a horse. you know what a horse is.',
  'four legs is a suggestion.',
  'it only has to be barely a horse.',
];
const MIN_DIST = 1.5;

export function Draw() {
  const { room } = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const [brush, setBrush] = useState(8);
  const [count, setCount] = useState(0); // re-render trigger for button states
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / DRAWING.width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, DRAWING.width, DRAWING.height);
    // ground hint + direction arrow
    ctx.strokeStyle = '#dde6d0';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, DRAWING.height - 40);
    ctx.lineTo(DRAWING.width, DRAWING.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b9c7a8';
    ctx.font = '13px ui-monospace, Menlo, monospace';
    ctx.fillText('runs this way →', DRAWING.width - 140, DRAWING.height - 16);

    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes.current) strokePath(ctx, s, s.size);
    if (current.current) strokePath(ctx, current.current, current.current.size);
  };

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = DRAWING.width * dpr;
    c.height = DRAWING.height * dpr;
    redraw();
  }, []);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * DRAWING.width,
      ((e.clientY - r.top) / r.height) * DRAWING.height,
    ] as const;
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const [x, y] = toLocal(e);
    current.current = { size: brush, points: [x, y] };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    const s = current.current;
    if (!s) return;
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e.nativeEvent]; // some browsers return []
    for (const ev of events) {
      const [x, y] = toLocal(ev);
      const px = s.points[s.points.length - 2], py = s.points[s.points.length - 1];
      if (Math.hypot(x - px, y - py) < MIN_DIST) continue;
      s.points.push(x, y);
    }
    redraw();
  };
  const up = () => {
    const s = current.current;
    if (!s) return;
    current.current = null;
    strokes.current.push(s);
    setCount(strokes.current.length);
    redraw();
  };

  const undo = () => {
    strokes.current.pop();
    setCount(strokes.current.length);
    redraw();
  };
  const clear = () => {
    strokes.current = [];
    setCount(0);
    redraw();
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const e = await submitDrawing({ strokes: strokes.current });
    setBusy(false);
    if (e) setErr(e);
  };

  const racing = room && room.phase !== 'LOBBY';
  const totalPoints = strokes.current.reduce((s, x) => s + x.points.length / 2, 0);

  return (
    <div className="page">
      <RoomHeader />
      <div className="draw-layout">
        <div className="draw-main">
          <p className="prompt">{prompt}</p>
          {racing && <p className="hint">(a race is on. your horse joins the next one.)</p>}
          <canvas
            ref={canvasRef}
            className="pad"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          <div className="tools">
            <label className="brush">
              brush
              <input type="range" min={DRAWING.minBrush} max={DRAWING.maxBrush} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
              <span className="dot" style={{ width: brush, height: brush }} />
            </label>
            <button onClick={undo} disabled={!count}>
              undo
            </button>
            <button onClick={clear} disabled={!count}>
              clear
            </button>
          </div>
          {totalPoints > DRAWING.maxTotalPoints && <p className="error">that's a lot of horse. try undoing a bit.</p>}
          <button className="big primary" disabled={!count || busy} onClick={submit}>
            [ THIS IS MY HORSE ]
          </button>
          {err && <p className="error">{err}</p>}
        </div>
        <PlayerList compact />
      </div>
    </div>
  );
}
