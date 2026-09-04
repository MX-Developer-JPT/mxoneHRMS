/**
 * External Attendance Log API
 * Receives punch events from biometric devices / external attendance apps.
 *
 * Auth: Bearer token using ATTENDANCE_API_KEY env var (set in Railway).
 *
 * POST /api/attendance-log
 * Body (single eBio punch):
 *   { EmployeeCode, LogDate, Direction, DeviceName?, SerialNumber?, VerificationType? }
 * Body (direct format):
 *   { employee_code, punch_time, type: "in"|"out", device_id? }
 * Body (batch):
 *   { records: [...] }
 *
 * All punches are stored as AttendanceLog entities regardless of employee match.
 * If employee is found (by employee_code or biometric_id), Attendance record is also updated.
 */

import express from 'express';
import { one, all, run } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const DEDUP_THRESHOLD_MS = 60 * 1000; // 60 seconds — ignore duplicate punches within this window

async function getApiKey() {
  if (process.env.ATTENDANCE_API_KEY) return process.env.ATTENDANCE_API_KEY;
  try {
    const row = await one("SELECT value FROM settings WHERE key='attendance_api_key'");
    return row?.value || null;
  } catch { return null; }
}

async function authMiddleware(req, res, next) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    return res.status(401).json({ error: 'Attendance API key not configured. Generate one in HRMS Settings.' });
  }
  const header = req.headers['authorization'] || req.headers['x-api-key'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key', hint: 'Set Authorization: Bearer <key> header' });
  }
  next();
}

// A shift "crosses midnight" (night shift, e.g. 20:00 -> 08:00) when its end
// time is numerically <= its start time on the clock — the end genuinely
// falls on the calendar day AFTER the day the shift started.
export function isOvernightShift(shift) {
  const toMins = (t) => { const [h, m] = String(t || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  return toMins(shift?.end_time) <= toMins(shift?.start_time);
}

// Real Date the shift for `dateStr` is expected to END — correctly landing
// on the day AFTER `dateStr` for an overnight shift (e.g. a 20:00 -> 08:00
// shift dated Sep 1 ends 08:00 on Sep 2, not "08:00 Sep 1", which would be
// BEFORE the shift even started). Returned as a real UTC-instant Date built
// from the "store IST digits as UTC" convention timestamps use throughout
// this app, so it can be compared directly against `new Date(Date.now() +
// IST_OFFSET_MS)` the way callers already compute "now" in IST.
export function shiftEndDateTime(dateStr, shift) {
  const [eh, em] = String(shift?.end_time || '18:00').split(':').map(Number);
  const end = new Date(dateStr + 'T00:00:00Z');
  end.setUTCHours(eh || 0, em || 0, 0, 0);
  if (isOvernightShift(shift)) end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

// Which Attendance record does this punch actually belong to? For a normal
// day shift it's always "today" (punchDate). For an overnight shift, a punch
// that lands in the early-morning hours with no record yet for today is very
// likely last night's closing punch (check-in filed under yesterday's date,
// physically punched after midnight) rather than the start of a brand-new
// session — reroute it to yesterday's record, but ONLY while that record is
// still open (is_in_progress); a fresh check-in should always start today's
// own record even on an overnight shift, never get silently appended to an
// already-closed previous day.
async function resolveAttendanceRow(userId, punchDate, shift) {
  const sameDay = await one(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
    [userId, punchDate]
  );
  if (sameDay || !isOvernightShift(shift)) return { date: punchDate, row: sameDay };

  const y = new Date(punchDate + 'T00:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const prevDay = await one(
    "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2 LIMIT 1",
    [userId, yesterday]
  );
  if (prevDay) {
    const pd = JSON.parse(prevDay.data);
    if (pd.is_in_progress) return { date: yesterday, row: prevDay };
  }
  return { date: punchDate, row: null };
}

// Resolve shift for an employee (by shift_id or default shift)
async function getShift(empData) {
  if (empData?.shift_id) {
    const row = await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [empData.shift_id]);
    if (row) return JSON.parse(row.data);
  }
  const row = await one(
    "SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'='true' OR data::jsonb->>'is_default'='1') LIMIT 1"
  );
  return row ? JSON.parse(row.data) : { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 };
}

/**
 * Build sessions, breaks, and working-time summary from raw punches.
 *
 * Alternating-position model:
 *   1st punch → Check In (Session 1)
 *   2nd punch → Check Out (Session 1)
 *   3rd punch → Check In (Session 2)  …
 *
 * rawPunches: [{ time: ISO, device_direction: 'IN'|'OUT' }]
 */
export function buildSessions(rawPunches) {
  if (!rawPunches || rawPunches.length === 0) {
    return {
      raw_punches: [], sessions: [], breaks: [], punch_sessions: [],
      total_working_minutes: 0, total_break_minutes: 0,
      session_count: 0, punch_count: 0, is_in_progress: false,
      check_in_time: null, check_out_time: null,
      working_hours: 0, break_hours: 0,
    };
  }

  // Strip punches with missing or unparseable timestamps before sorting.
  // An empty-string or null time would sort before real timestamps (falsy → position 0)
  // and produce sessions[0].check_in = "" → check_in_time = null, which is the root
  // cause of "First In: — / Last Out: 10:06 AM" display bug.
  const validPunches = rawPunches.filter(p => {
    const t = String(p?.time ?? '').trim();
    if (!t || t === 'null' || t === 'undefined') return false;
    const ms = new Date(t.replace(' ', 'T')).getTime();
    if (isNaN(ms) || ms <= 0) return false;
    // Reject exact midnight (00:00:00) — biometric devices write this as a daily-reset or
    // placeholder row when the actual punch time was not captured. These entries sort
    // before any real punch and corrupt sessions: the real arrival ends up at the check_out
    // position instead of check_in, making the all-attendance page show arrival as "Last Out".
    if (/[T ]00:00:00/.test(t)) return false;
    return true;
  });
  if (validPunches.length === 0) {
    return {
      raw_punches: [], sessions: [], breaks: [], punch_sessions: [],
      total_working_minutes: 0, total_break_minutes: 0,
      session_count: 0, punch_count: 0, is_in_progress: false,
      check_in_time: null, check_out_time: null,
      working_hours: 0, break_hours: 0,
    };
  }

  // Sort chronologically — normalise space→T first so mixed-format logs sort correctly
  const sorted = [...validPunches]
    .map(p => ({ ...p, time: String(p.time).trim().replace(' ', 'T') }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // Deduplicate: skip punches within DEDUP_THRESHOLD_MS of the previous accepted punch
  const deduped = [];
  for (const p of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && new Date(p.time).getTime() - new Date(last.time).getTime() < DEDUP_THRESHOLD_MS) continue;
    deduped.push(p);
  }

  // Build in/out pairs (alternating position, not device direction)
  const sessions = [];
  for (let i = 0; i < deduped.length; i += 2) {
    const inP  = deduped[i];
    const outP = deduped[i + 1] || null;
    const duration_minutes = outP
      ? Math.round((new Date(outP.time) - new Date(inP.time)) / 60000)
      : null;
    sessions.push({
      session_number: Math.floor(i / 2) + 1,
      check_in:  inP.time,
      check_out: outP?.time || null,
      duration_minutes,
      is_complete: !!outP,
    });
  }

  // Build breaks between consecutive sessions
  const breaks = [];
  for (let i = 0; i < sessions.length - 1; i++) {
    const prev = sessions[i];
    const next = sessions[i + 1];
    if (prev.check_out && next.check_in) {
      breaks.push({
        break_number: i + 1,
        start: prev.check_out,
        end:   next.check_in,
        duration_minutes: Math.round((new Date(next.check_in) - new Date(prev.check_out)) / 60000),
      });
    }
  }

  const total_working_minutes = sessions.reduce((s, sess) => s + (sess.duration_minutes || 0), 0);
  const total_break_minutes   = breaks.reduce((s, b) => s + b.duration_minutes, 0);
  const is_in_progress        = deduped.length % 2 === 1; // odd punches → last is an open check-in

  const check_in_time  = sessions[0]?.check_in || null;
  const completeSess   = sessions.filter(s => s.is_complete);
  const check_out_time = completeSess.length ? completeSess[completeSess.length - 1].check_out : null;

  // punch_sessions: rich format consumed by AttendanceDetailsDialog
  const punch_sessions = sessions.map((sess, i) => ({
    session_number:    sess.session_number,
    punch_in:          sess.check_in,
    punch_out:         sess.check_out,
    duration_hours:    sess.duration_minutes != null ? Math.round(sess.duration_minutes * 100 / 60) / 100 : null,
    break_before_hours: i > 0 && breaks[i - 1] ? Math.round(breaks[i - 1].duration_minutes * 100 / 60) / 100 : 0,
  }));

  return {
    raw_punches: deduped,
    sessions,
    breaks,
    punch_sessions,
    total_working_minutes,
    total_break_minutes,
    session_count:  sessions.length,
    punch_count:    deduped.length,
    is_in_progress,
    check_in_time,
    check_out_time,
    working_hours: Math.round(total_working_minutes / 60 * 100) / 100,
    break_hours:   Math.round(total_break_minutes   / 60 * 100) / 100,
  };
}

/**
 * Given a day's raw punches, finalizes a still-open trailing session (an odd
 * final check-in with no matching check-out) by treating that check-in's own
 * time as the final check-out — the day is over and no real check-out was
 * ever recorded, so the last known activity IS the day's end. The synthetic
 * check-out is offset by just over the dedup window (see DEDUP_THRESHOLD_MS)
 * so buildSessions doesn't discard it as a duplicate of the check-in it's
 * closing; the resulting session is effectively zero-duration and adds no
 * working time. Earlier *completed* sessions that day are untouched.
 *
 * Example A — one session, never checked out: check-in 10:21 AM, no check-
 * out. Result: check_out_time = 10:21 AM (+~1 min), total worked = 0 →
 * status resolves to Absent (see computeStatusFromSessions).
 * Example B — Session 1 10:07 AM → 8:53 PM (10h46m, complete), Session 2
 * 8:56 PM IN with no OUT. Result: check_out_time = 8:56 PM (Session 2's own
 * check-in), total = 10h46m from Session 1 only — Present, with "Last Out"
 * correctly reflecting the later timestamp instead of reverting to Session
 * 1's end.
 *
 * This is a FINALIZATION step, not a live/real-time one: only call this when
 * closing out a day that has actually ended (the nightly/stale-session
 * sweep, historical recalculation) — never for today's still-ongoing
 * session, which needs to stay genuinely open for check-out/geofence-exit
 * detection and the Mark Attendance UI to keep working correctly.
 */
export function closeTrailingOpenSession(rawPunches) {
  const sd = buildSessions(rawPunches);
  if (!sd.is_in_progress) return sd; // already closed — nothing to finalize
  const lastPunch = sd.raw_punches[sd.raw_punches.length - 1];
  // Offset by just over the dedup window so buildSessions doesn't discard
  // this synthetic punch as a duplicate of the check-in it's closing — but
  // that offset is a bookkeeping artifact, not real worked time, so the
  // reported check-out time and this session's duration are corrected back
  // to the true check-in instant / zero minutes below.
  const syntheticOut = { time: new Date(new Date(lastPunch.time).getTime() + DEDUP_THRESHOLD_MS + 1).toISOString(), device_direction: 'OUT' };
  const closed = buildSessions([...sd.raw_punches, syntheticOut]);
  const lastIdx = closed.sessions.length - 1;
  const lastSession = closed.sessions[lastIdx];
  const realWorkedMinutes = closed.total_working_minutes - (lastSession.duration_minutes || 0);
  return {
    ...closed,
    // IMPORTANT: raw_punches/punch_count must stay the REAL punches only —
    // the synthetic punch above is a display-only bookkeeping artifact for
    // finalizing today's summary fields, never something to persist. If it
    // leaks into the saved raw_punches (as it did before this fix, via the
    // `...closed` spread above), the next time a late biometric sync merges
    // a genuine later punch for the same day, it pairs against this fake
    // punch instead of the real one — permanently splitting one continuous
    // work session into two fake ~1-minute sessions with a bogus multi-hour
    // "break" between them, which then gets closed the same broken way
    // again on the next punch. See closeStaleOpenSessions in
    // cron/attendanceAutomation.js, which is what calls this on merge.
    raw_punches: sd.raw_punches,
    punch_count: sd.raw_punches.length,
    check_out_time: lastPunch.time,
    sessions: closed.sessions.map((s, i) => i === lastIdx ? { ...s, check_out: lastPunch.time, duration_minutes: 0 } : s),
    punch_sessions: closed.punch_sessions.map((s, i) => i === lastIdx ? { ...s, punch_out: lastPunch.time, duration_hours: 0 } : s),
    total_working_minutes: realWorkedMinutes,
    working_hours: Math.round(realWorkedMinutes / 60 * 100) / 100,
  };
}

// Looks up whether `date` is a Holiday marked as a half working day (set from
// the Holiday Calendar page) and, if so, the reduced hours that should count
// as a full "present" day. Returns null on an ordinary day/full holiday, so
// callers can tell "no override" apart from "override of 0".
export async function getHalfDayOverrideHours(date, shift) {
  const row = await one(
    "SELECT data FROM entities WHERE type='Holiday' AND data::jsonb->>'date'=$1 AND data::jsonb->>'is_half_day'='true' LIMIT 1",
    [date]
  );
  if (!row) return null;
  const holiday = JSON.parse(row.data);
  const configured = Number(holiday.half_day_hours);
  if (configured > 0) return configured;
  return Number(shift.working_hours || 9) / 2;
}

// Batch version of the above for bulk processors that touch many dates in
// one run (a single query instead of one per row/date). Returns a
// Map<date, configuredHours|null> — null meaning "half day, but use the
// employee's own shift.working_hours/2" since half_day_hours wasn't set.
// Use resolveHalfDayHours() to turn a map lookup + a specific shift into the
// same effectiveShiftHours value getHalfDayOverrideHours() would return.
export async function getHalfDayHolidayMap(fromDate, toDate) {
  const rows = await all(
    "SELECT data FROM entities WHERE type='Holiday' AND data::jsonb->>'is_half_day'='true' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2",
    [fromDate, toDate]
  );
  const map = new Map();
  for (const row of rows) {
    const holiday = JSON.parse(row.data);
    const configured = Number(holiday.half_day_hours);
    map.set(holiday.date, configured > 0 ? configured : null);
  }
  return map;
}

export function resolveHalfDayHours(halfDayMap, date, shift) {
  if (!halfDayMap.has(date)) return null;
  const configured = halfDayMap.get(date);
  return configured > 0 ? configured : Number(shift.working_hours || 9) / 2;
}

/**
 * Derive attendance status + late/early/overtime figures from session summary + shift config.
 *
 * late_minutes / late_arrival(_minutes) — first check-in vs shift start + grace.
 * early_departure(_minutes) — last check-out vs shift end - grace (only once the day is
 * complete, i.e. not still in_progress — an open session isn't "early" yet).
 * overtime_minutes — last check-out beyond shift end + grace.
 *
 * `effectiveShiftHours` — optional override for the hours a "full" day
 * requires, used when the day is a Holiday-Calendar half-day (see
 * getHalfDayOverrideHours above): someone who worked the shorter half-day
 * hours is "present" for the day, not flagged half_day/short_attendance
 * against the shift's normal full-day length.
 */
export function computeStatusFromSessions(sessionData, shift, effectiveShiftHours) {
  const toMins    = (t) => { const [h, m] = String(t || '00:00').split(':').map(Number); return h * 60 + m; };
  const isoToMins = (iso) => toMins(iso ? iso.slice(11, 16) : null);

  const { total_working_minutes, is_in_progress, check_in_time, check_out_time } = sessionData;
  const shiftStart = toMins(shift.start_time || '09:00');
  const shiftEnd   = toMins(shift.end_time   || '18:00');
  const overnight  = shiftEnd <= shiftStart; // e.g. 20:00 -> 08:00 crosses midnight
  const grace      = Number(shift.grace_period_minutes || 15);
  const shiftHours = effectiveShiftHours > 0 ? Number(effectiveShiftHours) : Number(shift.working_hours || 9);

  let status = 'present', late_minutes = 0, early_departure_minutes = 0, overtime_minutes = 0;

  if (is_in_progress) {
    // Still working — don't finalise status yet
    status = 'in_progress';
  } else if (total_working_minutes > 0) {
    const wh = total_working_minutes / 60;
    if (wh < shiftHours / 2)    status = 'short_attendance';
    else if (wh < shiftHours * 0.9) status = 'half_day';
    else status = 'present';
  } else {
    // Closed out with zero worked minutes — e.g. the day's only punch was a
    // trailing check-in that closeTrailingOpenSession() had to neutralize
    // into a zero-duration session, with no other real session that day.
    // Must not silently fall through to the 'present' default above.
    status = 'absent';
  }

  if (check_in_time) {
    let firstInMins = isoToMins(check_in_time);
    // Overnight shift, arrived after midnight: a clock-time at or before the
    // shift's own end (e.g. 00:30 for a 20:00->08:00 shift) is really an
    // extremely late arrival on the day AFTER the shift started, not an
    // impossibly-early one — shift it a full day forward so it compares
    // correctly against shiftStart+grace instead of never registering as late.
    // An arrival BEFORE shiftStart same evening (e.g. 19:30, early) is left
    // alone — only the early-morning window is ambiguous enough to need this.
    if (overnight && firstInMins !== null && firstInMins <= shiftEnd) firstInMins += 24 * 60;
    if (firstInMins !== null && firstInMins > shiftStart + grace) {
      late_minutes = firstInMins - shiftStart - grace;
      if (status === 'present') status = 'late';
    }
  }

  if (!is_in_progress && check_out_time) {
    const lastOutMins = isoToMins(check_out_time);
    if (lastOutMins !== null) {
      if (lastOutMins < shiftEnd - grace)      early_departure_minutes = shiftEnd - grace - lastOutMins;
      else if (lastOutMins > shiftEnd + grace) overtime_minutes = lastOutMins - shiftEnd - grace;
    }
  }

  return {
    status, late_minutes, early_departure_minutes, overtime_minutes,
    late_arrival: late_minutes > 0,
    late_arrival_minutes: late_minutes,
    early_departure: early_departure_minutes > 0,
  };
}

async function processRecord(record) {
  // Normalise field names — accept eBio Pascal-case and snake_case formats.
  // Trimmed here (not just lower-cased for the match below) so a stray
  // leading/trailing space from the device doesn't create a distinct
  // AttendanceLog dedup/EmployeeCode identity from the "clean" version.
  const codeStr    = String(record.employee_code || record.EmployeeCode || '').trim();
  const directUid  = record.user_id;
  // When LogDate is explicitly "" (MxOneSync sends this when the eBioServer DB column is NULL),
  // do NOT fall back to DownloadDate — that's the sync timestamp, not the actual punch time.
  // Only use DownloadDate when LogDate is entirely absent (undefined / not sent).
  const logDate    = record.LogDate;
  const punch_time = record.punch_time ||
    (logDate !== undefined ? (logDate || null) : null) ||
    (logDate === undefined ? record.DownloadDate : null);
  const dirRaw     = (record.type || record.Direction || 'IN').toString().toUpperCase();
  const direction  = dirRaw === 'OUT' || dirRaw === 'EXIT' ? 'OUT' : 'IN';
  const deviceName = record.DeviceName || record.device_id || null;
  const serial     = record.SerialNumber || null;
  const verType    = record.VerificationType || null;

  if (!punch_time) return { ok: false, reason: 'punch_time is required' };

  // "Store IST, display IST" — biometric devices send local IST time without timezone info.
  const punchIso = (() => {
    const clean = String(punch_time).trim().replace(' ', 'T');
    if (!/Z$|[+-]\d{2}:?\d{2}$/.test(clean)) {
      return clean.replace(/(\.\d+)?$/, '.000Z');
    }
    const IST_MS = 5.5 * 60 * 60 * 1000;
    return new Date(new Date(clean).getTime() + IST_MS).toISOString();
  })();
  // Reject midnight — the biometric device writes 00:00:00 as a daily-reset or placeholder
  // row when it cannot record the actual punch time. Storing it creates a ghost punch that
  // chronologically precedes the real arrival, pushing the real arrival into the check_out
  // slot in buildSessions and displaying it as "Last Out" instead of "First In".
  if (/T00:00:00\.000Z$/.test(punchIso)) {
    return { ok: false, reason: 'punch_time is midnight (00:00:00) — biometric device placeholder, not a real punch. Skipped.' };
  }

  const punchDate = punchIso.slice(0, 10);

  // 1. Resolve employee
  let userId = directUid || null;
  let empData = null;
  if (!userId && codeStr) {
    // Case-insensitive match — the biometric device and the HR-entered
    // employee_code/biometric_id don't reliably agree on case (e.g.
    // "MVE00001" vs "mve00001"), and an exact-string match silently drops
    // the punch (stored as an unmatched AttendanceLog, no Attendance
    // record created) even though it's unambiguously the same employee.
    // The admin's BiometricCodeMapping review UI already matches this way
    // for display — this brings the actual processing logic in line with it.
    const codeUpper = codeStr.toUpperCase();
    const mappingRow = await one(
      "SELECT data FROM entities WHERE type='BiometricCodeMapping' AND UPPER(TRIM(data::jsonb->>'biometric_code'))=$1 LIMIT 1",
      [codeUpper]
    );
    if (mappingRow) {
      const m = JSON.parse(mappingRow.data);
      userId = m.user_id || null;
    }
    if (!userId) {
      const empRow = await one(
        "SELECT user_id, data FROM entities WHERE type='Employee' AND (UPPER(TRIM(data::jsonb->>'employee_code'))=$1 OR UPPER(TRIM(data::jsonb->>'biometric_id'))=$1) LIMIT 1",
        [codeUpper]
      );
      if (empRow) { userId = empRow.user_id; empData = JSON.parse(empRow.data); }
    }
  }
  if (userId && !empData) {
    const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1 LIMIT 1", [userId]);
    if (empRow) empData = JSON.parse(empRow.data);
  }

  // 2. Store raw punch as AttendanceLog (deduplicate by code + exact timestamp)
  let logStored = false;
  const existingLog = await one(
    "SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2",
    [codeStr, punchIso]
  );
  if (!existingLog) {
    const logId = uuidv4();
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)",
      [logId, userId || null, JSON.stringify({
        id: logId,
        EmployeeCode: codeStr,
        LogDate: punchIso,
        Direction: direction,
        DeviceName: deviceName,
        SerialNumber: serial,
        VerificationType: verType,
        user_id: userId || null,
        ProcessedAt: new Date().toISOString(),
        source: 'webhook',
      })]
    );
    logStored = true;
  }

  if (!userId) {
    return {
      ok: true, log_stored: logStored, attendance_updated: false,
      note: `employee_code=${codeStr} not yet mapped — set the Biometric ID on the employee record`,
    };
  }

  // 3. Find or create the Attendance record this punch belongs to — for an
  // overnight shift that's not always punchDate itself (see resolveAttendanceRow).
  const shift = await getShift(empData);
  const { date: attDate, row } = await resolveAttendanceRow(userId, punchDate, shift);
  const halfDayHours = await getHalfDayOverrideHours(attDate, shift);
  const newPunch = { time: punchIso, device_direction: direction };

  if (!row) {
    // First punch of the day — create new Attendance record
    const sd = buildSessions([newPunch]);
    const statusResult = computeStatusFromSessions(sd, shift, halfDayHours);
    const { status } = statusResult;
    const id = uuidv4();
    const attData = {
      id, user_id: userId, date: attDate,
      source: 'biometric', biometric_synced: true, device_id: deviceName,
      employee_code: empData?.employee_code || codeStr,
      ...sd, ...statusResult,
    };
    await run(
      "INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,$3,$4)",
      [id, userId, status, JSON.stringify(attData)]
    );
    return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: id, action: 'created', status };
  }

  // 4. Update existing — never overwrite a regularised record
  const data = JSON.parse(row.data);
  if (data.status === 'regularised') {
    return { ok: true, log_stored: logStored, attendance_updated: false, attendance_id: row.id, action: 'skipped_regularised' };
  }

  // Merge new punch into the existing raw_punches list and rebuild sessions
  const existingPunches = data.raw_punches || [];
  // Also migrate old punch_sessions format (time/type) if raw_punches not yet present
  if (!existingPunches.length && Array.isArray(data.punch_sessions)) {
    const oldFmt = data.punch_sessions.filter(s => s.time); // old format has .time
    if (oldFmt.length) {
      const inTimes  = data.check_in_time  ? [data.check_in_time]  : [];
      const outTimes = data.check_out_time ? [data.check_out_time] : [];
      // Collect unique times from old sessions
      oldFmt.forEach(s => {
        if (s.type === 'in' && !existingPunches.find(p => p.time === s.time))
          existingPunches.push({ time: s.time, device_direction: 'IN' });
        if (s.type === 'out' && !existingPunches.find(p => p.time === s.time))
          existingPunches.push({ time: s.time, device_direction: 'OUT' });
      });
    }
  }

  // Add new punch if not already present — compare by millisecond value so that
  // "2026-06-29T10:23:40" and "2026-06-29T10:23:40.000Z" are treated as the same punch.
  const punchMs = new Date(punchIso).getTime();
  const alreadyPresent = existingPunches.some(p => {
    const t = String(p?.time ?? '').trim().replace(' ', 'T');
    return Math.abs(new Date(t).getTime() - punchMs) < 1000; // within 1 second = same tap
  });
  const mergedPunches  = alreadyPresent ? existingPunches : [...existingPunches, newPunch];

  const sd = buildSessions(mergedPunches);
  const statusResult = computeStatusFromSessions(sd, shift, halfDayHours);
  const { status } = statusResult;

  const updated = {
    ...data,
    biometric_synced: true,
    device_id: deviceName || data.device_id,
    employee_code: empData?.employee_code || data.employee_code || codeStr,
    ...sd, ...statusResult,
  };

  await run(
    "UPDATE entities SET status=$1, data=$2, updated_at=NOW()::TEXT WHERE id=$3",
    [status, JSON.stringify(updated), row.id]
  );
  return { ok: true, log_stored: logStored, attendance_updated: true, attendance_id: row.id, action: 'updated', status };
}

// Single / batch punch
router.post('/', authMiddleware, async (req, res) => {
  try {
    const body = req.body;

    if (Array.isArray(body.records)) {
      const results = await Promise.all(
        body.records.map(r => processRecord(r).catch(e => ({ ok: false, reason: e.message })))
      );
      const logsStored = results.filter(r => r.ok && r.log_stored).length;
      const attUpdated = results.filter(r => r.ok && r.attendance_updated).length;
      const unmapped   = results.filter(r => r.ok && !r.attendance_updated).length;
      return res.json({
        success: true,
        processed: results.length,
        logs_stored: logsStored,
        attendance_updated: attUpdated,
        unmapped_employees: unmapped,
        results,
      });
    }

    const result = await processRecord(body);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    return res.json({ success: true, ...result });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Reprocess existing AttendanceLogs for a date range into Attendance records
router.post('/reprocess', authMiddleware, async (req, res) => {
  try {
    const { date_from, date_to } = req.body;
    if (!date_from) return res.status(400).json({ error: 'date_from is required (yyyy-MM-dd)' });
    const toDate = date_to || date_from;

    const logRows = await all("SELECT data FROM entities WHERE type='AttendanceLog'");
    const logsInRange = logRows
      .map(r => JSON.parse(r.data))
      .filter(log => {
        const d = log.LogDate ? String(log.LogDate).slice(0, 10) : null;
        return d && d >= date_from && d <= toDate;
      });

    if (logsInRange.length === 0)
      return res.json({ success: true, total_logs: 0, attendance_updated: 0, message: 'No logs found in date range' });

    const results = await Promise.all(logsInRange.map(log => {
      const record = {
        employee_code: log.EmployeeCode || log.employee_code || '',
        user_id: log.user_id || null,
        punch_time: log.LogDate,
        type: (log.Direction || log.type || 'IN').toUpperCase() === 'OUT' ? 'out' : 'in',
        device_id: log.DeviceName || log.device_id || null,
      };
      return processRecord(record).catch(e => ({ ok: false, reason: e.message }));
    }));

    const updated = results.filter(r => r.ok && r.attendance_updated).length;
    const skipped = results.filter(r => r.ok && !r.attendance_updated).length;
    const errors  = results.filter(r => !r.ok).length;

    return res.json({ success: true, total_logs: logsInRange.length, attendance_updated: updated, skipped, errors });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Docs endpoint
router.get('/', (_req, res) => {
  res.json({
    description: 'Maxvolt One — External Attendance Log API',
    version: '3.0',
    auth: 'Authorization: Bearer <ATTENDANCE_API_KEY>',
    note: 'Punches interpreted by alternating position (1st=In, 2nd=Out, 3rd=In…). Sessions and break times calculated automatically.',
    endpoints: {
      'POST /api/attendance-log': {
        eBio:   { EmployeeCode: 'string', LogDate: 'ISO8601', Direction: 'IN|OUT', DeviceName: 'optional' },
        direct: { employee_code: 'string', punch_time: 'ISO8601', type: '"in"|"out"' },
        batch:  { records: '[{ EmployeeCode, LogDate, Direction }]' },
      },
      'POST /api/attendance-log/reprocess': { date_from: 'yyyy-MM-dd', date_to: 'yyyy-MM-dd (optional)' },
    },
  });
});

export default router;
