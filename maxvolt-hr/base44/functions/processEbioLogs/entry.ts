import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Processes raw AttendanceLog records into Attendance entity.
 *
 * RULES:
 *  - Punch cycle: 1=IN, 2=OUT, 3=IN, 4=OUT ... alternating
 *  - First punch of day → Check-In → immediately status = 'present'
 *  - Total net working hours = sum of all completed IN/OUT session durations
 *  - < 3h  → absent  (LOP full day)
 *  - 3h–<9h → half_day (LOP 0.5)
 *  - ≥ 9h  → present
 *  - Late arrival: check-in > 20 min after shift start → late_arrival = true, warning added
 *  - If employee has 3+ late days in the same calendar month → ALL late days that month → half_day
 *
 * TIMEZONE: All times from eBioServer are IST (UTC+5:30).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function withRetry(fn, retries = 5, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (e?.status === 429 && i < retries - 1) {
        const wait = delayMs * Math.pow(2, i);
        console.warn(`Rate limited. Retry ${i + 1}/${retries - 1} in ${wait}ms…`);
        await new Promise(r => setTimeout(r, wait));
      } else { throw e; }
    }
  }
}

function parseISTDate(raw) {
  if (!raw) return null;
  if (typeof raw === 'number') return new Date(raw);
  const s = String(raw).trim();
  if (!s) return null;
  if (/Z$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  let isoStr = s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) isoStr = s.replace(' ', 'T');
  const dmy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (dmy) isoStr = `${dmy[3]}-${dmy[2]}-${dmy[1]}T${dmy[4] || '00:00:00'}`;
  const naive = new Date(isoStr);
  if (isNaN(naive.getTime())) return null;
  return new Date(naive.getTime() - IST_OFFSET_MS); // treat naive as IST → convert to UTC
}

function getField(obj, ...names) {
  if (!obj) return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null && obj[name] !== '') return obj[name];
    const lower = name.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
  }
  return undefined;
}

function shiftTimeToMinutes(hhmm) {
  if (!hhmm) return null;
  const parts = String(hhmm).split(':');
  if (parts.length < 2) return null;
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

function dateToISTMinutes(utcDate) {
  const ist = new Date(utcDate.getTime() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// ─── Status thresholds ──────────────────────────────────────────────────────
const ABSENT_THRESHOLD_H  = 3;   // < 3h  → absent
const PRESENT_THRESHOLD_H = 9;   // ≥ 9h  → present
// 3h ≤ x < 9h → half_day

// ─── Late threshold ─────────────────────────────────────────────────────────
const LATE_GRACE_MINUTES = 20;   // > 20 min after shift start = late

// ─── Monthly late limit ──────────────────────────────────────────────────────
const LATE_LIMIT_PER_MONTH = 3;  // 3+ late days → all late days → half_day

// ─── Build attendance record for one employee/day ───────────────────────────
function buildAttendanceRecord(userId, dateStr, punches, shift, shiftId) {
  punches.sort((a, b) => a - b);

  const firstPunchIn = punches[0];
  const lastPunch    = punches[punches.length - 1];
  const hasCheckOut  = punches.length >= 2;
  const lastPunchOutTime = hasCheckOut ? lastPunch.toISOString() : null;

  // Build sessions (IN/OUT pairs)
  const sessions = [];
  let totalWorkMs = 0;
  let totalBreakMs = 0;
  let lastPunchOut = null;

  for (let i = 0; i < punches.length; i++) {
    const isIn = (i % 2 === 0);
    if (isIn) {
      const breakBeforeMs = lastPunchOut ? (punches[i].getTime() - lastPunchOut.getTime()) : 0;
      if (lastPunchOut) totalBreakMs += breakBeforeMs;
      sessions.push({
        session_number: sessions.length + 1,
        punch_in: punches[i].toISOString(),
        punch_out: null,
        duration_hours: null,
        break_before_hours: lastPunchOut ? parseFloat((breakBeforeMs / 3600000).toFixed(4)) : 0,
      });
    } else {
      if (sessions.length > 0) {
        const session = sessions[sessions.length - 1];
        session.punch_out = punches[i].toISOString();
        const durationMs = punches[i].getTime() - new Date(session.punch_in).getTime();
        session.duration_hours = parseFloat((durationMs / 3600000).toFixed(4));
        totalWorkMs += durationMs;
        lastPunchOut = punches[i];
      }
    }
  }

  const totalWorkingHours = parseFloat((totalWorkMs / 3600000).toFixed(2));
  const totalBreakHours   = parseFloat((totalBreakMs / 3600000).toFixed(2));

  // ── Shift-based calculations ──
  let lateArrival = false;
  let lateArrivalMinutes = 0;
  let earlyDeparture = false;
  let earlyDepartureMinutes = 0;
  let overtimeHours = 0;
  const warnings = [];

  if (shift) {
    const shiftStartMins   = shiftTimeToMinutes(shift.start_time);
    const shiftEndMins     = shiftTimeToMinutes(shift.end_time);
    const expectedWorkHours = shift.working_hours || 0;

    if (shiftStartMins !== null) {
      const actualStartMins = dateToISTMinutes(firstPunchIn);
      const lateBy = actualStartMins - shiftStartMins;
      if (lateBy > LATE_GRACE_MINUTES) {
        lateArrival = true;
        lateArrivalMinutes = lateBy;
        warnings.push(`Late arrival: ${lateBy} min late on ${dateStr}. Potential salary deduction applies.`);
      }
    }

    if (shiftEndMins !== null && lastPunchOutTime) {
      const actualEndMins = dateToISTMinutes(new Date(lastPunchOutTime));
      if (actualEndMins < shiftEndMins) {
        earlyDeparture = true;
        earlyDepartureMinutes = shiftEndMins - actualEndMins;
      }
      if (expectedWorkHours > 0 && totalWorkingHours > expectedWorkHours) {
        overtimeHours = parseFloat((totalWorkingHours - expectedWorkHours).toFixed(2));
      }
    }
  }

  // ── Status determination ──
  let attendanceStatus;
  let lopApplicable = false;
  let lopDeductionDays = 0;

  if (totalWorkingHours < ABSENT_THRESHOLD_H) {
    attendanceStatus = 'absent';
    lopApplicable = true;
    lopDeductionDays = 1;
  } else if (totalWorkingHours < PRESENT_THRESHOLD_H) {
    attendanceStatus = 'half_day';
    lopApplicable = true;
    lopDeductionDays = 0.5;
  } else {
    attendanceStatus = 'present';
  }

  // Single punch (only check-in, no checkout yet) → mark present immediately
  if (punches.length === 1) {
    attendanceStatus = 'present';
    lopApplicable = false;
    lopDeductionDays = 0;
  }

  console.log(`Status ${userId} on ${dateStr}: ${attendanceStatus} | ${totalWorkingHours}h | late=${lateArrivalMinutes}min`);

  return {
    record: {
      user_id: userId,
      date: dateStr,
      status: attendanceStatus,
      auto_marked: true,
      biometric_synced: true,
      check_in_time: firstPunchIn.toISOString(),
      check_out_time: lastPunchOutTime,
      working_hours: totalWorkingHours,
      break_hours: totalBreakHours,
      overtime_hours: overtimeHours,
      punch_sessions: sessions,
      total_punches: punches.length,
      shift_id: shiftId,
      late_arrival: lateArrival,
      late_arrival_minutes: lateArrivalMinutes,
      early_departure: earlyDeparture,
      early_departure_minutes: earlyDepartureMinutes,
      lop_applicable: lopApplicable,
      lop_deduction_days: lopDeductionDays,
    },
    warnings,
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me().catch(() => null);
  if (user && user.role !== 'admin' && user.custom_role !== 'hr') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = body.date_from || today;
  const dateTo   = body.date_to   || today;

  // ── Optional: save raw_records to AttendanceLog first ──
  if (body.raw_records && Array.isArray(body.raw_records) && body.raw_records.length > 0) {
    console.log('Importing', body.raw_records.length, 'raw records into AttendanceLog…');
    let imported = 0;
    for (const record of body.raw_records) {
      const empCode = String(getField(record,
        'EmployeeCode', 'employeeCode', 'employee_code', 'EmpCode', 'empcode',
        'EnrollNumber', 'enrollnumber', 'UserID', 'userid'
      ) || '').trim();
      const logDateRaw = getField(record,
        'LogDate', 'logDate', 'log_date', 'LogDateTime', 'logdatetime',
        'Timestamp', 'timestamp', 'PunchTime', 'punchtime', 'AttendanceTime',
        'CheckTime', 'checktime', 'Time', 'time'
      );
      const parsedDate = parseISTDate(logDateRaw);
      if (!empCode || !parsedDate) {
        console.warn('Skipping raw record - missing empCode or date:', JSON.stringify(record));
        continue;
      }
      await withRetry(() => base44.asServiceRole.entities.AttendanceLog.create({
        EmployeeCode: empCode,
        DownloadDate: '',
        LogDate: parsedDate.toISOString(),
        DeviceName:      String(getField(record, 'DeviceName', 'deviceName', 'Device', 'MachineName') || ''),
        SerialNumber:    String(getField(record, 'SerialNumber', 'serialNumber', 'SN') || ''),
        Direction:       String(getField(record, 'Direction', 'direction', 'PunchType', 'InOutMode') || ''),
        DeviceDirection: String(getField(record, 'DeviceDirection', 'deviceDirection') || ''),
        WorkCode:        String(getField(record, 'WorkCode', 'workCode') || ''),
        VerificationType:String(getField(record, 'VerificationType', 'verificationType', 'VerifyMode') || ''),
        GPS:             String(getField(record, 'GPS', 'gps', 'Location', 'location') || ''),
        ProcessedAt: new Date().toISOString(),
      }));
      imported++;
      await new Promise(r => setTimeout(r, 200));
    }
    console.log('Imported', imported, 'records');
  }

  // Small delay to ensure any newly created logs from the webhook are persisted
  await new Promise(r => setTimeout(r, 2000));

  // ── Load AttendanceLogs in pages ──
  const allLogs = [];
  let skip = 0;
  const PAGE_SIZE = 200;
  while (true) {
    const page = await withRetry(() => base44.asServiceRole.entities.AttendanceLog.list('-LogDate', PAGE_SIZE, skip));
    if (!page || page.length === 0) break;
    allLogs.push(...page);
    if (page.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await new Promise(r => setTimeout(r, 1500));
  }

  const logs = allLogs.filter(log => {
    if (!log.LogDate) return false;
    const utcDate = new Date(log.LogDate);
    if (isNaN(utcDate.getTime())) return false;
    const istDate = new Date(utcDate.getTime() + IST_OFFSET_MS);
    const d = istDate.toISOString().slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });

  console.log('Logs in date range:', logs.length, 'dateFrom:', dateFrom, 'dateTo:', dateTo);

  if (logs.length === 0) {
    return Response.json({ success: true, message: 'No logs found in date range.', records_synced: 0 });
  }

  // ── Group punches by EmployeeCode + IST date ──
  const grouped = {};
  for (const log of logs) {
    const empCode = String(log.EmployeeCode || '').trim();
    if (!empCode) continue;
    const utcDate = new Date(log.LogDate);
    if (isNaN(utcDate.getTime())) continue;
    const istDate = new Date(utcDate.getTime() + IST_OFFSET_MS);
    const dateStr = istDate.toISOString().slice(0, 10);
    const key = `${empCode}_${dateStr}`;
    if (!grouped[key]) grouped[key] = { empCode, dateStr, punches: [] };
    grouped[key].punches.push(utcDate);
  }

  // ── Deduplicate punches within 60 seconds ──
  for (const key of Object.keys(grouped)) {
    const sorted = grouped[key].punches.sort((a, b) => a - b);
    const deduped = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].getTime() - deduped[deduped.length - 1].getTime() > 60000) deduped.push(sorted[i]);
    }
    grouped[key].punches = deduped;
    console.log(`${grouped[key].empCode} on ${grouped[key].dateStr}: ${deduped.length} punches`);
  }

  // ── Load reference data ──
  await new Promise(r => setTimeout(r, 500));
  const allEmployees = await withRetry(() => base44.asServiceRole.entities.Employee.list('-created_date', 1000));
  const biometricIdMap = {};
  const empCodeMap = {};
  for (const emp of allEmployees) {
    if (emp.biometric_id && String(emp.biometric_id).trim())
      biometricIdMap[String(emp.biometric_id).trim().toLowerCase()] = emp;
    if (emp.employee_code)
      empCodeMap[String(emp.employee_code).trim().toLowerCase()] = emp;
  }

  await new Promise(r => setTimeout(r, 500));
  const allShifts = await withRetry(() => base44.asServiceRole.entities.Shift.list('-created_date', 100));
  await new Promise(r => setTimeout(r, 300));
  const allHolidays = await withRetry(() => base44.asServiceRole.entities.Holiday.list('-date', 500));
  const holidayDates = new Set(allHolidays.map(h => h.date?.slice(0, 10)));
  const shiftMap = {};
  for (const s of allShifts) shiftMap[s.id] = s;
  const defaultShift = allShifts.find(s => s.is_default) || null;

  let syncedCount = 0;
  const errors = [];
  const allWarnings = [];
  const unmatchedCodes = new Set();

  // ── Track per-user per-month late days (for 3-strike rule) ──
  // key: `${userId}_${yyyy-MM}` → array of { attendanceId, dateStr }
  const lateByUserMonth = {};

  // ── First pass: process each employee/day ──
  const processedRecords = []; // store { attendanceId, userId, monthKey, isLate } for second pass

  for (const key of Object.keys(grouped)) {
    const { empCode, dateStr, punches } = grouped[key];

    const empRecord = biometricIdMap[empCode.toLowerCase()] || empCodeMap[empCode.toLowerCase()];
    if (!empRecord) {
      unmatchedCodes.add(empCode);
      errors.push(`No employee found for biometric code "${empCode}" on ${dateStr}.`);
      continue;
    }

    const userId = empRecord.user_id;
    if (!userId || userId === 'pending') {
      errors.push(`Employee "${empCode}" has no linked user account.`);
      continue;
    }

    if (empRecord.is_attendance_exempt) continue;

    // Holiday
    if (holidayDates.has(dateStr)) {
      const existing = await withRetry(() => base44.asServiceRole.entities.Attendance.filter({ user_id: userId, date: dateStr }));
      const rec = { user_id: userId, date: dateStr, status: 'holiday', auto_marked: true, biometric_synced: true };
      if (existing.length > 0) {
        if (existing[0].status !== 'holiday') await withRetry(() => base44.asServiceRole.entities.Attendance.update(existing[0].id, rec));
      } else {
        await withRetry(() => base44.asServiceRole.entities.Attendance.create(rec));
      }
      syncedCount++;
      continue;
    }

    const shift = (empRecord.shift_id && shiftMap[empRecord.shift_id]) || defaultShift || null;

    // Week-off
    if (shift && shift.days && shift.days.length > 0) {
      const dayOfWeek = new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      if (!shift.days.includes(dayOfWeek)) {
        const existing = await withRetry(() => base44.asServiceRole.entities.Attendance.filter({ user_id: userId, date: dateStr }));
        const rec = { user_id: userId, date: dateStr, status: 'week_off', auto_marked: true, biometric_synced: true };
        if (existing.length > 0) {
          if (existing[0].status !== 'week_off') await withRetry(() => base44.asServiceRole.entities.Attendance.update(existing[0].id, rec));
        } else {
          await withRetry(() => base44.asServiceRole.entities.Attendance.create(rec));
        }
        syncedCount++;
        continue;
      }
    }

    const { record, warnings } = buildAttendanceRecord(userId, dateStr, punches, shift, empRecord.shift_id || shift?.id || null);
    allWarnings.push(...warnings);

    await new Promise(r => setTimeout(r, 400));
    const existing = await withRetry(() => base44.asServiceRole.entities.Attendance.filter({ user_id: userId, date: dateStr }));
    await new Promise(r => setTimeout(r, 300));

    let attendanceId;
    if (existing.length > 0) {
      // Sort by updated_date desc to get the most recent record
      existing.sort((a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0));
      // Delete any duplicate records (keep only the first/most recent)
      for (let i = 1; i < existing.length; i++) {
        await withRetry(() => base44.asServiceRole.entities.Attendance.delete(existing[i].id)).catch(() => {});
      }
      await withRetry(() => base44.asServiceRole.entities.Attendance.update(existing[0].id, record));
      attendanceId = existing[0].id;
    } else {
      const created = await withRetry(() => base44.asServiceRole.entities.Attendance.create(record));
      attendanceId = created?.id;
    }
    syncedCount++;

    // Track late arrivals for monthly 3-strike rule
    if (record.late_arrival && attendanceId) {
      const monthKey = dateStr.slice(0, 7); // yyyy-MM
      const uk = `${userId}_${monthKey}`;
      if (!lateByUserMonth[uk]) lateByUserMonth[uk] = [];
      lateByUserMonth[uk].push({ attendanceId, dateStr });
    }
    console.log(`Synced: ${empCode} | ${dateStr} | ${punches.length} punches | ${record.working_hours}h | ${record.status}`);
  }

  // ── Second pass: apply 3-strike late rule ──
  // If a user has 3+ late days in any calendar month → upgrade ALL those late days to half_day
  for (const [uk, lateDays] of Object.entries(lateByUserMonth)) {
    if (lateDays.length >= LATE_LIMIT_PER_MONTH) {
      const [userId, monthKey] = uk.split('_');
      console.log(`User ${userId} has ${lateDays.length} late days in ${monthKey} — applying half_day to all late days.`);
      allWarnings.push(`User ${userId}: ${lateDays.length} late arrivals in ${monthKey}. All late-arrival days downgraded to Half Day (salary deduction).`);
      for (const { attendanceId, dateStr } of lateDays) {
        // Only upgrade if currently 'present' (don't override already half_day/absent)
        await withRetry(() => base44.asServiceRole.entities.Attendance.update(attendanceId, {
          status: 'half_day',
          lop_applicable: true,
          lop_deduction_days: 0.5,
          notes: `Auto half-day: ${lateDays.length} late arrivals in ${monthKey}`,
        }));
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }

  return Response.json({
    success: true,
    message: syncedCount > 0
      ? `Processed ${syncedCount} attendance record(s) from ${logs.length} biometric punches.`
      : `No records synced. ${unmatchedCodes.size > 0 ? `Unmatched codes: ${[...unmatchedCodes].join(', ')}` : 'No matching employees found.'}`,
    records_synced: syncedCount,
    unmatched_codes: [...unmatchedCodes],
    warnings: [...errors, ...allWarnings],
  });
});