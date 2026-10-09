/**
 * Microphone input: how loud you are (0..1) and how low your voice is (Hz).
 *
 * Nothing is recorded or uploaded: the audio stays in the browser and only those
 * two numbers go to the server, which decides what the horse does.
 */

export interface MicReading {
  level: number;
  /** Fundamental frequency in Hz, or 0 when it can't be worked out. */
  pitch: number;
  /** This player's own normal speaking pitch, learnt as they talk (0 until known). */
  base: number;
}

export interface Mic {
  stop(): void;
}

/** dB above the room's own noise floor that counts as a full-volume shout. */
const SHOUT_RANGE_DB = 26;
/** dB above the floor before anything registers (so breathing/typing is ignored). */
const GATE_DB = 7;
const CALIBRATION_MS = 700;
/** Loudness band that counts as "talking normally" when learning someone's pitch. */
const NORMAL_MIN_LEVEL = 0.18;
const NORMAL_MAX_LEVEL = 0.5;
const MIN_HZ = 70;
const MAX_HZ = 500;

export type MicProblem = 'insecure' | 'denied' | 'missing' | 'unsupported' | 'failed';

export class MicError extends Error {
  constructor(
    readonly problem: MicProblem,
    message: string,
    /** What the player can do about it. */
    readonly fix: string,
  ) {
    super(message);
  }
}

function describe(e: unknown): MicError {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new MicError(
      'denied',
      'microphone blocked',
      'allow the mic for this site (the padlock icon in the address bar), then turn it on again',
    );
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new MicError('missing', 'no microphone found', 'plug one in or check your system sound settings');
  }
  if (name === 'NotReadableError') {
    return new MicError('failed', 'the microphone is busy', 'close other apps or tabs using the mic, then try again');
  }
  return new MicError('failed', 'could not start the microphone', 'try again, or reload the page');
}

/** Why the mic cannot work here at all, or null if it should. */
export function micBlockedReason(): MicError | null {
  // getUserMedia only exists on https and localhost.
  if (!window.isSecureContext) {
    return new MicError(
      'insecure',
      'microphones need a secure connection',
      'open the game over https (the workers.dev address) or on localhost',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    return new MicError('unsupported', 'this browser has no microphone access', 'try Chrome, Edge, Firefox or Safari');
  }
  return null;
}

/** Rough fundamental frequency by autocorrelation; 0 when the signal is too noisy. */
function detectPitch(buf: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(buf.length - 1, Math.floor(sampleRate / MIN_HZ));
  let best = 0;
  let bestLag = -1;
  let energy = 0;
  for (let i = 0; i < buf.length; i++) energy += buf[i] * buf[i];
  if (energy < 1e-4) return 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < buf.length - lag; i++) sum += buf[i] * buf[i + lag];
    const score = sum / (buf.length - lag);
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  const clarity = best / (energy / buf.length);
  if (bestLag < 0 || clarity < 0.4) return 0;
  return Math.round(sampleRate / bestLag);
}

export async function startMic(onReading: (r: MicReading) => void): Promise<Mic> {
  const blocked = micBlockedReason();
  if (blocked) throw blocked;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // Raw-ish signal: AGC and noise suppression would flatten the shouting.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    throw describe(e);
  }

  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  const startedAt = performance.now();
  let floorDb = -70; // room noise, measured during calibration and tracked after
  let calibrated = false;
  let level = 0;
  let pitch = 0;
  let base = 0;
  let raf = 0;
  let frame = 0;

  const tick = () => {
    raf = requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-8);

    const elapsed = performance.now() - startedAt;
    if (!calibrated) {
      floorDb = elapsed < 80 ? db : floorDb + (db - floorDb) * 0.1;
      if (elapsed > CALIBRATION_MS) calibrated = true;
      onReading({ level: 0, pitch: 0, base });
      return;
    }
    // Keep following the room downwards, so a noisy venue doesn't peg the meter.
    if (db < floorDb) floorDb += (db - floorDb) * 0.05;

    const raw = Math.min(1, Math.max(0, (db - floorDb - GATE_DB) / SHOUT_RANGE_DB));
    // Snap up when you shout, fade out when you stop.
    level += (raw - level) * (raw > level ? 0.6 : 0.15);
    if (level < 0.02) level = 0;

    // Pitch is only meaningful while there's a voice, and it's expensive: every 3rd frame.
    if (level > 0.05 && frame++ % 3 === 0) pitch = detectPitch(buf, ctx.sampleRate) || pitch;
    if (level === 0) pitch = 0;

    // Learn the player's normal pitch from ordinary talking, so "low voice" means
    // low *for them*. Slow enough that deliberately going deep barely moves it.
    if (pitch > 0 && level >= NORMAL_MIN_LEVEL && level < NORMAL_MAX_LEVEL) {
      base = base === 0 ? pitch : base * 0.97 + pitch * 0.03;
    }

    onReading({ level: Math.round(level * 100) / 100, pitch, base: Math.round(base) });
  };
  tick();

  return {
    stop() {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
      onReading({ level: 0, pitch: 0, base });
    },
  };
}
