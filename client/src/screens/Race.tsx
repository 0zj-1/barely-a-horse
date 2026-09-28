import { useEffect, useRef, useState } from 'react';
import { RACE } from '@bah/shared';
import { serverNow } from '../net/socket';
import { TrackRenderer, sampleTicks, type Lane } from '../render/track';
import { getStore, giddyUp, raceBuffer, useStore } from '../store';
import { RoomHeader } from './Lobby';

const INTERP_DELAY = 110; // ms behind the server, so we always have two ticks to blend

/** COUNTDOWN and RACING share this screen. */
export function Race() {
  const { room, session, events, state } = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const windRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLSpanElement>(null);
  const [pressed, setPressed] = useState(false);

  const isRacer = !!(room && session && room.racers.includes(session.playerId));

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const renderer = new TrackRenderer(ctx);
    let raf = 0;
    let W = 0, H = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const { room, session, drawings } = getStore();
      if (!room || !session) return;
      const lanes: Lane[] = room.racers.map((id) => ({
        id,
        nickname: room.players.find((p) => p.id === id)?.nickname ?? room.results?.find((r) => r.playerId === id)?.nickname ?? '???',
        isMe: id === session.playerId,
      }));
      const now = serverNow();
      const horses = sampleTicks(raceBuffer.ticks, now - INTERP_DELAY);

      // places: finished horses by finish order, then by distance
      const order = [...lanes].sort((a, b) => {
        const fa = raceBuffer.finishOrder.indexOf(a.id), fb = raceBuffer.finishOrder.indexOf(b.id);
        if (fa !== -1 || fb !== -1) return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
        return (horses.get(b.id)?.pos ?? 0) - (horses.get(a.id)?.pos ?? 0);
      });
      const places = new Map(horses.size ? order.map((l, i) => [l.id, i + 1]) : []);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderer.frame({ width: W, height: H, lanes, drawings, horses, places });

      // countdown overlay
      const start = room.raceStartAt ?? now;
      const left = start - now;
      const el = countRef.current!;
      if (left > 0) {
        el.textContent = String(Math.ceil(left / 1000));
        el.style.opacity = '1';
      } else if (left > -900) {
        el.textContent = 'GO!';
        el.style.opacity = String(1 + left / 900);
      } else {
        el.style.opacity = '0';
      }

      if (timerRef.current) timerRef.current.textContent = (Math.max(0, now - start) / 1000).toFixed(2) + 's';

      const mine = horses.get(session.playerId);
      if (mine && boostRef.current && windRef.current) {
        boostRef.current.style.width = `${mine.boost * 100}%`;
        windRef.current.style.width = `${(1 - mine.fatigue) * 100}%`;
        windRef.current.classList.toggle('low', mine.fatigue > 0.5);
      }
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // ---- input ----
  useEffect(() => {
    if (!isRacer) return;
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (e.repeat) return; // holding space doesn't count
      giddyUp();
      setPressed(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setPressed(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isRacer]);

  return (
    <div className="page race-page">
      <RoomHeader />
      <div className="race-top">
        <span>
          {RACE.distance}m · {state === 'COUNTDOWN' ? 'get ready' : 'RACING'} · <span ref={timerRef}>0.00s</span>
        </span>
        {!isRacer && <span className="hint">you're spectating</span>}
      </div>
      <div className="track-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="track" />
        <div className="countdown" ref={countRef} />
        <ul className="events">
          {events.slice(-3).map((e) => (
            <li key={e.t + e.playerId}>{e.text}</li>
          ))}
        </ul>
      </div>
      {isRacer && (
        <div className="controls">
          <div className="meters">
            <div className="meter">
              <span>BOOST</span>
              <div className="bar">
                <div ref={boostRef} className="fill boost" />
              </div>
            </div>
            <div className="meter">
              <span>WIND</span>
              <div className="bar">
                <div ref={windRef} className="fill wind" />
              </div>
            </div>
            <p className="hint">tap in a rhythm. frantic mashing exhausts your horse.</p>
          </div>
          <button
            className={`giddy ${pressed ? 'pressed' : ''}`}
            onPointerDown={(e) => {
              e.preventDefault();
              giddyUp();
              setPressed(true);
            }}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            onContextMenu={(e) => e.preventDefault()}
          >
            GIDDY UP!
            <small>(or SPACE)</small>
          </button>
        </div>
      )}
    </div>
  );
}
