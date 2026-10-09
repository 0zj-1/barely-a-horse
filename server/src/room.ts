import {
  BOT_NAMES,
  RACE,
  ROOM,
  botDrawing,
  canPhaseTransition,
  type Drawing,
  type PlayerId,
  type PlayerPublic,
  type PlayerStatus,
  type RaceResult,
  type RoomPhase,
  type Obstacle,
  type Pose,
  type RoomSnapshot,
  type ServerEventData,
  type ServerEventName,
} from '@bah/shared';
import { BotDriver } from './bots';
import { randomId, randomToken } from './ids';
import { RaceSim, makeObstacles } from './race';

/**
 * One client connection, whatever the transport (Node `ws` or a Durable Object
 * WebSocket). The room only needs to send to it and, rarely, close it.
 */
export interface Conn {
  readonly id: string;
  /** The player this connection speaks for, once joined. */
  playerId: PlayerId | null;
  send<K extends ServerEventName>(t: K, d: ServerEventData<K>): void;
  ack(id: number, d: unknown): void;
  close(code: number, reason: string): void;
}

type Timer = ReturnType<typeof setTimeout>;

interface Player {
  id: PlayerId;
  token: string;
  nickname: string;
  status: PlayerStatus;
  drawing: Drawing | null;
  /** Active connection, or null while disconnected. */
  connId: string | null;
  disconnectedAt: number | null;
  joinedAt: number;
  /** Bots have no socket and are never "disconnected". */
  isBot: boolean;
}

export class Room {
  phase: RoomPhase = 'LOBBY';
  players = new Map<PlayerId, Player>();
  hostId: PlayerId | null = null;
  racers: PlayerId[] = [];
  obstacles: Obstacle[] = [];
  race: RaceSim | null = null;
  private bots: BotDriver | null = null;
  results: RaceResult[] | null = null;
  emptySince: number | null = null;
  private timer: Timer | null = null;
  private resultsTimer: Timer | null = null;
  private sweepTimer: Timer | null = null;
  /** Connections attached to a player in this room. */
  private members = new Map<string, Conn>();

  constructor(readonly code: string) {}

  private emit<K extends ServerEventName>(t: K, d: ServerEventData<K>) {
    for (const c of this.members.values()) c.send(t, d);
  }

  connOf(playerId: PlayerId): Conn | undefined {
    const id = this.players.get(playerId)?.connId;
    return id ? this.members.get(id) : undefined;
  }

  // ---------- players ----------

  addPlayer(nickname: string, isBot = false): Player {
    const p: Player = {
      id: randomId(),
      token: randomToken(),
      nickname,
      status: 'WAITING',
      drawing: null,
      connId: null,
      disconnectedAt: null,
      joinedAt: Date.now(),
      isBot,
    };
    this.players.set(p.id, p);
    if (!this.hostId && !isBot) this.hostId = p.id;
    // Drop timed-out players every couple of seconds while anyone is here.
    this.sweepTimer ??= setInterval(() => this.sweep(Date.now()), 2_000);
    return p;
  }

  private humans() {
    return [...this.players.values()].filter((p) => !p.isBot);
  }

  private botsInRoom() {
    return [...this.players.values()].filter((p) => p.isBot);
  }

  // ---------- bots ----------

  /** Adds a ready-to-race bot. Returns an error string on failure. */
  private spawnBot(): string | null {
    if (this.isFull()) return 'room is full';
    const taken = new Set([...this.players.values()].map((p) => p.nickname.toLowerCase()));
    let name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase()));
    for (let i = 2; !name; i++) if (!taken.has(`bot #${i}`)) name = `Bot #${i}`;
    const bot = this.addPlayer(name, true);
    bot.status = 'READY';
    bot.drawing = botDrawing();
    this.emit('drawing:update', { playerId: bot.id, drawing: bot.drawing });
    return null;
  }

  addBot(byId: PlayerId): string | null {
    if (byId !== this.hostId) return 'only the host can add bots';
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return 'wait for the race to finish';
    const err = this.spawnBot();
    if (!err) this.broadcast();
    return err;
  }

  removeBot(byId: PlayerId, botId: PlayerId): string | null {
    if (byId !== this.hostId) return 'only the host can remove bots';
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return 'wait for the race to finish';
    if (!this.players.get(botId)?.isBot) return 'that is not a bot';
    this.removePlayer(botId);
    return null;
  }

  /** Frees a seat for a human by dropping a bot (only between races). */
  bumpBotForHuman(): boolean {
    if (this.phase !== 'LOBBY' && this.phase !== 'RESULTS') return false;
    const bot = this.botsInRoom().pop();
    if (!bot) return false;
    this.removePlayer(bot.id);
    return true;
  }

  attach(p: Player, conn: Conn) {
    p.connId = conn.id;
    p.disconnectedAt = null;
    this.emptySince = null;
    conn.playerId = p.id;
    this.members.set(conn.id, conn);
    const all: Record<PlayerId, Drawing> = {};
    for (const q of this.players.values()) if (q.drawing) all[q.id] = q.drawing;
    conn.send('drawing:all', all);
    this.broadcast();
  }

  /** A connection went away (or was replaced). */
  detach(conn: Conn) {
    this.members.delete(conn.id);
    const p = conn.playerId ? this.players.get(conn.playerId) : undefined;
    conn.playerId = null;
    if (!p || p.connId !== conn.id) return;
    p.connId = null;
    p.disconnectedAt = Date.now();
    this.broadcast();
  }

  removePlayer(playerId: PlayerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    const conn = p.connId ? this.members.get(p.connId) : undefined;
    if (conn) {
      this.members.delete(conn.id);
      conn.playerId = null;
    }
    this.players.delete(playerId);
    this.emit('drawing:update', { playerId, drawing: null });
    if (this.hostId === playerId) this.pickNewHost();
    // A racer leaving mid-race keeps their horse running (it's in RaceSim already).
    if (this.phase === 'COUNTDOWN') {
      this.racers = this.racers.filter((id) => id !== playerId);
      if (this.racers.length < ROOM.minPlayers) this.abortToLobby();
    }
    // Bots don't keep a room alive.
    if (this.humans().length === 0) {
      for (const b of this.botsInRoom()) this.players.delete(b.id);
      this.clearTimers();
      if (this.sweepTimer) clearInterval(this.sweepTimer);
      this.sweepTimer = null;
      this.emptySince = Date.now();
    }
    this.broadcast();
  }

  private pickNewHost() {
    const candidates = this.humans().sort((a, b) => a.joinedAt - b.joinedAt);
    this.hostId = (candidates.find((p) => p.connId) ?? candidates[0])?.id ?? null;
  }

  /** Called periodically: drop players whose grace period ran out, migrate host. */
  sweep(now: number) {
    for (const p of [...this.players.values()]) {
      if (p.disconnectedAt !== null && now - p.disconnectedAt > ROOM.reconnectGraceMs) {
        // Don't yank someone out of a running race; they'll be removed once it ends.
        if (this.phase === 'RACING' && this.racers.includes(p.id)) continue;
        this.removePlayer(p.id);
      }
    }
    const host = this.hostId ? this.players.get(this.hostId) : null;
    if (host && !host.connId && host.disconnectedAt && now - host.disconnectedAt > 10_000) {
      const other = [...this.players.values()].find((p) => p.connId);
      if (other) {
        this.hostId = other.id;
        this.broadcast();
      }
    }
  }

  isFull() {
    return this.players.size >= ROOM.maxPlayers;
  }

  nicknameTaken(nick: string) {
    const n = nick.toLowerCase();
    return [...this.players.values()].some((p) => p.nickname.toLowerCase() === n);
  }

  // ---------- drawing ----------

  startDrawing(playerId: PlayerId) {
    const p = this.players.get(playerId);
    if (!p || p.status === 'DRAWING') return;
    // You can (re)draw any time you're not in a live race.
    if (this.racers.includes(playerId) && (this.phase === 'COUNTDOWN' || this.phase === 'RACING')) return;
    p.status = 'DRAWING';
    this.broadcast();
  }

  submitDrawing(playerId: PlayerId, drawing: Drawing): string | null {
    const p = this.players.get(playerId);
    if (!p) return 'not in room';
    if (p.status !== 'DRAWING') return 'not drawing right now';
    p.drawing = drawing;
    p.status = 'READY';
    this.emit('drawing:update', { playerId, drawing });
    this.broadcast();
    return null;
  }

  // ---------- race flow ----------

  private setPhase(to: RoomPhase) {
    if (!canPhaseTransition(this.phase, to)) {
      throw new Error(`invalid phase transition ${this.phase} -> ${to}`);
    }
    this.phase = to;
  }

  private eligibleRacers() {
    return [...this.players.values()]
      .filter((p) => p.status === 'READY' && p.drawing)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }

  startRace(byId: PlayerId): string | null {
    if (byId !== this.hostId) return 'only the host can start the race';
    if (this.phase !== 'LOBBY') return 'race already going';
    const everyone = [...this.players.values()];
    const notReady = everyone.filter((p) => p.status !== 'READY' && p.connId && !p.isBot);
    if (notReady.length) return `still waiting on ${notReady.map((p) => p.nickname).join(', ')}`;
    return this.beginCountdown();
  }

  raceAgain(byId: PlayerId): string | null {
    if (byId !== this.hostId) return 'only the host can do that';
    if (this.phase !== 'RESULTS') return 'not at results';
    return this.beginCountdown();
  }

  drawNew(byId: PlayerId): string | null {
    if (byId !== this.hostId) return 'only the host can do that';
    if (this.phase !== 'RESULTS') return 'not at results';
    this.clearTimers();
    this.setPhase('LOBBY');
    this.race = null;
    this.results = null;
    this.racers = [];
    this.obstacles = [];
    for (const p of this.players.values()) {
      p.drawing = p.isBot ? botDrawing() : null;
      p.status = p.isBot ? 'READY' : 'DRAWING';
      this.emit('drawing:update', { playerId: p.id, drawing: p.drawing });
    }
    this.broadcast();
    return null;
  }

  private beginCountdown(): string | null {
    // Not enough horses? Fill the empty lanes with bots.
    const missing = ROOM.minPlayers - this.eligibleRacers().length;
    if (missing > 0 && this.eligibleRacers().length === 0) return 'draw a horse first';
    for (let i = 0; i < missing; i++) {
      const err = this.spawnBot();
      if (err) return `need at least ${ROOM.minPlayers} horses`;
    }
    const racers = this.eligibleRacers();
    this.clearTimers();
    this.setPhase('COUNTDOWN');
    this.racers = racers.map((p) => p.id);
    this.results = null;
    const startAt = Date.now() + RACE.countdownMs;
    this.obstacles = makeObstacles();
    this.race = new RaceSim(
      racers.map((p) => ({ id: p.id, nickname: p.nickname })),
      startAt,
      (e) => this.emit('race:event', e),
      this.obstacles,
    );
    this.bots = new BotDriver(racers.filter((p) => p.isBot).map((p) => p.id));
    this.broadcast();
    this.startLoop();
    return null;
  }

  private abortToLobby() {
    this.clearTimers();
    this.setPhase('LOBBY');
    this.race = null;
    this.racers = [];
  }

  private startLoop() {
    const dtMs = 1000 / RACE.tickHz;
    let last = Date.now();
    this.timer = setInterval(() => {
      const race = this.race;
      if (!race) return;
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;

      if (this.phase === 'COUNTDOWN' && now >= race.startAt) {
        this.setPhase('RACING');
        this.broadcast();
      }
      if (this.phase !== 'RACING') return;

      this.bots?.update(now, race);
      const running = race.step(now, dt);
      this.emit('race:tick', race.tick(now));
      if (!running && !this.resultsTimer) {
        // Let the last horse cross the line on screen before the podium.
        this.resultsTimer = setTimeout(() => this.finishRace(), RACE.resultsDelayMs);
      }
    }, dtMs);
  }

  private finishRace() {
    if (!this.race || this.phase !== 'RACING') return;
    this.clearTimers();
    this.results = this.race.results();
    this.setPhase('RESULTS');
    this.broadcast();
    // Now it's safe to drop racers who disconnected long ago.
    this.sweep(Date.now());
  }

  press(playerId: PlayerId) {
    if (this.phase === 'RACING' && this.race) this.race.press(playerId, Date.now());
  }

  shout(playerId: PlayerId, level: number, pitchHz?: number, pitchBase?: number) {
    if (this.phase === 'RACING' && this.race) this.race.shout(playerId, level, Date.now(), pitchHz, pitchBase);
  }

  setPose(playerId: PlayerId, pose: Pose) {
    if (this.phase === 'RACING' && this.race) this.race.setPose(playerId, pose, Date.now());
  }

  private clearTimers() {
    if (this.timer) clearInterval(this.timer);
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.timer = null;
    this.resultsTimer = null;
  }

  dispose() {
    this.clearTimers();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  // ---------- snapshots ----------

  snapshot(): RoomSnapshot {
    const players: PlayerPublic[] = [...this.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        status: p.status,
        connected: p.isBot || p.connId !== null,
        isHost: p.id === this.hostId,
        hasDrawing: p.drawing !== null,
        isBot: p.isBot,
      }));
    return {
      code: this.code,
      phase: this.phase,
      players,
      racers: this.racers,
      raceStartAt: this.race?.startAt ?? null,
      results: this.results,
      obstacles: this.obstacles,
      serverNow: Date.now(),
    };
  }

  broadcast() {
    this.emit('room:state', this.snapshot());
  }
}
