// Trusted clock. The app must never take "now" from the phone's own clock — changing the
// device date/time (or a wrong time zone setting) used to change check-in times, "today",
// late marks and everything else. Instead, the server's clock (NTP-synchronised, UTC) is
// fetched and the difference to the device clock is applied to EVERY `new Date()` /
// `Date.now()` in the app by wrapping the global Date once, here.
//
// Dates created from an explicit value (new Date('2026-10-07'), new Date(ms), …) are left
// untouched — only "what time is it right now" is corrected.

const RealDate = Date;
let offsetMs = 0;
let synced = false;

function SyncedDate(...args) {
  if (!new.target) return new RealDate(RealDate.now() + offsetMs).toString(); // Date() called as a function
  return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offsetMs);
}
SyncedDate.prototype = RealDate.prototype;           // instanceof Date keeps working for every date
Object.setPrototypeOf(SyncedDate, RealDate);          // Date.parse / Date.UTC stay available
SyncedDate.now = () => RealDate.now() + offsetMs;
Object.defineProperty(SyncedDate, 'name', { value: 'Date' });
globalThis.Date = SyncedDate;

export const isTimeSynced = () => synced;
export const getClockOffsetMs = () => offsetMs;

async function sample() {
  const t0 = RealDate.now();
  const res = await fetch('/api/time?_=' + t0, { cache: 'no-store' });
  const t1 = RealDate.now();
  if (!res.ok) throw new Error('time ' + res.status);
  const { server_time } = await res.json();
  if (!Number.isFinite(server_time)) throw new Error('bad time');
  return { rtt: t1 - t0, offset: server_time + (t1 - t0) / 2 - t1 };
}

/** Fetches the server time (best of 3 samples, lowest latency wins) and corrects the app clock. */
export async function syncTime() {
  try {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      try { samples.push(await sample()); } catch { /* try the next one */ }
    }
    if (!samples.length) return false;
    samples.sort((a, b) => a.rtt - b.rtt);
    offsetMs = Math.round(samples[0].offset);
    synced = true;
    return true;
  } catch { return false; }
}

// Keep the clock honest for the life of the app: periodically, when the app returns to the
// foreground, and when the connection comes back (a device clock can be changed any time).
let timer = null;
export function startTimeSyncLoop() {
  if (timer) return;
  timer = setInterval(syncTime, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncTime(); });
  window.addEventListener('online', syncTime);
}
