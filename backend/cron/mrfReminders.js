// Manpower requisitions: remind HR (and the Hiring Manager) when a target hiring date is close or has passed, and nudge a Hiring
// Manager whose Job Description has been waiting for approval. Each reminder is sent once per stage so nobody is spammed.
import { v4 as uuidv4 } from 'uuid';
import { all, run } from '../db.js';

const LIVE = ['pending_hm_approval', 'changes_requested', 'pending_hr_publication', 'published', 'on_hold'];
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

async function notify(userIds, title, message) {
  for (const uid of [...new Set(userIds.filter(Boolean))]) {
    try { await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,'warning','/ManpowerRequisitions')", [uuidv4(), uid, title, message]); } catch (e) { console.warn('[mrf-reminders] notify failed:', e.message); }
  }
}

export async function sendMrfReminders() {
  const today = istToday();
  const hr = (await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin','recruiter') OR role IN ('hr','admin','recruiter')")).map((r) => r.id);
  const rows = await all("SELECT id, data FROM entities WHERE type='JobRequisition'");
  let sent = 0;
  for (const row of rows) {
    let r; try { r = JSON.parse(row.data); } catch { continue; }
    if (r.mrf_version !== 2 || !LIVE.includes(r.status)) continue;
    const label = `${r.requisition_id} — ${r.designation || 'position'} (${r.department || ''})`;
    let changed = false;
    if (r.target_hire_date) {
      const d = daysBetween(today, r.target_hire_date);
      const stage = d < 0 ? 'overdue' : d <= 3 ? 'due_soon' : null;
      if (stage && r.target_hire_date_reminded !== `${stage}:${r.target_hire_date}`) {
        await notify([...hr, r.hiring_manager_id], d < 0 ? 'Hiring target date passed' : 'Hiring target date approaching', d < 0 ? `${label} passed its target hiring date (${r.target_hire_date}) and is still open.` : `${label} has a target hiring date in ${d} day(s) (${r.target_hire_date}).`);
        r.target_hire_date_reminded = `${stage}:${r.target_hire_date}`; changed = true; sent++;
      }
    }
    if (r.status === 'pending_hm_approval' && r.submitted_at && daysBetween(r.submitted_at.slice(0, 10), today) >= 3 && r.hm_nudged_for !== r.submitted_at) {
      await notify([r.hiring_manager_id], 'Job Description still waiting for you', `${label} has been waiting for your Job Description approval for ${daysBetween(r.submitted_at.slice(0, 10), today)} days.`);
      r.hm_nudged_for = r.submitted_at; changed = true; sent++;
    }
    if (changed) await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(r), row.id]);
  }
  try { const { sendHiringReminders } = await import('../routes/hiringApi.js'); sent += await sendHiringReminders(); } catch (e) { console.warn('[hiring-reminders] failed:', e.message); }
  if (sent) console.log(`[mrf-reminders] sent ${sent} reminder(s)`);
  return sent;
}
