// What one geofence event does to a day's punches (pure). Punches less than a minute apart are one tap to the attendance
// engine (the later one is dropped), so an event that follows another within that minute needs care: a quick return
// cancels the exit, and any punch that must be kept is placed just past the minute.
import { geofenceExitAllowed } from './fieldTracking.js';

export const SAME_TAP_MS = 60 * 1000;   // the attendance engine's double-tap window
export const MIN_DWELL_MS = 5 * 1000;   // an exit this soon after the entry that opened the session is noise

const ms = (p) => Date.parse(p.time);
const sorted = (list) => [...list].sort((a, b) => ms(a) - ms(b));
const place = (punches, atMs, device_direction) => {
  const last = punches[punches.length - 1];
  const t = last ? Math.max(atMs, ms(last) + SAME_TAP_MS + 1) : atMs;
  return [...punches, { time: new Date(t).toISOString(), device_direction }];
};

/**
 * `att` is the stored day (or null), `punches` its punches, `inProgress` whether a session is open, `atMs` the event time
 * (India digits). Returns { punches, openIn, action, reason } — openIn is the time of the entry punch that a later exit
 * may close — or { skip: reason } when the event changes nothing.
 */
export function applyGeofencePunch({ att, punches: given, inProgress, event, atMs, fenceName }) {
  const punches = sorted(given || []);
  const last = punches[punches.length - 1];
  if (last && atMs < ms(last) - SAME_TAP_MS) return { skip: 'stale_event' };

  if (event === 'enter') {
    // back within a minute of walking out: the exit is cancelled and the same session simply continues
    if (!inProgress && att?.check_out_source === 'geofence' && last?.device_direction === 'OUT' && atMs - ms(last) <= SAME_TAP_MS) {
      const kept = punches.slice(0, -1);
      return { punches: kept, openIn: kept[kept.length - 1]?.time || null, action: 'checked_in', reason: 'session_resumed' };
    }
    if (inProgress) {
      // walked from one office to another without ever being outside: the session continues, now at the new office
      if (att?.geofence_location && fenceName && att.geofence_location !== fenceName) return { punches, openIn: att.geofence_open_in || null, action: 'location_transfer' };
      return { skip: 'already_checked_in' };
    }
    const next = place(punches, atMs, 'IN');
    return { punches: next, openIn: next[next.length - 1].time, action: 'checked_in' };
  }

  if (!inProgress) return { skip: punches.length ? 'already_checked_out' : 'not_checked_in' };
  if (att?.geofence_open_in && atMs - Date.parse(att.geofence_open_in) < MIN_DWELL_MS) return { skip: 'too_soon_after_enter' };
  if (!geofenceExitAllowed({ ...att, raw_punches: punches })) return { skip: 'not_geofence_session' };
  return { punches: place(punches, atMs, 'OUT'), openIn: null, action: 'checked_out' };
}
