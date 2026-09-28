/**
 * A bot player for testing: joins a room, draws a wobbly horse, readies up, and
 * taps GIDDY UP at a human-ish rhythm during races.
 *   npm run bot -w server -- ROOMCODE [name] [pressesPerSecond]
 */
import { botDrawing, type RoomSnapshot, type Session } from '@bah/shared';
import { newClient } from './net';

const [code, name = 'Botty', rateArg = '5'] = process.argv.slice(2);
if (!code) {
  console.log('usage: bot ROOMCODE [name] [pressesPerSecond]');
  process.exit(1);
}
const rate = Number(rateArg);
const s = newClient();

let snap: RoomSnapshot | null = null;
let myId = '';
let presser: ReturnType<typeof setInterval> | null = null;
let session: Session | null = null;
let submitting = false;

s.on('room:state', (r) => {
  snap = r;
  const me = r.players.find((p) => p.id === myId);
  if (!me) return;
  if (r.phase === 'LOBBY' && me.status !== 'READY') {
    if (me.status !== 'DRAWING') s.emit('player:startDrawing');
    else if (!submitting) {
      submitting = true;
      setTimeout(() => s.emit('player:submitDrawing', { drawing: botDrawing() }, () => (submitting = false)), 1500);
    }
  }
  if (r.phase === 'RACING' && !presser && rate > 0) {
    presser = setInterval(() => s.emit('race:giddy'), 1000 / rate);
  }
  if (r.phase !== 'RACING' && presser) {
    clearInterval(presser);
    presser = null;
  }
  if (r.phase === 'RESULTS') console.log(`[${name}] results:`, r.results?.map((x) => `${x.place}.${x.nickname}`).join(' '));
});

// First connection joins; reconnects resume the same seat.
s.on('connect', () => {
  if (session) {
    s.emit('room:resume', { ...session, takeover: true }, (res) => {
      if (!res.ok) console.error(`[${name}] resume failed:`, res.error);
    });
    return;
  }
  s.emit('room:join', { roomCode: code, nickname: name }, (res) => {
    if (!res.ok) {
      console.error(`[${name}] join failed:`, res.error);
      process.exit(1);
    }
    session = res.session;
    myId = res.session.playerId;
    console.log(`[${name}] joined ${res.session.roomCode}`);
    if (snap) s.emit('player:startDrawing');
  });
});
s.connect(code.toUpperCase());
