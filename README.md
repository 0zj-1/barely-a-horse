# BARELY A HORSE

Draw a horse. Race it against your friends' horses. Regret it.

A tiny multiplayer browser party game: 2–8 players join a room, draw a horse,
then race the drawings in real time.

## Run it

Needs Node 22 (`nvm use` picks it up from `.nvmrc`).

```bash
npm install
npm run dev          # http://localhost:5173: Vite + the game Worker/Durable Objects running locally
```

Open the page, create a room, and share the room code or the "copy invite" link.
To test alone, open a second tab or add bots:

```bash
npm run bot -w server -- ROOMCODE Kevin 5    # name, presses per second
npm run smoke                                # headless end-to-end test (URL=... to target another server)
npm run typecheck
```

### Deploy to Cloudflare (permanent URL)

```bash
npx wrangler login     # once, opens the browser
npm run deploy         # builds, then uploads to https://barely-a-horse.<your-subdomain>.workers.dev
```

### Or run the Node server yourself (e.g. behind `cloudflared tunnel`)

```bash
npm run build && PORT=8080 npm start
```

## Layout

```
shared/   types, event contracts + WebSocket client, race/room config, state machines, drawing math
wrangler.jsonc  Cloudflare config (Worker, assets, Durable Object binding)
server/   game server: rooms, authoritative race simulation (20 Hz)
  src/worker.ts   Cloudflare Worker + RoomDO (one Durable Object per room)
  src/index.ts    Node version: static files + `ws` WebSockets, all rooms in one process
  src/protocol.ts message handling shared by both
  src/rooms.ts    Node room registry and cleanup
  src/room.ts    one room: players, host, phases, drawings, race loop
  src/race.ts    RaceSim: speed / boost / fatigue / noise / random events
  src/bots.ts    BotDriver: bot press rhythms during a race
  scripts/       smoke test + bot player
client/   React + Vite + Canvas
  src/store.ts          client state machine, socket wiring, session handling
  src/net/socket.ts     socket, session token storage, server clock estimate
  src/render/horse.ts   draws the player's strokes + procedural gallop
  src/render/track.ts   track, camera, lanes, obstacles, interpolation
  src/screens/          Home/Joining, Lobby (+READY), Draw, Race (+COUNTDOWN), Results
```

## How it works

**State machines.** The server owns the room phase `LOBBY → COUNTDOWN → RACING → RESULTS`
(plus `COUNTDOWN → LOBBY` if racers drop out, and `RESULTS → COUNTDOWN | LOBBY`).
Each player has a status: `WAITING | DRAWING | READY`. The client derives its screen state
(`HOME, JOINING, LOBBY, DRAWING, READY, COUNTDOWN, RACING, RESULTS`) from the server's
snapshot, and only moves between states along the transition table in `shared/src/states.ts`.
The server rejects invalid actions, such as a non-host starting a race or "draw new" during a
countdown.

**Server-authoritative race.** Clients send just one race message, `race:giddy`, and the
server ignores presses closer together than 60 ms. Each tick the server computes:

```
target = baseSpeed + boost·3 + noise − fatigue^1.5·4      (then random-event modifiers)
```

- `boost` gains +0.2 per press and decays at 0.7/s, so it saturates at about 3.5 presses/s.
- `fatigue` rises a little with every press and a lot with presses made while boost is
  already full. It recovers slowly, and faster when you rest.
- `noise` and the random events (stumble / zoomies / existential crisis) have the same odds
  for every horse.

Simulated results: a steady rhythm of 4–6 presses/s finishes in about 12 s, doing nothing
takes about 16.5 s, and maximum mashing takes about 18 s. The drawing never affects speed.

**Drawings.** Stored as vector strokes (`{size, points[]}` in a 600×400 space), validated
and size-limited on the server. For rendering, each drawing gets one uniform scale into the
lane's box, so a huge drawing takes up the same space as a tiny one and the proportions stay
intact. Strokes are drawn as straight segments with no smoothing. The gallop (bounce, tilt,
squash/stretch, swaying of the bottom ~45% of the drawing like legs) is applied at render time
and never changes the stored strokes.

**Voice.** The microphone is an optional second control, and it never replaces tapping.
The browser measures loudness and pitch locally (no audio is recorded or uploaded) and sends
two numbers; the server decides everything else.

- Speed: tapping and shouting combine as `max(tap, voice) + 0.45 * min(tap, voice)`, capped,
  so either input alone is competitive and doing both is a little better, never double.
  Shouting tires the horse, and one long unbroken scream tires it fastest — take a breath.
- Pose: a low voice ducks, loud jumps, very loud jumps big; anything else just runs, so
  going quiet costs you speed but never changes what the horse is doing. "Low" is measured
  against the player's own speaking pitch (learnt while they talk), so a deep voice isn't
  stuck in a permanent crouch. `poseForVoice` in `shared/src/config.ts` is the single source
  of truth. The server rejects levels outside 0..1 rather than clamping, so `level: 999`
  buys nothing.
- Without a mic: ↓ / ↑ / shift+↑ (or the on-screen buttons) hold the same poses. Those are
  re-sent while held and expire server-side, so a dropped connection can't leave a horse
  stuck in a crouch.

**Obstacles.** Each race gets 7 obstacles at the same distances in every lane: a low bar to
duck, a hurdle to jump, and a wall that needs a big jump. Clearing one costs a little speed
(`poseSpeedFactor`); hitting one cuts your speed for ~0.9s and adds fatigue. Bots read the
obstacle ahead and get it right 60-95% of the time, depending on the bot.

The timing window is deliberately forgiving on both sides (`poseEarlyMs` / `poseGraceMs`):
posing up to ~320ms before an obstacle clears it, and a horse that arrives in the wrong pose
waits ~260ms for a late one before falling. That covers the unavoidable lag — mic smoothing,
the 50ms send interval, the network, and the 110ms the client renders behind the server —
so the jump lands when it looks like it should. For the same reason poses read the level the
mic just reported rather than the smoothed one the speed uses, and the client shows its own
pose from local input instead of waiting for the server to echo it back. The run-up where
posing counts is drawn on the track as a shaded band.

**Bots.** If the host starts with fewer than 2 ready horses, the server fills the empty
lanes with bots, so you can race alone. Between races the host can also add bots
("+ ADD BOT") or remove them (×). Bots live only on the server: they have no socket, never
count as disconnected, and never become host. Each gets a randomly scribbled horse
(`shared/src/bots.ts`; the number of legs is not guaranteed). In a race, bots press GIDDY UP
through the same rate limit and fatigue rules as humans, each with its own rhythm and the
occasional rest or panic-mash (`server/src/bots.ts`). Simulated median finish is about 12.9 s,
so a player tapping at a steady rhythm can beat them. If the room is full and a human joins,
one bot gives up its seat. A room with no humans left is closed.

**Networking.** A plain WebSocket per room at `/ws/<CODE>` carries JSON messages
(`{t, d, id}`, with acks). Creating a room is `POST /api/rooms`, which reserves a code.
On Cloudflare, each room is a Durable Object named by its code. Its game state lives in
memory and its timers keep it awake while anyone is in the room. An abandoned code is
forgotten after 5 minutes (alarm). The Node server runs the same `Room` + `protocol.ts`
code for all rooms in one process.

**Camera.** Your own horse owns the shot: it sits at `ANCHOR` (42%) across the view, and the
camera may drift at most `CAM_DRIFT` (20% of a screen) towards the pack. A runaway leader
tilts the frame a little without ever taking it off you — measured with a 24m gap, the horse
stayed between 40% and 65% of the width. Spectators, who have no horse of their own, keep
following the leading group instead.

**Sync.** 20 Hz position snapshots. The client estimates the server clock offset, renders
110 ms in the past, and interpolates between snapshots. The countdown uses the server's
`raceStartAt`.

**Reconnect.** Each player gets an id and a secret token, kept in sessionStorage (per tab)
with localStorage as a fallback. A reloaded tab resumes and takes over its old socket. A
different tab with only the localStorage copy is refused while the original is still
connected. Disconnected players keep their seat for 60 s, and a horse in a running race
keeps running. The host role moves to another player if the host leaves, or after the host
has been disconnected for 10 s.

## Known limits / next steps

- Rooms live in memory. Restarting the Node server ends all games. On Cloudflare, a room
  whose object gets evicted (for example, everyone left) starts over empty.
- Free-plan cost: an occupied room keeps its Durable Object awake, which counts toward the
  daily duration allowance. That is plenty for a party game, but not built for heavy traffic.
- No spectator lanes: players who join mid-race watch, then join the next race.
- Balance numbers live in `shared/src/config.ts` (`RACE`).
- Microphone access needs a secure page: the deployed https address or localhost. Over plain
  http (a LAN IP like http://192.168.x.x:5173) browsers hide the mic entirely, and the in-app
  browser pane of some desktop apps blocks capture. The lobby has a "test my voice" check that
  reports exactly which of these is in the way.
