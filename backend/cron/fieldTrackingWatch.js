// Watches active Field Duty sessions. When the phone has gone quiet (never opened the app, app force-stopped, permission lost),
// the employee gets a push notification (shown even with the app closed and the phone locked); tapping it opens the app, which
// starts the phone's background recorder. Eligibility is re-checked every time: nobody HR has switched off is ever nudged.
import { all, one, run } from '../db.js';
import { sendPushToUser, sendFieldDutyWake } from '../utils/push.js';
import { nudgeDue, wakeDue, sessionCloseReason, sessionEndMs, normalizeConfig, attendanceSyncAction } from '../utils/fieldTracking.js';
import { saveFieldDaySummary } from './fieldDayStore.js';
import { randomUUID } from 'node:crypto';
import { keyedLock } from '../utils/keyedLock.js';

const state = new Map();   // visible reminders
const wakeState = new Map();   // silent wake pushes   // trip id -> { count, lastMs }   (in memory: a restart simply allows one more reminder)

// Closes sessions that must not stay open: the employee is not enabled for tracking, or the session outlived the maximum length.
// Sessions left open for weeks had kept recording phones long after the trip; an old closed session is also blocked from
// reimbursement claims and marked for HR review, because its distance may have accumulated over days.
export async function closeInvalidFieldSessions(nowMs = Date.now()) {
  const trips = await all("SELECT id,user_id,data FROM entities WHERE type='FieldTrip' AND data::jsonb->>'status'='active'");
  if (!trips.length) return { closed: 0 };
  let cfgRaw = null; try { const r = await one("SELECT value FROM settings WHERE key='field_tracking_config'"); cfgRaw = r ? JSON.parse(r.value) : null; } catch { cfgRaw = null; }
  const cfg = normalizeConfig(cfgRaw);
  const eligible = new Set();
  for (const r of await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")) {
    try { if (JSON.parse(r.data).field_duty_tracking_eligible) eligible.add(r.user_id); } catch { /* skip */ }
  }
  let closed = 0;
  for (const r of trips) {
    let t; try { t = JSON.parse(r.data); } catch { continue; }
    const why = sessionCloseReason(t, eligible.has(r.user_id), nowMs, cfg);
    if (!why) continue;
    const rel = await keyedLock('ft:' + t.id);
    try {
    const fresh = await one("SELECT data FROM entities WHERE id=$1 AND type='FieldTrip'", [r.id]);   // re-read under the lock: points may have arrived meanwhile
    if (fresh) { try { t = JSON.parse(fresh.data); } catch { /* keep */ } }
    if (!t || t.status !== 'active') continue;
    const endMs = sessionEndMs(t, cfg);
    const old = nowMs - (Date.parse(t.start_time) || nowMs) > 48 * 3600000;
    const upd = { ...t, status: 'completed', end_time: new Date(endMs).toISOString(), auto_closed: true, auto_closed_reason: why.text, auto_closed_by: 'system', needs_review: true, ...(old ? { claim_blocked: true } : {}) };
    await run("UPDATE entities SET data=$1, status='completed' WHERE id=$2", [JSON.stringify(upd), r.id]);
    saveFieldDaySummary(r.user_id, t.date).catch(() => {});
    closed++;
    } finally { rel(); }
  }
  if (closed) console.log('[field-sessions] closed ' + closed + ' session(s) that were not allowed to stay open');
  return { closed };
}

// Tracking begins at OD check-in and ends at OD check-out. markSelfieAttendance does this at the moment of the punch; this sync covers
// everything else (an OD day started or ended another way — HR, the gate, a missed request) and a phone that never got the signal.
// Attendance times are stored as IST digits, so a stored check-out is converted back to a real instant before it is used.
export async function syncODFieldSessions(nowMs = Date.now()) {
  const today = new Date(nowMs + 5.5 * 3600000).toISOString().slice(0, 10);
  const eligible = new Set();
  for (const r of await all("SELECT user_id,data FROM entities WHERE type='Employee' AND status='active'")) {
    try { if (JSON.parse(r.data).field_duty_tracking_eligible) eligible.add(r.user_id); } catch { /* skip */ }
  }
  const attByUserDate = new Map();
  const active0 = await all("SELECT user_id FROM entities WHERE type='FieldTrip' AND data::jsonb->>'status'='active'");
  const relevant = [...new Set([...eligible, ...active0.map(r => r.user_id)])];
  const attRows = relevant.length
    ? await all("SELECT id,user_id,data FROM entities WHERE type='Attendance' AND user_id = ANY($1) AND data::jsonb->>'date' >= $2", [relevant, new Date(nowMs + 5.5 * 3600000 - 2 * 86400000).toISOString().slice(0, 10)])
    : [];
  for (const r of attRows) { try { const d = JSON.parse(r.data); attByUserDate.set(r.user_id + '|' + d.date, { id: r.id, ...d }); } catch { /* skip */ } }
  const active = new Map();
  for (const r of await all("SELECT id,user_id,data FROM entities WHERE type='FieldTrip' AND data::jsonb->>'status'='active'")) { try { active.set(r.user_id, { rowId: r.id, ...JSON.parse(r.data) }); } catch { /* skip */ } }
  let started = 0, stopped = 0;
  const users = new Set([...eligible, ...[...active.keys()]]);
  for (const uid of users) {
    const trip = active.get(uid) || null;
    const att = attByUserDate.get(uid + '|' + (trip?.date || today)) || (trip ? null : attByUserDate.get(uid + '|' + today)) || null;
    const act = attendanceSyncAction({ eligible: eligible.has(uid), attendance: att, activeTrip: trip });
    if (act.action === 'start') {
      const relS = await keyedLock('ftstart:' + uid);
      try {
      if (await one("SELECT id FROM entities WHERE type='FieldTrip' AND user_id=$1 AND data::jsonb->>'status'='active'", [uid])) continue;   // someone just opened one
      const id = randomUUID();
      const ft = { id, user_id: uid, date: today, start_time: new Date(nowMs).toISOString(), status: 'active', vehicle_type: '2_wheeler', duty_basis: 'od_attendance',
        purpose: 'Outduty (started automatically at OD check-in)', points: [], distance_km: 0, point_count: 0, toll_parking_amount: 0, source: 'od_attendance', linked_attendance_id: att.id };
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'FieldTrip',$2,'active',$3)", [id, uid, JSON.stringify(ft)]);
      started++;
      } finally { relS(); }
    } else if (act.action === 'stop' && trip) {
      let endMs = nowMs;
      const co = att?.check_out_time ? Date.parse(att.check_out_time) - 5.5 * 3600000 : NaN;
      if (Number.isFinite(co) && co <= nowMs) endMs = co;
      endMs = Math.max(endMs, Date.parse(trip.start_time) || 0);
      const relT = await keyedLock('ft:' + trip.id);
      try {
      const fresh = await one("SELECT data FROM entities WHERE id=$1 AND type='FieldTrip'", [trip.rowId]);
      const { rowId, ...doc } = fresh ? { rowId: trip.rowId, ...JSON.parse(fresh.data) } : trip;
      if (doc.status !== 'active') continue;
      await run("UPDATE entities SET data=$1, status='completed' WHERE id=$2", [JSON.stringify({ ...doc, status: 'completed', end_time: new Date(endMs).toISOString(), auto_closed: true, auto_closed_reason: act.reason, auto_closed_by: 'od_sync' }), rowId]);
      saveFieldDaySummary(uid, trip.date).catch(() => {});
      stopped++;
      } finally { relT(); }
    }
  }
  if (started || stopped) console.log('[field-od-sync] started ' + started + ', stopped ' + stopped);
  return { started, stopped };
}

export async function nudgeSilentFieldSessions(nowMs = Date.now()) {
  await closeInvalidFieldSessions(nowMs).catch(e => console.warn('[field-sessions] close failed:', e.message));
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
