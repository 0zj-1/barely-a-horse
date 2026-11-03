import { useEffect, useRef, useState } from 'react';
import { OBSTACLE_LABEL, RACE, poseForVoice, type Pose } from '@bah/shared';
import { serverNow } from '../net/socket';
import { TrackRenderer, sampleTicks, type Lane } from '../render/track';
import { startMic, micBlockedReason, MicError, type Mic, type MicReading } from '../net/mic';
import { getStore, giddyUp, raceBuffer, setPose, shout, useStore } from '../store';
import { RoomHeader } from './Lobby';

const INTERP_DELAY = 110; // ms behind the server, so we always have two ticks to blend
const SHOUT_SEND_MS = 50; // how often the mic level goes to the server
const MIC_PREF = 'bah.mic';
const POSE_REFRESH_MS = 300; // keyboard/touch poses expire on the server unless refreshed

const POSE_LABEL: Record<Pose, string> = {
  RUN: 'RUNNING',
  DUCK: 'DUCKING',
  JUMP: 'JUMPING',
  BIGJUMP: 'BIG JUMP!',
};

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
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState<string | null>(() => {
    const blocked = micBlockedReason();
    return blocked ? `${blocked.message} — ${blocked.fix}` : null;
  });
  const micRef = useRef<Mic | null>(null);
  const readingRef = useRef<MicReading>({ level: 0, pitch: 0, base: 0 });
  const voiceRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<HTMLSpanElement>(null);
  const nextObRef = useRef<HTMLSpanElement>(null);
  const [heldPose, setHeldPose] = useState<Pose | null>(null);
  /** What our own input says right now, shown without waiting for the server to echo it. */
  const localPoseRef = useRef<Pose | null>(null);

  const isRacer = !!(room && session && room.racers.includes(session.playerId));

  // ---- render loop ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext('2d')!;
    const renderer = new TrackRenderer(ctx);
    if (import.meta.env.DEV) (window as unknown as { __cam: unknown }).__cam = renderer.lastCam;
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
      renderer.frame({ width: W, height: H, lanes, obstacles: room.obstacles, drawings, horses, places });

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

      // Pose and the obstacle coming up. Our own pose is shown from local input:
      // the server agrees a moment later, but waiting for it would feel sluggish.
      const mine = horses.get(session.playerId);
      if (mine && localPoseRef.current) mine.pose = localPoseRef.current;
      if (poseRef.current) poseRef.current.textContent = mine ? POSE_LABEL[mine.pose] : '—';
      if (nextObRef.current) {
        const pos = mine?.pos ?? 0;
        const next = room.obstacles.find((o) => o.at > pos);
        nextObRef.current.textContent = next
          ? `${OBSTACLE_LABEL[next.kind]} in ${Math.max(0, Math.round(next.at - pos))}m`
          : 'clear track';
        nextObRef.current.className = next && next.at - pos < 12 ? 'next-ob soon' : 'next-ob';
      }
      if (mine && boostRef.current && windRef.current) {
        if (voiceRef.current) voiceRef.current.style.width = `${mine.voice * 100}%`;
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
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        setHeldPose('DUCK');
        return;
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        setHeldPose(e.shiftKey ? 'BIGJUMP' : 'JUMP');
        return;
      }
      if (e.code !== 'Space') return;
      e.preventDefault();
      if (e.repeat) return; // holding space doesn't count
      giddyUp();
      setPressed(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPressed(false);
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') setHeldPose(null);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isRacer]);

  // Hold a pose on the server while a key/button is down; it expires if we stop.
  const posedRef = useRef(false);
  useEffect(() => {
    if (!isRacer) return;
    if (!heldPose) {
      // Only release a pose we actually set: an unprompted RUN would override the voice.
      if (posedRef.current) setPose('RUN');
      posedRef.current = false;
      if (!micOn) localPoseRef.current = null;
      return;
    }
    posedRef.current = true;
    localPoseRef.current = heldPose;
    setPose(heldPose);
    const id = setInterval(() => setPose(heldPose), POSE_REFRESH_MS);
    return () => clearInterval(id);
  }, [isRacer, heldPose, micOn]);

  // ---- microphone ----
  const stopMic = () => {
    micRef.current?.stop();
    micRef.current = null;
    readingRef.current = { level: 0, pitch: 0, base: 0 };
    localPoseRef.current = null;
    setMicOn(false);
  };

  const toggleMic = async () => {
    setMicError(null);
    if (micRef.current) {
      localStorage.setItem(MIC_PREF, 'off');
      shout(0);
      stopMic();
      return;
    }
    try {
      micRef.current = await startMic((r) => (readingRef.current = r));
      setMicOn(true);
      localStorage.setItem(MIC_PREF, 'on');
    } catch (e) {
      setMicError(e instanceof MicError ? `${e.message} — ${e.fix}` : 'could not use the microphone');
      setMicOn(false);
    }
  };

  // Remember the choice, but the browser still asks for permission per session.
  useEffect(() => {
    if (!isRacer || localStorage.getItem(MIC_PREF) !== 'on') return;
    void toggleMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRacer]);

  useEffect(() => () => stopMic(), []);

  // The mic level is sampled every frame; the server only needs ~10 updates a second.
  useEffect(() => {
    if (!isRacer || !micOn) return;
    let last = -1;
    const id = setInterval(() => {
      const { level, pitch, base } = readingRef.current;
      if (!heldPose) localPoseRef.current = poseForVoice(level, pitch, base);
      if (level === 0 && last === 0) return; // stay quiet while quiet
      last = level;
      shout(level, pitch, base);
    }, SHOUT_SEND_MS);
    return () => clearInterval(id);
  }, [isRacer, micOn, heldPose]);

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
              <span>VOICE</span>
              <div className="bar">
                <div ref={voiceRef} className="fill voice" />
              </div>
              <button className={`mic ${micOn ? 'on' : ''}`} onClick={toggleMic} title="shout to run faster">
                {micOn ? '🎤 ON' : '🎤 TURN ON'}
              </button>
            </div>
            <div className="meter">
              <span>WIND</span>
              <div className="bar">
                <div ref={windRef} className="fill wind" />
              </div>
            </div>
            <div className="pose-row">
              <span className="pose" ref={poseRef}>
                RUNNING
              </span>
              <span className="next-ob" ref={nextObRef} />
              {!micOn && <span className="mic-hint">mic off — your voice does nothing</span>}
            </div>
            <div className="pose-keys">
              <button
                className={heldPose === 'DUCK' ? 'held' : ''}
                onPointerDown={(e) => (e.preventDefault(), setHeldPose('DUCK'))}
                onPointerUp={() => setHeldPose(null)}
                onPointerLeave={() => setHeldPose(null)}
              >
                ↓ DUCK
              </button>
              <button
                className={heldPose === 'JUMP' ? 'held' : ''}
                onPointerDown={(e) => (e.preventDefault(), setHeldPose('JUMP'))}
                onPointerUp={() => setHeldPose(null)}
                onPointerLeave={() => setHeldPose(null)}
              >
                ↑ JUMP
              </button>
              <button
                className={heldPose === 'BIGJUMP' ? 'held' : ''}
                onPointerDown={(e) => (e.preventDefault(), setHeldPose('BIGJUMP'))}
                onPointerUp={() => setHeldPose(null)}
                onPointerLeave={() => setHeldPose(null)}
              >
                ⇈ BIG
              </button>
            </div>
            <p className="hint">
              talk to keep moving, louder runs faster. drop to a low voice to duck, shout to
              jump, scream to jump big. no mic? tap SPACE for speed and ↓ / ↑ / shift+↑ for
              the obstacles.
            </p>
            {micError && <p className="error">{micError}</p>}
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
