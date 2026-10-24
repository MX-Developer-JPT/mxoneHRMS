// Date / period / comparison helpers for the Intelligent MIS. Everything is IST (the company
// timezone); dates are 'YYYY-MM-DD' strings, so no timezone maths leaks into the metrics.
const IST_MS = 5.5 * 3600000;
const DAY = 86400000;

export const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY); // b - a
export const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const fmtD = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };
export const eachDay = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const monthName = (y, m) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');

// Same calendar date one year earlier (29 Feb -> 28 Feb).
export function minusYear(d, years = 1) {
  const [y, m, dd] = d.split('-').map(Number);
  const last = lastOfMonth(y - years, m).slice(8);
  return `${y - years}-${pad(m)}-${pad(Math.min(dd, Number(last)))}`;
}

// preset: daily | weekly | monthly | quarterly | ytd | custom
export function resolvePeriod({ preset = 'monthly', anchor, from, to } = {}) {
  const a = isDate(anchor) ? anchor : istDate();
  if (preset === 'custom') {
    const f = isDate(from) ? from : a;
    let t = isDate(to) ? to : f;
    if (t < f) t = f;
    return { preset, from: f, to: t, label: f === t ? fmtD(f) : `${fmtD(f)} to ${fmtD(t)}` };
  }
  if (preset === 'daily') return { preset, from: a, to: a, label: fmtD(a) };
  if (preset === 'weekly') {
    const f = addDays(a, -((dow(a) + 6) % 7));
    return { preset, from: f, to: addDays(f, 6), label: `Week ${fmtD(f)} to ${fmtD(addDays(f, 6))}` };
  }
  if (preset === 'quarterly') {
    const [y, m] = a.split('-').map(Number);
    const q = Math.floor((m - 1) / 3);
    const f = `${y}-${pad(q * 3 + 1)}-01`;
    return { preset, from: f, to: lastOfMonth(y, q * 3 + 3), label: `Q${q + 1} ${y} (Jan–Dec quarters)` };
  }
  if (preset === 'ytd') {
    const y = a.slice(0, 4);
    return { preset, from: `${y}-01-01`, to: a, label: `Year to date ${y}` };
  }
  const [y, m] = a.split('-').map(Number);
  return { preset: 'monthly', from: `${y}-${pad(m)}-01`, to: lastOfMonth(y, m), label: monthName(y, m) };
}

// Shift a resolved period to its comparison period.
//  previous  : day -> previous working day (skips weekly offs / holidays), week -> previous week,
//              month -> previous month, quarter -> previous quarter, ytd/custom -> the same length immediately before
//  last_year : the same dates one year earlier
//  custom    : user supplied
//  none      : no comparison
export function resolveCompare(period, { compare = 'previous', compareFrom, compareTo } = {}, { isWorkingDay } = {}) {
  if (compare === 'none') return null;
  if (compare === 'custom' && isDate(compareFrom)) {
    const t = isDate(compareTo) && compareTo >= compareFrom ? compareTo : compareFrom;
    return { kind: 'custom', from: compareFrom, to: t, label: `${fmtD(compareFrom)} to ${fmtD(t)}` };
  }
  if (compare === 'last_year') {
    const f = minusYear(period.from), t = minusYear(period.to);
    return { kind: 'last_year', from: f, to: t, label: `Same period last year (${fmtD(f)} to ${fmtD(t)})` };
  }
  const { preset, from, to } = period;
  if (preset === 'daily') {
    let d = addDays(from, -1);
    for (let i = 0; i < 14 && isWorkingDay && !isWorkingDay(d); i++) d = addDays(d, -1);
    return { kind: 'previous', from: d, to: d, label: `Previous working day (${fmtD(d)})` };
  }
  if (preset === 'weekly') return { kind: 'previous', from: addDays(from, -7), to: addDays(to, -7), label: 'Previous week' };
  if (preset === 'monthly') {
    const [y, m] = addDays(from, -1).split('-').map(Number);
    return { kind: 'previous', from: `${y}-${pad(m)}-01`, to: lastOfMonth(y, m), label: `Previous month (${monthName(y, m)})` };
  }
  if (preset === 'quarterly') {
    const [y, m] = addDays(from, -1).split('-').map(Number);
    const q = Math.floor((m - 1) / 3);
    return { kind: 'previous', from: `${y}-${pad(q * 3 + 1)}-01`, to: lastOfMonth(y, q * 3 + 3), label: 'Previous quarter' };
  }
  if (preset === 'ytd') return { kind: 'previous', from: minusYear(from), to: minusYear(to), label: 'Same period last year' };
  const len = diffDays(from, to) + 1;
  return { kind: 'previous', from: addDays(from, -len), to: addDays(from, -1), label: `Previous ${len} day(s)` };
}

// When the selected period is still running (ends after today) only the elapsed part is measured, and the
// comparison period is cut to the same number of elapsed days so partial periods compare like with like.
export function applyElapsed(period, cmp, today) {
  if (period.to <= today) return { period: { ...period, elapsed: false }, cmp };
  const effTo = period.from > today ? period.from : today;
  const elapsed = diffDays(period.from, effTo) + 1;
  let c = cmp;
  if (c) { const cTo = addDays(c.from, elapsed - 1); c = { ...c, to: cTo < c.to ? cTo : c.to, label: `${c.label} — first ${elapsed} day(s)` }; }
  return { period: { ...period, to: effTo, elapsed: true, plannedTo: period.to }, cmp: c };
}

// Change object that never shows a misleading percentage.
export function change(cur, prev) {
  if (prev == null || cur == null) return { abs: null, pct: null, dir: 'na', note: 'No comparison available' };
  const abs = Math.round((cur - prev) * 100) / 100;
  const dir = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  if (prev === 0) return { abs, pct: null, dir, note: cur === 0 ? 'No change' : 'New (comparison value was 0)' };
  // a percentage on a tiny base (1 -> 423) is noise, not a trend
  if (Math.abs(prev) < 5 && Math.abs((cur - prev) / prev) > 1) return { abs, pct: null, dir, note: `Comparison base is only ${prev} — % not meaningful` };
  return { abs, pct: Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10, dir, note: '' };
}
