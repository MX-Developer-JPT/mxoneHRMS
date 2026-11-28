// Moving attendance from a person's old (left) employee record to their new one: what happens to each day (pure).
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digits = (v) => String(v || '').replace(/\D/g, '');

/** Does the record say anything real? Placeholder rows (auto-marked absent, week off, holiday, no punches) do not. */
export function hasContent(r) {
  if (!r) return false;
  if (r.check_in_time || r.check_out_time || r.sessions?.length || r.raw_punches?.length || r.biometric_punches?.length) return true;
  if (r.regularised || r.admin_marked || r.leave_id) return true;
  return !['', 'absent', 'week_off', 'weekly_off', 'holiday', 'auto_marked'].includes(String(r.status || ''));
}

/**
 * source / target: [{ id, date, data }] of the old and the new record. `onClash` decides a day where both have real
 * data: 'keep_new' (default) or 'use_old'. Returns what to move, what to replace and what stays where it is.
 */
export function planTransfer(source, target, { from = '', to = '', onClash = 'keep_new' } = {}) {
  const day = (r) => String(r.data.date || '').slice(0, 10);
  const inRange = (d) => d && (!from || d >= from) && (!to || d <= to);
  const targetBy = new Map();
  for (const r of target) { const d = day(r); if (d) targetBy.set(d, [...(targetBy.get(d) || []), r]); }
  const move = [], remove = [], keep = [], clashes = [];
  for (const r of [...source].sort((a, b) => day(a).localeCompare(day(b)))) {
    const d = day(r);
    if (!inRange(d)) continue;
    const there = targetBy.get(d) || [];
    if (!there.length) { move.push(r); continue; }
    const oldReal = hasContent(r.data), newReal = there.some((x) => hasContent(x.data));
    if (oldReal && !newReal) { move.push(r); remove.push(...there); continue; }
    if (oldReal && newReal) {
      clashes.push({ date: d, old_status: r.data.status || '', new_status: there.find((x) => hasContent(x.data)).data.status || '', action: onClash === 'use_old' ? 'use_old' : 'keep_new' });
      if (onClash === 'use_old') { move.push(r); remove.push(...there); } else keep.push(r);
      continue;
    }
    keep.push(r);   // nothing worth moving: the new record already covers the day
  }
  const dates = move.map(day).sort();
  return { move, remove, keep, clashes, first: dates[0] || '', last: dates[dates.length - 1] || '' };
}

/** Likely (old, new) pairs: a left employee and a current one who are evidently the same person. */
export function suggestPairs(leavers, current) {
  const checks = [
    ['PAN', (e) => norm(e.pan_number)], ['Aadhaar', (e) => digits(e.aadhar_number).length === 12 ? digits(e.aadhar_number) : ''],
    ['Bank account', (e) => digits(e.bank_account?.account_number || e.bank_account_number)], ['Mobile', (e) => digits(e.phone).slice(-10).length === 10 ? digits(e.phone).slice(-10) : ''],
    ['Personal email', (e) => norm(e.personal_email)], ['Name', (e) => norm(e.display_name)],
  ];
  const out = [];
  for (const o of leavers) {
    if (o.attendance_transferred_to) continue;
    let best = null;
    for (const n of current) {
      if (n.user_id === o.user_id) continue;
      const same = checks.filter(([, f]) => f(o) && f(o) === f(n)).map(([label]) => label);
      // a shared mobile or e-mail alone can be a relative's: ask for the name too, or an identity number
      const strong = same.some((s) => ['PAN', 'Aadhaar', 'Bank account'].includes(s)) || (same.includes('Name') && same.length > 1);
      if (!strong && !same.includes('Name')) continue;
      const score = same.length + (strong ? 10 : 0);
      if (!best || score > best.score) best = { old_user_id: o.user_id, new_user_id: n.user_id, matched_on: same, strong, score };
    }
    if (best) { const { score, ...pair } = best; out.push(pair); }
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong));
}
