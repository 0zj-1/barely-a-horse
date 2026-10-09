import { useEffect, useRef, useState } from 'react';
import { poseForVoice, type Pose } from '@bah/shared';
import { micBlockedReason, startMic, MicError, type Mic } from './net/mic';

const LABEL: Record<Pose, string> = {
  DUCK: 'DUCK (low voice)',
  RUN: 'RUN (louder = faster)',
  JUMP: 'JUMP (loud)',
  BIGJUMP: 'BIG JUMP (very loud)',
};

/** Lets players check their microphone — and see the poses — before a race starts. */
export function MicCheck() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>('RUN');
  const [pitch, setPitch] = useState(0);
  const [base, setBase] = useState(0);
  const micRef = useRef<Mic | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      micRef.current?.stop();
      micRef.current = null;
    },
    [],
  );

  const toggle = async () => {
    setError(null);
    if (micRef.current) {
      micRef.current.stop();
      micRef.current = null;
      setOn(false);
      return;
    }
    try {
      micRef.current = await startMic(({ level, pitch, base }) => {
        if (barRef.current) barRef.current.style.width = `${level * 100}%`;
        setPose(poseForVoice(level, pitch, base));
        setPitch(pitch);
        setBase(base);
      });
      setOn(true);
      localStorage.setItem('bah.mic', 'on'); // the race screen picks this up
    } catch (e) {
      setError(e instanceof MicError ? `${e.message} — ${e.fix}` : 'could not use the microphone');
    }
  };

  const blocked = micBlockedReason();

  return (
    <div className="mic-check">
      <button onClick={toggle} disabled={!!blocked}>
        {on ? '🎤 stop mic check' : '🎤 test my voice'}
      </button>
      {on && (
        <>
          <div className="bar">
            <div ref={barRef} className="fill voice" />
          </div>
          <p className="hint">
            {LABEL[pose]}
            {pitch > 0 && ` · ${pitch}Hz`}
            {base > 0 && ` (your normal ≈ ${base}Hz)`}
          </p>
        </>
      )}
      {(error || blocked) && <p className="error">{error ?? `${blocked!.message} — ${blocked!.fix}`}</p>}
    </div>
  );
}
