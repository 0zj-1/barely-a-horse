import { useState } from 'react';
import { HorseThumb } from '../HorseThumb';
import { drawNew, raceAgain, useStore } from '../store';
import { RoomHeader } from './Lobby';

const TITLES = ['QUESTIONABLE DERBY', 'A RACE OCCURRED', 'THE RESULTS ARE IN (SADLY)', 'HORSE-ADJACENT CHAMPIONSHIP'];

export function Results() {
  const { room, session, drawings } = useStore();
  const [err, setErr] = useState<string | null>(null);
  const [title] = useState(() => TITLES[Math.floor(Math.random() * TITLES.length)]);
  if (!room || !session) return null;
  const results = room.results ?? [];
  const isHost = room.players.find((p) => p.id === session.playerId)?.isHost;
  const host = room.players.find((p) => p.isHost);

  const act = async (fn: () => Promise<string | null>) => {
    setErr(null);
    const e = await fn();
    if (e) setErr(e);
  };

  const podium = [results[1], results[0], results[2]].filter(Boolean);

  return (
    <div className="page">
      <RoomHeader />
      <div className="results">
        <h1 className="title small">{title}</h1>
        <div className="podium">
          {podium.map((r) => (
            <div key={r.playerId} className={`step p${r.place}`}>
              <HorseThumb drawing={drawings[r.playerId]} w={r.place === 1 ? 150 : 110} h={r.place === 1 ? 100 : 74} wiggle={r.place === 1} />
              <div className="block">{r.place}</div>
            </div>
          ))}
        </div>
        <ol className="box ranking">
          {results.map((r) => (
            <li key={r.playerId} className={r.playerId === session.playerId ? 'me' : ''}>
              <span className="place">{r.place}.</span>
              <HorseThumb drawing={drawings[r.playerId]} w={60} h={40} />
              <span className="name">{r.nickname}</span>
              <span className="time">{r.timeMs === null ? 'DNF' : (r.timeMs / 1000).toFixed(2) + 's'}</span>
            </li>
          ))}
        </ol>
        {isHost ? (
          <div className="row">
            <button className="big primary" onClick={() => act(raceAgain)}>
              [ RACE AGAIN ]
            </button>
            <button className="big" onClick={() => act(drawNew)}>
              [ DRAW NEW HORSE ]
            </button>
          </div>
        ) : (
          <p className="hint">waiting for {host?.nickname ?? 'the host'} to pick: race again, or draw new horses.</p>
        )}
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}
