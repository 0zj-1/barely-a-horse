import { ROOM } from '@bah/shared';

// Web Crypto: available in both Node 20+ and Cloudflare Workers.

export const randomId = () => crypto.randomUUID();

export function randomToken(bytes = 18) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makeRoomCode() {
  const alphabet = ROOM.codeAlphabet;
  const buf = crypto.getRandomValues(new Uint32Array(ROOM.codeLength));
  return Array.from(buf, (n) => alphabet[n % alphabet.length]).join('');
}
