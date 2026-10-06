// One-time sync of the 2026 holiday calendar to the official "Holiday List 2026".
// Runs on server start, applies once (guarded by a MigrationFlag row), upserts
// every listed holiday by date and removes any other 2026 holiday. The removed
// rows are kept inside the flag row so nothing is unrecoverable.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';

const FLAG_ID = 'migration-holiday-list-2026-v1';

export const HOLIDAYS_2026 = [
  ['New Year’s Day',  '2026-01-01', 'Public Holiday'],
  ['Republic Day',    '2026-01-26', 'National Holiday'],
  ['Holi',            '2026-03-04', 'Religious Holiday'],
  ['Labour Day',      '2026-05-01', 'Public Holiday'],
  ['Independence Day','2026-08-15', 'National Holiday'],
  ['Raksha Bandhan',  '2026-08-28', 'Religious Holiday'],
  ['Janmashtami',     '2026-09-04', 'Religious Holiday'],
  ['Gandhi Jayanti',  '2026-10-02', 'National Holiday'],
  ['Dussehra',        '2026-10-20', 'Religious Holiday'],
  ['Diwali',          '2026-11-09', 'Religious Holiday'],
  ['Govardhan Puja',  '2026-11-10', 'Religious Holiday'],
  ['Bhai Dooj',       '2026-11-11', 'Religious Holiday'],
];

export async function syncHolidayList2026() {
  if (await one("SELECT id FROM entities WHERE id=$1", [FLAG_ID])) return { skipped: true };

  const existing = (await all("SELECT id, data FROM entities WHERE type='Holiday'"))
    .map(r => ({ id: r.id, d: JSON.parse(r.data) }))
    .filter(r => String(r.d.date || '').slice(0, 4) === '2026');
  const byDate = new Map();
  const removed = [];
  const wanted = new Set(HOLIDAYS_2026.map(h => h[1]));

  for (const r of existing) {
    const date = String(r.d.date).slice(0, 10);
    if (wanted.has(date) && !byDate.has(date)) byDate.set(date, r);
    else { removed.push(r.d); await run("DELETE FROM entities WHERE id=$1", [r.id]); } // not on the list, or a duplicate date
  }

  let created = 0, updated = 0;
  for (const [name, date, category] of HOLIDAYS_2026) {
    const data = {
      name, date, year: 2026, type: 'public', description: category,
      applicable_departments: [], is_half_day: false, half_day_hours: null,
    };
    const cur = byDate.get(date);
    if (cur) {
      await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...cur.d, ...data, id: cur.id }), cur.id]);
      updated++;
    } else {
      const id = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Holiday',NULL,'active',$2)", [id, JSON.stringify({ ...data, id })]);
      created++;
    }
  }
  await run("INSERT INTO entities(id,type,status,data) VALUES($1,'MigrationFlag','done',$2)", [FLAG_ID, JSON.stringify({ id: FLAG_ID, applied_at: new Date().toISOString(), created, updated, removed })]);
  console.log(`[holiday-sync] 2026 holiday list applied — created ${created}, updated ${updated}, removed ${removed.length}`);
  return { created, updated, removed: removed.length };
}
