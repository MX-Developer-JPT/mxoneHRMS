// Watches active Field Duty sessions. When the phone has gone quiet (never opened the app, app force-stopped, permission lost),
// the employee gets a push notification (shown even with the app closed and the phone locked); tapping it opens the app, which
// starts the phone's background recorder. Eligibility is re-checked every time: nobody HR has switched off is ever nudged.
import { all, one } from '../db.js';
import { sendPushToUser, sendFieldDutyWake } from '../utils/push.js';
import { nudgeDue, wakeDue } from '../utils/fieldTracking.js';

const state = new Map();   // visible reminders
const wakeState = new Map();   // silent wake pushes   // trip id -> { count, lastMs }   (in memory: a restart simply allows one more reminder)

export async function nudgeSilentFieldSessions(nowMs = Date.now()) {
  const trips = await all("SELECT user_id,data FROM entities WHERE type='FieldTrip' AND data::jsonb->>'status'='active'");
  if (!trips.length) return { checked: 0, nudged: 0, woken: 0 };
  const eligible = new Set();
  for (const r of await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")) {
    try { if (JSON.parse(r.data).field_duty_tracking_eligible) eligible.add(r.user_id); } catch { /* skip */ }
  }
  let nudged = 0, woken = 0;
  for (const r of trips) {
    let t; try { t = JSON.parse(r.data); } catch { continue; }
    if (!eligible.has(r.user_id)) continue;
    const ws = wakeState.get(t.id);
    if (wakeDue(t, ws, nowMs)) {
      await sendFieldDutyWake(r.user_id, t.id).catch(() => null);   // starts native recording on an Android phone without opening the app
      wakeState.set(t.id, { count: (ws?.count || 0) + 1, lastMs: nowMs }); woken++;
    }
    const st = state.get(t.id);
    if (!nudgeDue(t, st, nowMs)) continue;
    let locOff = false;
    try { const dv = await one("SELECT data FROM entities WHERE id=$1 AND type='TrackingDevice'", ['td-' + r.user_id]); locOff = !!dv && (JSON.parse(dv.data).problems || []).length > 0; } catch { /* unknown */ }
    await sendPushToUser(r.user_id, {
      title: locOff ? 'Location is switched off for Maxvolt One' : 'Field Duty tracking needs your phone',
      message: locOff
        ? 'Your field duty is not being recorded. Open Maxvolt One and turn location back on (Allow all the time).'
        : 'Open Maxvolt One now so your location can be recorded for today\'s field duty. Keep location on "Allow all the time".',
      link: '/FieldDuty', type: 'warning',
    });
    state.set(t.id, { count: (st?.count || 0) + 1, lastMs: nowMs });
    nudged++;
  }
  return { checked: trips.length, nudged, woken };
}
