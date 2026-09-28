/**
 * Headless end-to-end check: create/join, draw, start, race with different
 * input styles, results, race again, draw new, resume. Run with the server up.
 */
import type { Drawing, RoomSnapshot, Session } from '@bah/shared';
import { BASE_URL, createRoomCode, newClient } from './net';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const assert = (c: unknown, msg: string) => {
  if (!c) throw new Error('ASSERT: ' + msg);
  console.log('  ok -', msg);
};

function bot() {
  const s = newClient();
  const state = { snap: null as RoomSnapshot | null, drawings: {} as Record<string, Drawing> };
  s.on('room:state', (x) => (state.snap = x));
  s.on('drawing:all', (d) => (state.drawings = d));
  s.on('drawing:update', ({ playerId, drawing }) => {
    if (drawing) state.drawings[playerId] = drawing;
    else delete state.drawings[playerId];
  });
  return { s, state };
}

const call = <T>(fn: (ack: (r: T) => void) => void) => new Promise<T>((res) => fn(res));
type B = ReturnType<typeof bot>;
const join = (b: B, roomCode: string, nickname: string) => {
  b.s.connect(roomCode);
  return call<any>((a) => b.s.emit('room:join', { roomCode, nickname }, a));
};
const create = async (b: B, nickname: string) => join(b, await createRoomCode(), nickname);
const resume = (b: B, sess: Session & { takeover?: boolean }) => {
  b.s.connect(sess.roomCode);
  return call<any>((a) => b.s.emit('room:resume', sess, a));
};

const scribble: Drawing = { strokes: [{ size: 6, points: [10, 10, 200, 50, 300, 300, 120, 390] }] };

async function waitPhase(b: ReturnType<typeof bot>, phase: string, timeout = 60_000) {
  const t0 = Date.now();
  while (b.state.snap?.phase !== phase) {
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + phase);
    await sleep(50);
  }
}

async function main() {
  const host = bot(), rhythm = bot(), masher = bot();
  const created = await create(host, 'Hosty');
  assert(created.ok && created.session.roomCode.length === 6, 'room created: ' + created.session?.roomCode);
  const code = created.session.roomCode;

  const bad = await join(rhythm, 'ZZZZZZ', 'x');
  assert(!bad.ok, 'bad room code rejected');
  const dup = await join(rhythm, code, 'hosty');
  assert(!dup.ok, 'duplicate nickname rejected');

  const j1 = await join(rhythm, code.toLowerCase(), 'Rhythm');
  const j2 = await join(masher, code, 'Masher');
  assert(j1.ok && j2.ok, 'two players joined');
  await sleep(100);
  assert(host.state.snap?.players.length === 3, 'lobby shows 3 players');

  const early = await call<any>((a) => host.s.emit('host:startRace', a));
  assert(!early.ok, 'cannot start before everyone is ready: ' + early.error);

  const notDrawing = await call<any>((a) => host.s.emit('player:submitDrawing', { drawing: scribble }, a));
  assert(!notDrawing.ok, 'cannot submit without entering DRAWING');

  for (const b of [host, rhythm, masher]) b.s.emit('player:startDrawing');
  await sleep(100);
  const empty = await call<any>((a) => host.s.emit('player:submitDrawing', { drawing: { strokes: [] } }, a));
  assert(!empty.ok, 'empty drawing rejected');
  for (const b of [host, rhythm, masher]) {
    const r = await call<any>((a) => b.s.emit('player:submitDrawing', { drawing: scribble }, a));
    assert(r.ok, 'drawing submitted');
  }
  await sleep(100);
  assert(Object.keys(masher.state.drawings).length === 3, 'every client has all 3 drawings');

  const notHost = await call<any>((a) => rhythm.s.emit('host:startRace', a));
  assert(!notHost.ok, 'non-host cannot start');
  const start = await call<any>((a) => host.s.emit('host:startRace', a));
  assert(start.ok, 'host started race');
  await waitPhase(host, 'COUNTDOWN', 500);

  // Resume test: drop the rhythm bot's socket during countdown and come back.
  const sess: Session = j1.session;
  const dupTab = bot();
  const stolen = await resume(dupTab, sess);
  assert(!stolen.ok, 'resume refused while original tab still connected');
  dupTab.s.connect(null);

  await waitPhase(host, 'RACING', 5000);

  // Input styles: host idles, rhythm presses ~4.5/s, masher presses every 20ms (server caps it).
  const rt = setInterval(() => rhythm.s.emit('race:giddy'), 220);
  const mt = setInterval(() => masher.s.emit('race:giddy'), 20);
  let ticks = 0;
  host.s.on('race:tick', () => ticks++);

  await waitPhase(host, 'RESULTS', 60_000);
  clearInterval(rt);
  clearInterval(mt);
  const res = host.state.snap!.results!;
  console.log('  results:', res.map((r) => `${r.place}. ${r.nickname} ${r.timeMs === null ? 'DNF' : (r.timeMs / 1000).toFixed(2) + 's'}`).join(' | '));
  assert(res.length === 3, 'results for 3 racers');
  assert(ticks > 100, `received ${ticks} race ticks`);

  // Reconnect with a fresh socket after disconnecting
  rhythm.s.connect(null);
  await sleep(200);
  assert(host.state.snap!.players.find((p) => p.nickname === 'Rhythm')?.connected === false, 'disconnect visible to others');
  const back0 = bot();
  const resumed0 = await resume(back0, sess);
  assert(resumed0.ok, 'player resumed after disconnect');
  // A reload races the old socket: takeover replaces it and notifies the old one.
  const back = bot();
  let kicked = false;
  back0.s.on('room:kicked', () => (kicked = true));
  const resumed = await resume(back, { ...sess, takeover: true });
  await sleep(100);
  assert(resumed.ok && kicked && !back0.s.connected, 'takeover resume replaced the old socket');
  await sleep(100);
  assert(back.state.snap?.phase === 'RESULTS' && Object.keys(back.state.drawings).length === 3, 'resumed client got state + drawings');

  const again = await call<any>((a) => host.s.emit('host:raceAgain', a));
  assert(again.ok, 'race again');
  await waitPhase(host, 'COUNTDOWN', 500);
  const bad2 = await call<any>((a) => host.s.emit('host:drawNew', a));
  assert(!bad2.ok, 'draw-new rejected during countdown (invalid transition)');
  await waitPhase(host, 'RESULTS', 60_000);
  const res2 = host.state.snap!.results!;
  console.log('  race 2 (all idle):', res2.map((r) => `${r.nickname} ${(r.timeMs! / 1000).toFixed(2)}s`).join(' | '));

  const dn = await call<any>((a) => host.s.emit('host:drawNew', a));
  assert(dn.ok, 'draw new horse');
  await sleep(100);
  assert(host.state.snap!.phase === 'LOBBY' && host.state.snap!.players.every((p) => p.status === 'DRAWING'), 'everyone back to DRAWING');
  assert(Object.keys(back.state.drawings).length === 0, 'old drawings cleared');

  host.s.emit('room:leave');
  await sleep(100);
  assert(back.state.snap!.players.find((p) => p.isHost)?.nickname !== 'Hosty', 'host migrated after host left');

  for (const b of [host, masher, back]) b.s.connect(null);

  // ---- bots: a lonely player gets auto-filled opponents ----
  console.log('  -- bots --');
  const solo = bot();
  const sc = await create(solo, 'Lonely');
  const soloCode = sc.session.roomCode;
  assert(sc.ok, 'room created over HTTP + joined: ' + soloCode);
  solo.s.emit('player:startDrawing');
  await sleep(100);
  await call<any>((a) => solo.s.emit('player:submitDrawing', { drawing: scribble }, a));
  const soloStart = await call<any>((a) => solo.s.emit('host:startRace', a));
  assert(soloStart.ok, 'solo host can start: a bot fills the empty lane');
  await sleep(100);
  const bots = solo.state.snap!.players.filter((p) => p.isBot);
  assert(bots.length === 1 && solo.state.snap!.racers.length === 2, 'one bot added and racing');
  assert(!!solo.state.drawings[bots[0].id], 'bot has a drawing');
  const noAdd = await call<any>((a) => solo.s.emit('host:addBot', a));
  assert(!noAdd.ok, 'cannot add bots mid-race');
  await waitPhase(solo, 'RESULTS', 60_000);
  const botRes = solo.state.snap!.results!;
  console.log('  solo race:', botRes.map((r) => `${r.nickname} ${r.timeMs === null ? 'DNF' : (r.timeMs / 1000).toFixed(2) + 's'}`).join(' | '));
  assert(botRes.every((r) => r.timeMs !== null), 'bot finished the race');

  for (let i = 0; i < 6; i++) await call<any>((a) => solo.s.emit('host:addBot', a));
  await sleep(100);
  assert(solo.state.snap!.players.length === 8, 'room filled to 8 with bots');
  const full = await call<any>((a) => solo.s.emit('host:addBot', a));
  assert(!full.ok, 'cannot add a 9th horse');
  const late = bot();
  const lateJoin = await join(late, soloCode, 'Latecomer');
  await sleep(100);
  assert(lateJoin.ok && solo.state.snap!.players.filter((p) => p.isBot).length === 6, 'human bumped a bot to get a seat');
  const lateAdd = await call<any>((a) => late.s.emit('host:addBot', a));
  assert(!lateAdd.ok, 'non-host cannot add bots');
  const oneBot = solo.state.snap!.players.find((p) => p.isBot)!;
  const rm = await call<any>((a) => solo.s.emit('host:removeBot', { playerId: oneBot.id }, a));
  await sleep(100);
  assert(rm.ok && solo.state.snap!.players.length === 7, 'host removed a bot');
  const dn2 = await call<any>((a) => solo.s.emit('host:drawNew', a));
  await sleep(100);
  assert(
    dn2.ok && solo.state.snap!.players.filter((p) => p.isBot).every((p) => p.status === 'READY' && solo.state.drawings[p.id]),
    'bots redraw instantly on draw-new',
  );
  solo.s.emit('room:leave');
  await sleep(100);
  assert(late.state.snap!.players.find((p) => p.nickname === 'Latecomer')?.isHost === true, 'host passes to a human, not a bot');
  late.s.emit('room:leave');
  solo.s.connect(null);
  late.s.connect(null);
  console.log('SMOKE PASSED against ' + BASE_URL);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
