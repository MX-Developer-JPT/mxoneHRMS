// Single source of truth for "how was this attendance record marked" across
// AllAttendance, AttendanceDetailsDialog, AttendanceHistory and AttendanceReports.
// Precedence when a record carries more than one signal (e.g. biometric sync
// landed on a day that also has a selfie punch): biometric > geofence > selfie > manual.
export const ATTENDANCE_METHODS = {
  biometric: { key: 'biometric', label: 'Biometric', shortLabel: 'Bio', color: 'green' },
  geofence:  { key: 'geofence',  label: 'Geofence',   shortLabel: 'Geo', color: 'indigo' },
  selfie:    { key: 'selfie',    label: 'Selfie',     shortLabel: 'Selfie', color: 'blue' },
  manual:    { key: 'manual',    label: 'Manual',     shortLabel: 'Manual', color: 'gray' },
};

export function getAttendanceMethod(record) {
  if (!record) return ATTENDANCE_METHODS.manual;
  if (record.biometric_synced) return ATTENDANCE_METHODS.biometric;
  if (record.auto_geofence || record.auto_geofence_checkout) return ATTENDANCE_METHODS.geofence;
  if (record.check_in_selfie_url || record.check_out_selfie_url) return ATTENDANCE_METHODS.selfie;
  return ATTENDANCE_METHODS.manual;
}

// Per-side method — a record can legitimately be checked in by one method
// (e.g. selfie) and checked out by another (e.g. biometric); getAttendanceMethod
// above collapses both into a single value (biometric > geofence > selfie >
// manual) which hides that split. These two prefer the explicit
// check_in_source/check_out_source fields (set at the moment each punch
// happens — see markSelfieAttendance / nativeGeofenceEvent / the biometric
// sync merge in functions.js) and fall back to the same signal-based
// inference as getAttendanceMethod for older records that predate those
// fields.
export function getCheckInMethod(record) {
  if (!record) return ATTENDANCE_METHODS.manual;
  if (record.check_in_source && ATTENDANCE_METHODS[record.check_in_source]) return ATTENDANCE_METHODS[record.check_in_source];
  if (record.check_in_selfie_url) return ATTENDANCE_METHODS.selfie;
  if (record.auto_geofence) return ATTENDANCE_METHODS.geofence;
  if (record.biometric_synced) return ATTENDANCE_METHODS.biometric;
  return ATTENDANCE_METHODS.manual;
}
export function getCheckOutMethod(record) {
  if (!record) return ATTENDANCE_METHODS.manual;
  if (record.check_out_source && ATTENDANCE_METHODS[record.check_out_source]) return ATTENDANCE_METHODS[record.check_out_source];
  if (record.check_out_selfie_url) return ATTENDANCE_METHODS.selfie;
  if (record.auto_geofence_checkout) return ATTENDANCE_METHODS.geofence;
  if (record.biometric_synced) return ATTENDANCE_METHODS.biometric;
  return ATTENDANCE_METHODS.manual;
}

// Human-readable detail for the geofence case — distinguishes the native background
// geofence (works with the app backgrounded/closed) from the in-app foreground watcher.
export function getGeofenceDetail(record) {
  if (record?.geofence_source === 'native_android') return `Background geofence (Android) — ${record.geofence_location || 'assigned office'}`;
  if (record?.geofence_source === 'native_ios') return `Background geofence (iOS) — ${record.geofence_location || 'assigned office'}`;
  if (record?.geofence_location) return `In-app geofence — ${record.geofence_location}`;
  return 'Geofence';
}

// A day with no Attendance record only means "absent" if the employee was
// actually scheduled to work it — a declared company Holiday, or a day
// outside their Shift's working-days list, is a paid day off instead. Single
// source of truth for this inference across AllAttendance, AttendanceReports
// and the backend's exportAttendanceMuster/exportSwipeDetails (which mirror
// this exact logic server-side since they can't import frontend code) — a
// Saturday that IS a working day per some employee's Shift, or a Sunday that
// isn't the shift's off-day, must fall through to "no record ⇒ absent"
// rather than being blanket-skipped or blanket-marked absent.
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function scheduledOffStatus(emp, dateStr, holidaySet, shiftMap, defaultShift) {
  if (holidaySet.has(dateStr)) return 'holiday';
  const shift = (emp?.shift_id && shiftMap[emp.shift_id]) || defaultShift;
  const days = Array.isArray(shift?.days) && shift.days.length ? shift.days : defaultShift?.days;
  if (!days) return null;
  const weekday = WEEKDAY_NAMES[new Date(dateStr + 'T00:00:00').getDay()];
  return days.includes(weekday) ? null : 'week_off';
}

// IST "today" as YYYY-MM-DD — matches the store-IST-digits-as-UTC convention
// every date/timestamp on an Attendance record already uses.
export function istToday() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

// A record's raw is_in_progress/status==='in_progress' flag is only ever
// trustworthy for TODAY's own record. A still-open session on a PAST day
// means the closing punch was missed — the day is over regardless of what
// the stored flag says, and either already was (or will shortly be) force-
// closed by the nightly/30-min auto-close sweep. Without this check, a
// record that slipped through auto-close — or was auto-closed but a LATER
// late-arriving punch reopened its raw punch timeline without the frontend
// knowing — kept showing "Currently Working" / an in-progress badge
// indefinitely, well after the day it belongs to had ended. An explicitly
// auto_closed_reason is an even stronger signal: that day was deliberately
// finalized and must never read as still in progress.
export function isCurrentlyInProgress(record) {
  if (!record) return false;
  if (record.auto_closed_reason) return false;
  if (record.date !== istToday()) return false;
  return !!(record.is_in_progress || record.status === 'in_progress');
}

// Display status for a record whose raw `status` field is the literal
// string 'in_progress'. For TODAY that's genuinely current and is returned
// as-is. For any PAST day (see isCurrentlyInProgress above) it's re-mapped
// to what the day would read as once properly closed, using the same
// zero-vs-nonzero-worked-minutes rule computeStatusFromSessions applies
// server-side — good enough for display without needing the employee's
// shift on the client, and prevents a stale flag from ever appearing to
// still be "in progress" once the calendar page has moved on to a new day.
export function effectiveStatus(record) {
  if (!record) return null;
  if (record.status !== 'in_progress' || isCurrentlyInProgress(record)) return record.status;
  return (record.working_hours > 0 || record.total_working_minutes > 0) ? 'present' : 'absent';
}

// Statuses that count as "the employee was present" for headline stats —
// deliberately includes 'late'/'work_from_home'/'short_attendance', which
// several report cards previously left out of their present-vs-absent split,
// silently undercounting real presence.
export const PRESENT_LIKE_STATUSES = ['present', 'late', 'on_duty', 'work_from_home', 'short_attendance'];
