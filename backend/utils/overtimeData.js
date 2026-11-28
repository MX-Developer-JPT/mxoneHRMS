// Loads what the overtime calculation needs, and stamps overtime on attendance records as they are read, so every screen
// shows the same figure as the reports.
import { all } from '../db.js';
import { cleanPolicy, overtimeForDay } from './overtime.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const rows = async (type) => (await all('SELECT id, user_id, data FROM entities WHERE type=$1', [type])).map((r) => { const d = parse(r.data); return { ...d, id: d.id || r.id, user_id: d.user_id || r.user_id }; });

export async function loadPolicy() {
  const saved = (await rows('OvertimePolicy'))[0] || {};
  const configs = await rows('PayrollConfiguration');
  const config = configs.find((c) => c.is_active && c.overtime_multiplier != null) || configs.find((c) => c.overtime_multiplier != null);
  return cleanPolicy({ ...saved, multiplier: config?.overtime_multiplier });
}

export async function loadOvertimeContext() {
  const employees = await rows('Employee');
  const shifts = await rows('Shift');
  const holidayByDate = {};
  for (const h of await rows('Holiday')) { const d = String(h.date || '').slice(0, 10); if (d && (!holidayByDate[d] || !h.is_half_day)) holidayByDate[d] = h; }
  return {
    employees, holidayByDate,
    empByUser: Object.fromEntries(employees.map((e) => [e.user_id, e])),
    shiftById: Object.fromEntries(shifts.map((s) => [s.id, s])),
    defaultShift: shifts.find((s) => s.is_default === true || String(s.is_default) === 'true' || String(s.is_default) === '1') || { start_time: '09:00', end_time: '18:00', working_hours: 9, grace_period_minutes: 15 },
    policy: await loadPolicy(),
  };
}

let cache = null, cachedAt = 0;
export const clearOvertimeCache = () => { cache = null; };
export async function decorateOvertime(records) {
  if (!records?.length) return records;
  try {
    if (!cache || Date.now() - cachedAt > 60_000) { cache = await loadOvertimeContext(); cachedAt = Date.now(); }
    const c = cache;
    return records.map((r) => {
      if (!r?.date || !r.user_id) return r;
      const e = c.empByUser[r.user_id];
      const d = overtimeForDay({ record: r, shift: c.shiftById[e?.shift_id] || c.defaultShift, holiday: c.holidayByDate[String(r.date).slice(0, 10)], employee: e, policy: c.policy });
      return { ...r, overtime_minutes: d.ot_minutes };
    });
  } catch (e) {
    console.error('[overtime] could not calculate:', e.message);
    return records;
  }
}
