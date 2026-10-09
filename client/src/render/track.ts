import {
  OBSTACLE_LABEL,
  RACE,
  type Drawing,
  type HorseTick,
  type Obstacle,
  type PlayerId,
  type Pose,
  type RaceTick,
} from '@bah/shared';
import { drawHorse, INK } from './horse';

export interface Lane {
  id: PlayerId;
  nickname: string;
  isMe: boolean;
}

interface HorseView {
  pos: number;
  vel: number;
  voice: number;
  pose: Pose;
  /** Animated towards the pose: height off the ground and how crouched. */
  air: number;
  crouch: number;
  phase: number;
  effect: string | null;
  finished: boolean;
}

const BG = '#eef3e6';
const LINE = '#111';
const FAINT = 'rgba(17,17,17,0.18)';
const ME = '#f3e36b';

/** Interpolated horse positions at `renderT` (server ms). */
export function sampleTicks(ticks: RaceTick[], renderT: number): Map<PlayerId, HorseTick> {
  const out = new Map<PlayerId, HorseTick>();
  if (!ticks.length) return out;
  let a = ticks[0], b = ticks[0];
  if (renderT >= ticks[ticks.length - 1].t) {
    a = b = ticks[ticks.length - 1];
  } else {
    for (let i = ticks.length - 1; i > 0; i--) {
      if (ticks[i - 1].t <= renderT) {
        a = ticks[i - 1];
        b = ticks[i];
        break;
      }
    }
  }
  const f = b.t === a.t ? 1 : Math.min(1, Math.max(0, (renderT - a.t) / (b.t - a.t)));
  for (const hb of b.horses) {
    const ha = a.horses.find((x) => x.id === hb.id) ?? hb;
    out.set(hb.id, { ...hb, pos: ha.pos + (hb.pos - ha.pos) * f, vel: ha.vel + (hb.vel - ha.vel) * f });
  }
  return out;
}

export class TrackRenderer {
  private views = new Map<PlayerId, HorseView>();
  private camX = -10;
  private camReady = false;
  private lastFrame = performance.now();

  constructor(private ctx: CanvasRenderingContext2D) {}

  frame(opts: {
    width: number;
    height: number;
    lanes: Lane[];
    obstacles: Obstacle[];
    drawings: Record<PlayerId, Drawing>;
    horses: Map<PlayerId, HorseTick>;
    places: Map<PlayerId, number>;
  }) {
    const { ctx, views } = this;
    const { width: W, height: H, lanes, obstacles, drawings, horses, places } = opts;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    for (const lane of lanes) {
      const t = horses.get(lane.id);
      let v = views.get(lane.id);
      if (!v)
        views.set(
          lane.id,
          (v = { pos: 0, vel: 0, voice: 0, pose: 'RUN', air: 0, crouch: 0, phase: Math.random() * 6, effect: null, finished: false }),
        );
      if (t) {
        v.pos = t.pos;
        v.vel = t.vel;
        v.voice = t.voice;
        v.pose = t.pose;
        v.effect = t.effect;
        v.finished = t.finished;
      }
      v.phase += dt * (1.5 + v.vel * 1.6);
      const airTarget = v.pose === 'BIGJUMP' ? 1.6 : v.pose === 'JUMP' ? 1 : 0;
      const crouchTarget = v.pose === 'DUCK' ? 1 : 0;
      v.air += (airTarget - v.air) * Math.min(1, dt * (airTarget > v.air ? 14 : 9));
      v.crouch += (crouchTarget - v.crouch) * Math.min(1, dt * 12);
    }

    // ---- layout ----
    const topPad = 34;
    const bottomPad = 18;
    const laneH = Math.min(140, (H - topPad - bottomPad) / Math.max(1, lanes.length));
    const trackTop = topPad;
    const trackBottom = topPad + laneH * lanes.length;
    const visibleM = Math.max(16, Math.min(34, W / 38));
    const ppm = W / visibleM;
    const horseH = laneH * 0.68; // leaves headroom for jumping
    const horseW = Math.min(horseH * 1.6, 5 * ppm);

    // ---- camera: keep the leading group in view ----
    // Follow horses still running (finished ones would drag the view past the line),
    // and widen the frame from the leader backwards to include as many as fit.
    const all = lanes.map((l) => views.get(l.id)!);
    const running = all.filter((v) => !v.finished);
    const positions = (running.length ? running : all).map((v) => v.pos).sort((a, b) => b - a);
    const leader = positions[0] ?? 0;
    let rear = leader;
    for (const p of positions) if (leader - p <= visibleM * 0.7) rear = p;
    const horseM = horseW / ppm;
    const focus = (leader + rear) / 2 - horseM / 2; // horses extend left of their nose
    // At the start, leave room left of the line for lane labels + the horses' bodies.
    const minCam = -(horseW + 150) / ppm;
    const target = Math.min(RACE.distance + 10 - visibleM, Math.max(minCam, focus - visibleM * 0.5 + 1));
    if (!this.camReady) {
      this.camX = target; // e.g. joining mid-race
      this.camReady = horses.size > 0; // keep snapping until real positions arrive
    } else {
      this.camX += (target - this.camX) * Math.min(1, dt * 2.5);
    }
    const sx = (m: number) => (m - this.camX) * ppm;

    // ---- track ----
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = INK;
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const m0 = Math.floor(this.camX / 5) * 5;
    for (let m = Math.max(0, m0); m <= Math.min(RACE.distance, this.camX + visibleM + 5); m += 5) {
      const x = sx(m);
      ctx.strokeStyle = FAINT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, trackTop);
      ctx.lineTo(x, trackBottom);
      ctx.stroke();
      if (m % 10 === 0) {
        ctx.fillText(`${m}m`, x, trackTop - 16);
        drawFlag(ctx, x, trackTop, m);
        drawFlag(ctx, x, trackBottom + 14, m);
      }
    }

    // lane lines
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    for (let i = 0; i <= lanes.length; i++) {
      const y = Math.round(trackTop + i * laneH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // highlight my lane
    lanes.forEach((l, i) => {
      if (!l.isMe) return;
      ctx.fillStyle = ME;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, trackTop + i * laneH + 1, W, laneH - 1);
      ctx.globalAlpha = 1;
    });

    // obstacles: identical in every lane
    for (const ob of obstacles) {
      const x = sx(ob.at);
      if (x < -40 || x > W + 40) continue;
      for (let i = 0; i < lanes.length; i++) {
        drawObstacle(ctx, ob, x, trackTop + i * laneH, laneH);
      }
      ctx.fillStyle = INK;
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(OBSTACLE_LABEL[ob.kind], x, trackBottom + 30);
    }

    // start line
    const sxs = sx(0);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sxs, trackTop);
    ctx.lineTo(sxs, trackBottom);
    ctx.stroke();
    ctx.save();
    ctx.translate(sxs - 6, trackBottom - 6);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.fillText('START', 0, 0);
    ctx.restore();

    // finish line (checkered)
    const fx = sx(RACE.distance);
    const sq = 8;
    for (let y = trackTop, r = 0; y < trackBottom; y += sq, r++) {
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = (r + c) % 2 ? INK : '#fff';
        ctx.fillRect(fx + c * sq, y, sq, Math.min(sq, trackBottom - y));
      }
    }
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText('FINISH', fx + 20, trackTop - 16);

    // ---- horses ----
    lanes.forEach((lane, i) => {
      const v = views.get(lane.id)!;
      const d = drawings[lane.id];
      const cy = trackTop + i * laneH + laneH / 2 + laneH * 0.02;
      const x = sx(v.pos); // horse's nose is at its position
      // A horse being shouted at runs more frantically.
      const moving = Math.min(1.35, v.vel / 6 + v.voice * 0.35);
      if (d) {
        drawHorse(ctx, d, x - horseW / 2, cy, horseW, horseH, {
          phase: v.phase,
          intensity: moving,
          effect: v.effect,
          time: now,
          // Jump as high as the lane allows, and no higher.
          lift: Math.min(v.air * horseH * 0.35, laneH * 0.5 - horseH * 0.4),
          crouch: v.crouch,
        });
      } else {
        ctx.fillStyle = INK;
        ctx.textAlign = 'center';
        ctx.fillText('(no horse?)', x - horseW / 2, cy);
      }
      if (v.effect) {
        ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = INK;
        ctx.fillText(v.effect, x - horseW / 2, cy - horseH / 2 + 4);
        ctx.font = '12px ui-monospace, Menlo, monospace';
      }
    });

    // ---- lane labels (screen-fixed) ----
    lanes.forEach((lane, i) => {
      const v = views.get(lane.id)!;
      const y = trackTop + i * laneH;
      const place = places.get(lane.id);
      const label = `${lane.nickname}${lane.isMe ? ' (you)' : ''}`;
      const sub = `${place ? ordinal(place) : '-'}  ${Math.min(RACE.distance, Math.max(0, v.pos)).toFixed(0)}m${v.finished ? ' ✓' : ''}`;
      ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
      const bw = Math.max(ctx.measureText(label).width, 90) + 12;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(4, y + 4, bw, 34);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.strokeRect(4.5, y + 4.5, bw, 34);
      ctx.fillStyle = INK;
      ctx.textAlign = 'left';
      ctx.fillText(label, 10, y + 18);
      ctx.font = '12px ui-monospace, Menlo, monospace';
      ctx.fillText(sub, 10, y + 33);
    });

    // ---- progress strip ----
    const px0 = 16, px1 = W - 16, py = 10;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(px0, py);
    ctx.lineTo(px1, py);
    ctx.stroke();
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const lane of lanes) {
      const v = views.get(lane.id)!;
      const x = px0 + (px1 - px0) * Math.min(1, Math.max(0, v.pos / RACE.distance));
      ctx.fillStyle = lane.isMe ? '#d33' : INK;
      ctx.beginPath();
      ctx.arc(x, py, lane.isMe ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, baseY: number, m: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.lineTo(x, baseY - 12);
  ctx.stroke();
  ctx.fillStyle = m === 0 || m === RACE.distance ? INK : m % 20 === 0 ? '#d33' : '#3a6';
  ctx.beginPath();
  ctx.moveTo(x, baseY - 12);
  ctx.lineTo(x + 8, baseY - 9);
  ctx.lineTo(x, baseY - 6);
  ctx.fill();
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}


/** DUCK = a bar overhead, JUMP = a low fence, BIGJUMP = a tall wall. */
function drawObstacle(ctx: CanvasRenderingContext2D, ob: Obstacle, x: number, laneTop: number, laneH: number) {
  const ground = laneTop + laneH - 2;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2;
  if (ob.kind === 'DUCK') {
    const barY = laneTop + laneH * 0.42;
    ctx.beginPath();
    ctx.moveTo(x - 1, laneTop + 2);
    ctx.lineTo(x - 1, barY);
    ctx.moveTo(x + 12, laneTop + 2);
    ctx.lineTo(x + 12, barY);
    ctx.stroke();
    ctx.fillRect(x - 6, barY, 24, 5); // the bar you duck under
    return;
  }
  const h = ob.kind === 'BIGJUMP' ? laneH * 0.52 : laneH * 0.26;
  ctx.beginPath();
  ctx.moveTo(x, ground);
  ctx.lineTo(x, ground - h);
  ctx.lineTo(x + 14, ground - h);
  ctx.lineTo(x + 14, ground);
  ctx.stroke();
  // rails
  ctx.lineWidth = 1.5;
  const rails = ob.kind === 'BIGJUMP' ? 3 : 1;
  for (let i = 1; i <= rails; i++) {
    const y = ground - (h * i) / (rails + 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 14, y);
    ctx.stroke();
  }
}
