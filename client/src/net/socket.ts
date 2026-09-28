import { API_CREATE_ROOM, GameClient, type Session, type WSConstructor } from '@bah/shared';

// Same origin everywhere: the Vite dev server (Cloudflare plugin), the deployed
// Worker, and the Node server all serve /ws/<room> next to the page.
const wsOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
export const socket = new GameClient(WebSocket as unknown as WSConstructor, wsOrigin);

/** Reserve a fresh room code. */
export async function requestRoomCode(): Promise<string> {
  const res = await fetch(API_CREATE_ROOM, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!body.code) throw new Error(body.error ?? 'could not create a room');
  return body.code;
}

// ---- session token (per tab first, so two tabs = two players; localStorage as fallback) ----
const KEY = 'bah.session';

/** `fromTab` = found in this tab's sessionStorage, i.e. this tab owns the session. */
export function loadSession(): { session: Session; fromTab: boolean } | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(KEY);
      if (raw) return { session: JSON.parse(raw) as Session, fromTab: store === sessionStorage };
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function saveSession(s: Session) {
  const raw = JSON.stringify(s);
  try {
    sessionStorage.setItem(KEY, raw);
    localStorage.setItem(KEY, raw);
  } catch {
    /* ignore */
  }
}

export function clearSession(tabOnly = false) {
  try {
    sessionStorage.removeItem(KEY);
    if (!tabOnly) localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---- server clock estimate ----
// offset = serverTime - localTime. The sample with the smallest latency gives the
// largest (serverT - receivedAt), so we track a slowly-decaying max over samples.
let offset = 0;
let hasOffset = false;

export function sampleServerTime(serverT: number) {
  const candidate = serverT - Date.now();
  if (!hasOffset) {
    offset = candidate;
    hasOffset = true;
  } else if (candidate > offset) {
    offset = candidate;
  } else {
    offset += (candidate - offset) * 0.02; // drift down slowly if the clocks wander
  }
}

export const serverNow = () => Date.now() + offset;
