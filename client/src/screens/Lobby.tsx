import { useState } from 'react';
import { ROOM, type PlayerPublic } from '@bah/shared';
import { HorseThumb } from '../HorseThumb';
import { addBot, leaveRoom, removeBot, startDrawing, startRace, useStore } from '../store';

export function PlayerList({ compact = false }: { compact?: boolean }) {
  const { room, drawings, session } = useStore();
  if (!room) return null;
  const iAmHost = room.players.some((p) => p.isHost && p.id === session?.playerId);
  const canEditBots = iAmHost && (room.phase === 'LOBBY' || room.phase === 'RESULTS');
  return (
    <div className="box players">
      <ul>
        {room.players.map((p) => (
          <li key={p.id} className={p.id === session?.playerId ? 'me' : ''}>
            {!compact && (
              <span className="mini">{drawings[p.id] ? <HorseThumb drawing={drawings[p.id]} w={54} h={36} /> : <span className="nohorse">?</span>}</span>
            )}
            <span className="name">
              {p.nickname}
              {p.isHost && <span className="host"> (host)</span>}
              {p.isBot && <span className="host"> (bot)</span>}
              {!p.connected && <span className="gone"> (disconnected)</span>}
            </span>
            <span className={`status s-${p.status}`}>{statusLabel(p)}</span>
            {p.isBot && canEditBots && (
              <button className="link" title="remove bot" onClick={() => removeBot(p.id)}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="count">
        {canEditBots && (
          <button className="link add-bot" disabled={room.players.length >= ROOM.maxPlayers} onClick={() => addBot()}>
            + ADD BOT
          </button>
        )}
        {room.players.length} / {ROOM.maxPlayers} PLAYERS
      </div>
    </div>
  );
}

function statusLabel(p: PlayerPublic) {
  if (p.isBot) return 'BEEP';
  if (p.status === 'WAITING') return 'LURKING';
  return p.status;
}

export function RoomHeader() {
  const { room } = useStore();
  const [copied, setCopied] = useState(false);
  if (!room) return null;
  const copy = () => {
    const url = `${location.origin}${location.pathname}?room=${room.code}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <header className="room-header">
      <span className="logo">BARELY A HORSE</span>
      <span className="room-code">
        ROOM: <b>{room.code}</b>
        <button className="link" onClick={copy}>
          {copied ? 'copied!' : 'copy invite'}
        </button>
      </span>
      <button className="link" onClick={() => leaveRoom()}>
        leave
      </button>
    </header>
  );
}

/** LOBBY and READY share this screen. */
export function Lobby() {
  const { state, room, session, drawings } = useStore();
  const [err, setErr] = useState<string | null>(null);
  if (!room || !session) return null;
  const me = room.players.find((p) => p.id === session.playerId);
  const isHost = !!me?.isHost;
  const host = room.players.find((p) => p.isHost);
  const readyCount = room.players.filter((p) => p.status === 'READY').length;
  const waitingOn = room.players.filter((p) => p.status !== 'READY' && p.connected);
  const botsNeeded = Math.max(0, ROOM.minPlayers - readyCount);
  const hasSeats = room.players.length + botsNeeded <= ROOM.maxPlayers;
  // Short on horses? The server fills the empty lanes with bots.
  const canStart = readyCount >= 1 && waitingOn.length === 0 && hasSeats;
  const spectating = room.phase !== 'LOBBY';

  const start = async () => {
    setErr(null);
    const e = await startRace();
    if (e) setErr(e);
  };

  return (
    <div className="page">
      <RoomHeader />
      <div className="lobby">
        <PlayerList />
        <div className="box lobby-side">
          {state === 'LOBBY' ? (
            <>
              <p>everyone needs a horse.</p>
              <button className="big" onClick={startDrawing}>
                [ DRAW MY HORSE ]
              </button>
            </>
          ) : (
            <>
              <p>this is your horse:</p>
              <HorseThumb drawing={drawings[session.playerId]} w={220} h={146} wiggle />
              <button onClick={startDrawing} disabled={spectating}>
                redraw
              </button>
            </>
          )}
          <hr />
          {isHost ? (
            <>
              <button className="big primary" disabled={!canStart} onClick={start}>
                [ START RACE ]
              </button>
              <p className="hint">
                {readyCount === 0
                  ? 'draw your horse first (or share the room code)'
                  : waitingOn.length
                    ? `waiting on: ${waitingOn.map((p) => p.nickname).join(', ')}`
                    : botsNeeded > 0
                      ? `not enough horses: ${botsNeeded} bot${botsNeeded > 1 ? 's' : ''} will join the race`
                      : 'all horses ready. probably.'}
              </p>
            </>
          ) : (
            <p className="hint">waiting for {host?.nickname ?? 'the host'} to start the race…</p>
          )}
          {err && <p className="error">{err}</p>}
        </div>
      </div>
    </div>
  );
}
