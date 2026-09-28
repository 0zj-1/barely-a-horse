import { useState } from 'react';
import { ROOM } from '@bah/shared';
import { backHome, createRoom, joinRoom, openJoin, useStore } from '../store';

const NICK_KEY = 'bah.nick';
const inviteCode = () => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';

export function Home() {
  const { notice } = useStore();
  return (
    <div className="center-col">
      <h1 className="title">
        BARELY
        <br />A HORSE
      </h1>
      <p className="tag">draw a horse. race it. regret it.</p>
      <div className="stack">
        <button className="big" onClick={() => openJoin('create')}>
          [ CREATE ROOM ]
        </button>
        <button className="big" onClick={() => openJoin('join')}>
          [ JOIN ROOM ]
        </button>
      </div>
      {notice && <p className="notice">{notice}</p>}
    </div>
  );
}

export function Joining() {
  const { joinMode } = useStore();
  const [nick, setNick] = useState(() => localStorage.getItem(NICK_KEY) ?? '');
  const [code, setCode] = useState(inviteCode);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (joinMode === 'resume') {
    return (
      <div className="center-col">
        <h1 className="title small">BARELY A HORSE</h1>
        <p className="blink">finding your horse…</p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    localStorage.setItem(NICK_KEY, nick.trim());
    const error = joinMode === 'create' ? await createRoom(nick) : await joinRoom(code, nick);
    setBusy(false);
    if (error) setErr(error);
  };

  const valid = nick.trim().length > 0 && (joinMode === 'create' || code.trim().length === ROOM.codeLength);

  return (
    <div className="center-col">
      <h1 className="title small">BARELY A HORSE</h1>
      <form className="box form" onSubmit={submit}>
        <h2>{joinMode === 'create' ? 'NEW ROOM' : 'JOIN ROOM'}</h2>
        {joinMode === 'join' && (
          <label>
            room code
            <input
              className="code-input"
              value={code}
              maxLength={ROOM.codeLength}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="H7K2QF"
              autoFocus={!code}
            />
          </label>
        )}
        <label>
          your name
          <input
            value={nick}
            maxLength={ROOM.maxNicknameLength}
            onChange={(e) => setNick(e.target.value)}
            placeholder="horse owner"
            autoFocus={joinMode === 'create' || !!code}
          />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button type="button" onClick={backHome}>
            back
          </button>
          <button type="submit" className="primary" disabled={!valid || busy}>
            {busy ? '…' : joinMode === 'create' ? 'CREATE' : 'JOIN'}
          </button>
        </div>
      </form>
    </div>
  );
}
