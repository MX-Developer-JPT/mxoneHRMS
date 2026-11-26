// Small pure rules that keep attendance records truthful. Attendance times are stored as IST clock digits written as UTC
// ("2026-11-26T09:56:00.000Z" means 9:56 in the morning in India) - nothing here converts time zones for stored values.

export const MAX_SESSION_HOURS = 20;     // a punch longer than this after the first one cannot be the same day's check-out
export const FEED_QUIET_MIN = 180;       // a machine silent this long during working hours is worth looking at

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nextDate = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

// "09:56", "09:56:00", "2026-11-26T09:56" or a full stamp -> the stored form. null when it is not a time at all.
export function toStamp(value, date) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const bare = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (bare) {
    const [h, m, sec] = [Number(bare[1]), Number(bare[2]), Number(bare[3] || 0)];
    if (!DATE_RE.test(date || '') || h > 23 || m > 59 || sec > 59) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${date}T${p(h)}:${p(m)}:${p(sec)}.000Z`;
  }
  const iso = s.replace(' ', 'T');
  const ms = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// The in/out pair of an approved regularisation, on the day it was requested for. A requested value wins over the record's own.
// An out time that is not after the in time belongs to the next morning (night shift).
export function regularisedTimes(reg, att, date) {
  const checkIn = toStamp(reg?.requested_check_in, date) || toStamp(att?.check_in_time, date);
  let checkOut = toStamp(reg?.requested_check_out, date) || toStamp(att?.check_out_time, date);
  if (checkIn && checkOut && Date.parse(checkOut) <= Date.parse(checkIn)) {
    const bare = /^\d{1,2}:\d{2}/.test(String(reg?.requested_check_out || att?.check_out_time || '').trim());
    checkOut = bare && Date.parse(checkOut) < Date.parse(checkIn) ? toStamp(checkOut.slice(11, 19), nextDate(date)) : checkOut;
  }
  return { check_in_time: checkIn, check_out_time: checkOut };
}

// What the machines / phone really recorded, kept beside a corrected day so the correction never destroys the evidence.
export function originalPunches(att, finalTimes) {
  if (Array.isArray(att?.original_punches) && att.original_punches.length) return att.original_punches;
  if (att?.regularised) return [];
  const list = Array.isArray(att?.raw_punches) ? att.raw_punches : [];
  const same = list.every(p => [finalTimes?.check_in_time, finalTimes?.check_out_time].includes(p.time));
  return same ? [] : list;
}

// May a punch in the early hours close YESTERDAY's open record? Only if that session started recently enough to be real:
// someone who forgot to check out yesterday and punches in at the same time today must get a new day, not a 24-hour shift.
export function canContinuePreviousDay(prev, punchTime) {
  if (!prev?.is_in_progress) return false;
  const first = prev.check_in_time || prev.raw_punches?.[0]?.time;
  const a = Date.parse(toStamp(first, prev.date) || ''), b = Date.parse(punchTime);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;      // nothing to measure: keep the old behaviour
  return b - a >= 0 && b - a <= MAX_SESSION_HOURS * 3600000;
}

// rows: [{ device, last_punch (stored IST digits), last_received (real UTC) }]
export function feedStatus(rows, nowMs) {
  const istHour = new Date(nowMs + 5.5 * 3600000).getUTCHours();
  const working = istHour >= 9 && istHour < 21;
  return (rows || []).map(r => {
    const got = Date.parse(r.last_received);
    const quiet = Number.isFinite(got) ? Math.max(0, Math.round((nowMs - got) / 60000)) : null;
    return { device: r.device || 'Machine', last_punch: r.last_punch || null, last_received: r.last_received || null, quiet_minutes: quiet, attention: working && (quiet == null || quiet > FEED_QUIET_MIN) };
  }).sort((a, b) => String(a.device).localeCompare(String(b.device)));
}
