// Makes sure EVERY biometric punch that belongs to an employee is on that employee's attendance record.
//
// Every machine punch is stored as an AttendanceLog first. A punch can still fail to reach the day's Attendance row: the
// employee's code was mapped later, the row was created later, the day was a muster-imported / regularised / leave day, the
// shift crosses midnight, a selfie side was protected, a transient error... This walks the logs, finds each punch that is not
// on its day's record, and puts it there:
//   • no record for that day          → the record is created from the day's punches
//   • normal day                      → punches merged, sessions / hours / status recomputed
//   • frozen day (regularised, admin-marked, leave, gate-pass half day, or a side captured by selfie / geofence)
//                                     → the punch is KEPT on the record (biometric_punches); the summary stays as set
//   • day whose status was set by HR (muster import, holiday, week off, on duty, WFH)
//                                     → punches, sessions and in/out times are filled in; the status is NOT changed
// Each log is then stamped (applied_to / applied_at, user_id, off_role=false) so "unprocessed" is a definite, countable thing.
// Idempotent: a second run finds nothing to do. Punches within 60 s of an already recorded one are double taps (the same
// rule buildSessions applies) and count as applied.
import { v4 as uuidv4 } from 'uuid';
import { all, one, run } from '../db.js';
import { buildSessions, closeTrailingOpenSession, computeStatusFromSessions, applyDeclaredStatus, applyHalfDayLeaveStatus, getHalfDayOverrideHours, getShift, EARLY_MORNING_CUTOFF_HOUR } from '../routes/attendancelog.js';

const DUP_MS = 60 * 1000;
const iso = (t) => String(t || '').trim().replace(' ', 'T');
const ms = (t) => new Date(iso(t)).getTime();
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const prevDay = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// every punch time already carried by a day record, wherever it is kept
function recordedTimes(d) {
  const out = [];
  for (const p of [...(d.raw_punches || []), ...(d.biometric_punches || [])]) if (p?.time) out.push(ms(p.time));
  for (const t of [d.check_in_time, d.check_out_time]) if (t) out.push(ms(t));
  for (const s of d.sessions || []) { if (s.check_in) out.push(ms(s.check_in)); if (s.check_out) out.push(ms(s.check_out)); }
  for (const s of d.punch_sessions || []) { if (s.punch_in) out.push(ms(s.punch_in)); if (s.punch_out) out.push(ms(s.punch_out)); }
  return out.filter(n => !Number.isNaN(n));
}
const hasPunch = (d, t) => !!d && recordedTimes(d).some(x => Math.abs(x - t) < DUP_MS);

const isFrozen = (d) => !!(d.regularised || d.admin_marked || d.status === 'leave' || (d.leave_id && !d.leave_half_day) || d.gate_pass_half_day);
const isHrSetStatus = (d) => /^imported from muster/i.test(String(d.notes || '')) || ['holiday', 'week_off', 'weekly_off', 'on_duty', 'work_from_home', 'on_leave'].includes(d.status);

/**
 * @param {{from?:string,to?:string,codes?:string[],apply?:boolean}} opts   dates are yyyy-MM-dd (IST); codes limits to those biometric codes
 */
export async function reconcileBiometricPunches({ from, to, codes, apply = false, backupFile } = {}) {
  const stats = { logs_scanned: 0, off_role_unmapped: 0, placeholder_skipped: 0, already_applied: 0, relinked_logs: 0, punches_missing: 0,
    days_created: 0, days_merged: 0, days_kept_only: 0, days_hr_status_kept: 0, status_changes: 0, errors: 0, apply };
  const samples = { status_changes: [], unmapped_codes: {} };
  const today = istToday();

  const wanted = codes?.length ? new Set(codes.map(c => String(c).trim().toUpperCase())) : null;
  const conds = ["type='AttendanceLog'"], params = [];
  if (from) { params.push(from); conds.push(`data::jsonb->>'LogDate' >= $${params.length}`); }
  if (to) { const x = new Date(to + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); params.push(x.toISOString().slice(0, 10)); conds.push(`data::jsonb->>'LogDate' < $${params.length}`); }
  if (wanted) { params.push([...wanted]); conds.push(`UPPER(TRIM(data::jsonb->>'EmployeeCode')) = ANY($${params.length})`); }
  const logRows = await all(`SELECT id, data FROM entities WHERE ${conds.join(' AND ')}`, params);

  const emps = (await all("SELECT user_id, data FROM entities WHERE type='Employee'")).map(r => ({ user_id: r.user_id, ...JSON.parse(r.data) }));
  const empByUser = new Map(emps.filter(e => e.user_id).map(e => [e.user_id, e]));
  const codeToUser = new Map();
  for (const e of emps) if (e.user_id) for (const k of [e.employee_code, e.biometric_id]) if (k) codeToUser.set(String(k).trim().toUpperCase(), e.user_id);
  for (const r of await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'")) { const m = JSON.parse(r.data); if (m.biometric_code && m.user_id) codeToUser.set(String(m.biometric_code).trim().toUpperCase(), m.user_id); }

  // punches per employee
  const byUser = new Map();
  let minDate = '9999', maxDate = '0000';
  for (const r of logRows) {
    const l = JSON.parse(r.data); stats.logs_scanned++;
    const code = String(l.EmployeeCode || '').trim().toUpperCase();
    if (wanted && !wanted.has(code)) continue;
    const t = iso(l.LogDate);
    if (!t || Number.isNaN(ms(t))) continue;
    if (/T00:00:00(\.000)?Z?$/.test(t)) { stats.placeholder_skipped++; continue; }
    const uid = l.user_id || codeToUser.get(code) || null;
    if (!uid || !empByUser.has(uid)) { stats.off_role_unmapped++; samples.unmapped_codes[code] = (samples.unmapped_codes[code] || 0) + 1; continue; }
    const date = t.slice(0, 10); if (date < minDate) minDate = date; if (date > maxDate) maxDate = date;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push({ logId: r.id, log: l, t, tms: ms(t), date, dir: ['OUT', 'EXIT'].includes(String(l.Direction || 'IN').toUpperCase()) ? 'OUT' : 'IN' });
  }
  if (!byUser.size) return { stats, samples };

  // every attendance row in the window (one query), kept in memory and updated as we go
  const rows = new Map();
  for (const r of await all("SELECT id, user_id, data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [prevDay(minDate), (() => { const x = new Date(maxDate + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })()])) {
    const d = JSON.parse(r.data); rows.set(`${r.user_id}|${d.date}`, { id: r.id, d, dirty: false, orig: r.data });
  }

  const backup = {};
  const shiftCache = new Map(), halfCache = new Map();
  const shiftFor = async (emp) => { const k = emp?.shift_id || 'default'; if (!shiftCache.has(k)) shiftCache.set(k, await getShift(emp)); return shiftCache.get(k); };
  const logPatches = [];                         // [logId, patch]
  const stamp = (p, rowId) => { const patch = { applied_to: rowId, applied_at: new Date().toISOString() }; if (!p.log.user_id) { patch.user_id = p.uid; stats.relinked_logs++; } if (p.log.off_role) patch.off_role = false; if (!p.log.applied_to || !p.log.user_id || p.log.off_role) logPatches.push([p.logId, { ...patch, user_id: p.uid, off_role: false }]); };

  for (const [uid, punches] of byUser) {
    const emp = empByUser.get(uid);
    punches.sort((a, b) => a.tms - b.tms);
    // 1. already on a record?  2. otherwise which day's record should carry it (same rule as the live punch path)
    const missingBy = new Map();
    for (const p of punches) {
      p.uid = uid;
      const same = rows.get(`${uid}|${p.date}`), prev = rows.get(`${uid}|${prevDay(p.date)}`);
      if (hasPunch(same?.d, p.tms)) { stats.already_applied++; stamp(p, same.id); continue; }
      if (hasPunch(prev?.d, p.tms)) { stats.already_applied++; stamp(p, prev.id); continue; }
      const hour = new Date(p.tms).getUTCHours() + new Date(p.tms).getUTCMinutes() / 60;
      const target = !same && hour < EARLY_MORNING_CUTOFF_HOUR && prev?.d?.is_in_progress ? prevDay(p.date) : p.date;
      stats.punches_missing++;
      if (!missingBy.has(target)) missingBy.set(target, []);
      missingBy.get(target).push(p);
    }

    for (const date of [...missingBy.keys()].sort()) {
      const list = missingBy.get(date);
      const newPunches = list.map(p => ({ time: p.t, device_direction: p.dir }));
      const slot = rows.get(`${uid}|${date}`);
      try {
        const shift = await shiftFor(emp);
        if (!halfCache.has(date)) halfCache.set(date, await getHalfDayOverrideHours(date, shift));
        const halfHours = halfCache.get(date);
        const closeIfOver = (merged) => { const open = buildSessions(merged); return date < today && open.is_in_progress ? closeTrailingOpenSession(merged) : open; };

        if (!slot) {                                              // a. no record for the day
          const sd = closeIfOver(newPunches);
          const res = computeStatusFromSessions(sd, shift, halfHours);
          const id = uuidv4();
          const d = { id, user_id: uid, date, source: 'biometric', biometric_synced: true, employee_code: emp.employee_code, check_in_source: sd.check_in_time ? 'biometric' : null, check_out_source: sd.check_out_time ? 'biometric' : null, reconciled_from_logs: true, ...sd, ...res };
          if (sd.is_in_progress) d.check_out_time = null;
          if (apply) await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)", [id, uid, d.status, JSON.stringify(d)]);
          rows.set(`${uid}|${date}`, { id, d, dirty: false, created: true });
          stats.days_created++; for (const p of list) stamp(p, id);
          continue;
        }

        const d = slot.d;
        const keptOnly = () => {                                  // b. keep the punch, leave the summary
          const kept = Array.isArray(d.biometric_punches) ? [...d.biometric_punches] : [];
          for (const np of newPunches) if (!kept.some(k => Math.abs(ms(k.time) - ms(np.time)) < 1000)) kept.push(np);
          kept.sort((a, b) => String(a.time).localeCompare(String(b.time)));
          slot.d = { ...d, biometric_punches: kept }; slot.dirty = true; stats.days_kept_only++;
        };
        if (isFrozen(d)) { keptOnly(); for (const p of list) stamp(p, slot.id); continue; }

        let existing = Array.isArray(d.raw_punches) ? [...d.raw_punches] : [];
        if (!existing.length && d.check_in_time) { existing.push({ time: d.check_in_time, device_direction: 'IN' }); if (d.check_out_time) existing.push({ time: d.check_out_time, device_direction: 'OUT' }); }
        const merged = [];
        for (const pch of [...existing, ...newPunches].sort((a, b) => String(a.time).localeCompare(String(b.time)))) if (!merged.some(m => Math.abs(ms(m.time) - ms(pch.time)) < 1000)) merged.push(pch);
        const sd = closeIfOver(merged);
        const res = applyDeclaredStatus(d, applyHalfDayLeaveStatus(d, sd, computeStatusFromSessions(sd, shift, halfHours)));
        const inChanged = d.check_in_time !== sd.check_in_time, outChanged = d.check_out_time !== sd.check_out_time;
        if ((inChanged && ['selfie', 'geofence'].includes(d.check_in_source)) || (outChanged && ['selfie', 'geofence'].includes(d.check_out_source))) { keptOnly(); for (const p of list) stamp(p, slot.id); continue; }

        let upd;
        if (isHrSetStatus(d)) {                                   // c. HR set the status — add the punches, keep the status
          upd = { ...d, ...sd, status: d.status, late_minutes: d.late_minutes, late_arrival: d.late_arrival, late_arrival_minutes: d.late_arrival_minutes, early_departure_minutes: d.early_departure_minutes, early_departure: d.early_departure, overtime_minutes: d.overtime_minutes, biometric_synced: true, reconciled_from_logs: true };
          if (sd.is_in_progress) upd.check_out_time = null;
          stats.days_hr_status_kept++;
        } else {                                                  // d. normal day — merge and recompute
          upd = { ...d, ...sd, ...res, biometric_synced: true, reconciled_from_logs: true,
            check_in_source: (inChanged || !d.check_in_source) ? 'biometric' : d.check_in_source,
            check_out_source: (outChanged || !d.check_out_source) ? (sd.check_out_time ? 'biometric' : d.check_out_source) : d.check_out_source };
          if (sd.is_in_progress) upd.check_out_time = null;
          stats.days_merged++;
          if (upd.status !== d.status) { stats.status_changes++; if (samples.status_changes.length < 25) samples.status_changes.push({ uid, date, from: d.status, to: upd.status }); }
        }
        slot.d = upd; slot.dirty = true;
        for (const p of list) stamp(p, slot.id);
      } catch (e) { stats.errors++; if (!samples.error) samples.error = `${uid} ${date}: ${e.message}`; }
    }
  }

  if (apply) {
    // rollback material: the previous JSON of every record changed, and the ids of records created
    backup.updated = []; backup.created = [];
    for (const { id, d, dirty, orig, created } of rows.values()) { if (created) backup.created.push(id); else if (dirty) backup.updated.push({ id, was: orig }); }
    if (backupFile) (await import('node:fs')).writeFileSync(backupFile, JSON.stringify(backup));   // before any write, so a crash still leaves the way back
    const dirtyRows = [...rows.values()].filter(r => r.dirty);
    for (let i = 0; i < dirtyRows.length; i += 200) {
      const chunk = dirtyRows.slice(i, i + 200);
      await run("UPDATE entities e SET data=v.data, status=v.status, updated_at=NOW()::TEXT FROM unnest($1::text[], $2::text[], $3::text[]) AS v(id, data, status) WHERE e.id=v.id", [chunk.map(r => r.id), chunk.map(r => JSON.stringify(r.d)), chunk.map(r => r.d.status || '')]);
    }
    // stamp the logs in chunks: one statement merges many patches
    for (let i = 0; i < logPatches.length; i += 500) {
      const chunk = logPatches.slice(i, i + 500);
      await run("UPDATE entities e SET data=(e.data::jsonb || v.patch::jsonb)::text FROM unnest($1::text[], $2::text[]) AS v(id, patch) WHERE e.id=v.id", [chunk.map(c => c[0]), chunk.map(c => JSON.stringify(c[1]))]);
    }
  }
  stats.logs_to_stamp = logPatches.length;
  samples.unmapped_codes = Object.fromEntries(Object.entries(samples.unmapped_codes).sort((a, b) => b[1] - a[1]).slice(0, 30));
  return { stats, samples, backup };
}
