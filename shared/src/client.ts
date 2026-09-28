import {
  CLOSE_REPLACED,
  WS_PREFIX,
  type AckResult,
  type ClientMessage,
  type ClientToServerEvents,
  type ServerMessage,
  type ServerToClientEvents,
} from './events';

/** The subset of the WebSocket API we need, so browsers and the `ws` package both fit. */
interface WSLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export type WSConstructor = new (url: string) => WSLike;

type ClientEvents = ServerToClientEvents & { connect: () => void; disconnect: () => void };
type Handler = (d: never) => void;

const OPEN = 1;
const NOT_CONNECTED: AckResult = { ok: false, error: 'lost connection to the server, try again' };

/**
 * A tiny socket.io-like client over one plain WebSocket per room:
 * `on`, `emit` with ack callbacks, `connected`, and automatic reconnects.
 */
export class GameClient {
  connected = false;
  private ws: WSLike | null = null;
  private url: string | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private acks = new Map<number, (r: AckResult<never>) => void>();
  private queue: string[] = [];
  private nextId = 1;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** `origin` like `wss://example.com`. */
  constructor(private WS: WSConstructor, private origin: string) {}

  /** Connect to a room's socket (or disconnect with `null`). No-op if already there. */
  connect(roomCode: string | null) {
    const url = roomCode ? `${this.origin}${WS_PREFIX}${roomCode}` : null;
    if (url === this.url) return;
    this.url = url;
    this.teardown();
    if (url) this.open();
  }

  on<K extends keyof ClientEvents>(event: K, fn: ClientEvents[K]) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as Handler);
  }

  emit<K extends keyof ClientToServerEvents>(event: K, ...args: Parameters<ClientToServerEvents[K]>) {
    const last = args[args.length - 1];
    const ack = typeof last === 'function' ? (last as (r: AckResult<never>) => void) : null;
    const payload = args.length && typeof args[0] !== 'function' ? args[0] : undefined;
    const msg: ClientMessage = { t: event, d: payload };
    if (ack) {
      msg.id = this.nextId++;
      this.acks.set(msg.id, ack);
    }
    const raw = JSON.stringify(msg);
    if (this.ws?.readyState === OPEN) this.ws.send(raw);
    else if (this.url) this.queue.push(raw);
    else ack?.(NOT_CONNECTED as AckResult<never>);
  }

  private fire(event: string, data?: unknown) {
    this.handlers.get(event)?.forEach((fn) => (fn as (d: unknown) => void)(data));
  }

  private open() {
    const ws = new this.WS(this.url!);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0;
      this.connected = true;
      for (const raw of this.queue.splice(0)) ws.send(raw);
      this.fire('connect');
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.t === 'ack') {
        const cb = this.acks.get(msg.id);
        this.acks.delete(msg.id);
        cb?.(msg.d as AckResult<never>);
      } else {
        this.fire(msg.t, msg.d);
      }
    };
    ws.onerror = () => {}; // onclose follows
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.failPending();
      if (this.connected) {
        this.connected = false;
        this.fire('disconnect');
      }
      if (ev.code === CLOSE_REPLACED) this.url = null; // someone else has this seat now
      if (this.url) {
        const delay = Math.min(5000, 300 * 2 ** this.attempts++);
        this.retryTimer = setTimeout(() => this.url && !this.ws && this.open(), delay);
      }
    };
  }

  private failPending() {
    this.queue = [];
    const pending = [...this.acks.values()];
    this.acks.clear();
    pending.forEach((cb) => cb(NOT_CONNECTED as AckResult<never>));
  }

  private teardown() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    this.failPending();
    this.attempts = 0;
    if (this.connected) {
      this.connected = false;
      this.fire('disconnect');
    }
    try {
      ws?.close(1000, 'bye');
    } catch {
      /* ignore */
    }
  }
}
