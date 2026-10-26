import { useEffect, useRef, useState } from 'react';

export const mmss = (s) => { const t = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
// The page counts only while it is visible and in front; the server keeps the authoritative total.
export const pageActive = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();

/**
 * Smooth on-screen clock + heartbeat to the server.
 *  - enabled: run only while true (right person, step open, not paused, not already done)
 *  - startSeconds: what the server already holds
 *  - send(visible): calls the server, returns { seconds, done }
 * Returns { seconds, done, active }. `seconds` is the server value, advanced locally every second while the page is active.
 */
export function useWatchClock({ enabled, startSeconds = 0, send, onDone, everyMs = 10000 }) {
  const [seconds, setSeconds] = useState(startSeconds);
  const [done, setDone] = useState(false);
  const [active, setActive] = useState(pageActive());
  const sendRef = useRef(send); sendRef.current = send;
  const doneRef = useRef(onDone); doneRef.current = onDone;

  useEffect(() => { setSeconds(startSeconds); setDone(false); }, [startSeconds, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stop = false;
    const beat = async () => {
      try {
        const r = await sendRef.current(pageActive());
        if (stop || !r) return;
        setSeconds(r.seconds);
        if (r.done) { setDone(true); doneRef.current?.(r); }
      } catch { /* a missed beat only means a few seconds are not counted */ }
    };
    beat();
    const tick = setInterval(() => { const a = pageActive(); setActive(a); if (a) setSeconds(s => s + 1); }, 1000);
    const hb = setInterval(beat, everyMs);
    const vis = () => { setActive(pageActive()); if (document.visibilityState === 'hidden') beat(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('blur', vis); window.addEventListener('focus', vis);
    return () => { stop = true; clearInterval(tick); clearInterval(hb); document.removeEventListener('visibilitychange', vis); window.removeEventListener('blur', vis); window.removeEventListener('focus', vis); };
  }, [enabled, everyMs]);

  return { seconds, done, active };
}
