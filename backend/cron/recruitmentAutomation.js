// Recruitment automation — runs unattended (see server.js for the schedule).
// 1. Fires due candidate reminders (set from the Recruitment page) as an
//    in-app + push notification to whoever set them.
// 2. Flags candidates that have sat in an active pipeline stage too long,
//    and job requisitions that have been open too long without a new
//    candidate — notifying HR/admin and the requisition's hiring manager.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';

const STALL_DAYS_CANDIDATE   = 10; // no status change in this many days while still active
const STALL_DAYS_REQUISITION = 21; // requisition open this long with no new candidate
const RE_ALERT_DAYS          = 7;  // don't re-notify the same stale item more than once a week
const TERMINAL_STATUSES = ['joined', 'rejected', 'offer_declined'];

async function notify(userId, { title, message, type = 'info', link = '' }) {
  if (!userId) return;
  try {
    await run(
      "INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)",
      [uuidv4(), userId, title, message, type, link || null]
    );
    const { sendPushToUser } = await import('../utils/push.js');
    sendPushToUser(userId, { title, message, type, link });
  } catch (e) { console.error('[recruitment-cron] notify failed:', e.message); }
}

async function getHrAdminUserIds() {
  const rows = await all("SELECT id FROM users WHERE COALESCE(NULLIF(custom_role,''), role) IN ('hr','admin')");
  return rows.map(r => r.id);
}

// ── Candidate reminders ──────────────────────────────────────
export async function sendDueCandidateReminders() {
  const now = new Date().toISOString();
  const rows = await all(
    "SELECT id, data FROM entities WHERE type='CandidateReminder' AND status='pending' AND data::jsonb->>'remind_at' <= $1",
    [now]
  );
  let sent = 0;
  for (const row of rows) {
    const r = JSON.parse(row.data);
    const candRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [r.candidate_id]);
    const cand = candRow ? JSON.parse(candRow.data) : {};
    await notify(r.created_by, {
      title: 'Candidate Follow-up Reminder',
      message: `${cand.full_name || 'A candidate'}${cand.position_applied ? ` (${cand.position_applied})` : ''} — ${r.note || 'follow up now'}`,
      type: 'warning',
      link: '/Recruitment',
    });
    await run("UPDATE entities SET status='sent', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [
      JSON.stringify({ ...r, status: 'sent', sent_at: now }), row.id,
    ]);
    sent++;
  }
  return { checked: rows.length, sent };
}

// ── Pipeline / requisition stall alerts ──────────────────────
export async function checkStalePipeline() {
  const now = Date.now();
  const reAlertCutoff = new Date(now - RE_ALERT_DAYS * 86400000).toISOString();
  const hrAdminIds = await getHrAdminUserIds();

  // Stalled candidates: active status, no update in STALL_DAYS_CANDIDATE days,
  // not already alerted within the last RE_ALERT_DAYS days.
  const candRows = await all("SELECT id, data, updated_at, created_at FROM entities WHERE type='Candidate'");
  let candidatesFlagged = 0;
  const reqCache = {};
  for (const row of candRows) {
    const c = JSON.parse(row.data);
    if (TERMINAL_STATUSES.includes(c.status)) continue;
    const lastTouched = row.updated_at || row.created_at;
    if (!lastTouched) continue;
    const daysStalled = Math.floor((now - new Date(lastTouched).getTime()) / 86400000);
    if (daysStalled < STALL_DAYS_CANDIDATE) continue;
    if (c.stale_alerted_at && c.stale_alerted_at > reAlertCutoff) continue;

    const reqId = c.job_id || c.requisition_id;
    let hiringManagerId = null;
    if (reqId) {
      if (!(reqId in reqCache)) {
        const reqRow = await one("SELECT data FROM entities WHERE type='JobRequisition' AND id=$1", [reqId]);
        reqCache[reqId] = reqRow ? JSON.parse(reqRow.data) : null;
      }
      hiringManagerId = reqCache[reqId]?.hiring_manager_id || null;
    }

    const recipients = [...new Set([...hrAdminIds, hiringManagerId].filter(Boolean))];
    for (const uid of recipients) {
      await notify(uid, {
        title: 'Candidate Stalled in Pipeline',
        message: `${c.full_name || 'A candidate'} (${c.position_applied || 'role unspecified'}) has been in "${(c.status || 'applied').replace(/_/g, ' ')}" for ${daysStalled} days with no update.`,
        type: 'warning',
        link: '/Recruitment',
      });
    }
    await run("UPDATE entities SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...c, stale_alerted_at: new Date().toISOString() }), row.id,
    ]);
    candidatesFlagged++;
  }

  // Aging requisitions: open/published/approved, older than STALL_DAYS_REQUISITION
  // days, with no candidate created against it in the last STALL_DAYS_REQUISITION days.
  const reqRows = await all("SELECT id, data, created_at FROM entities WHERE type='JobRequisition' AND status IN ('approved','published','on_hold')");
  let requisitionsFlagged = 0;
  for (const row of reqRows) {
    const r = JSON.parse(row.data);
    const createdAt = row.created_at;
    if (!createdAt) continue;
    const daysOpen = Math.floor((now - new Date(createdAt).getTime()) / 86400000);
    if (daysOpen < STALL_DAYS_REQUISITION) continue;
    if (r.stale_alerted_at && r.stale_alerted_at > reAlertCutoff) continue;

    const recentCandidateRow = await one(
      "SELECT id FROM entities WHERE type='Candidate' AND (data::jsonb->>'job_id'=$1 OR data::jsonb->>'requisition_id'=$1) AND created_at >= $2 LIMIT 1",
      [row.id, new Date(now - STALL_DAYS_REQUISITION * 86400000).toISOString()]
    );
    if (recentCandidateRow) continue; // still getting fresh candidates — not stalled

    const recipients = [...new Set([...hrAdminIds, r.hiring_manager_id].filter(Boolean))];
    for (const uid of recipients) {
      await notify(uid, {
        title: 'Requisition Aging Without Movement',
        message: `${r.position_title || 'A requisition'} (${r.department || ''}) has been open ${daysOpen} days with no new candidates in the last ${STALL_DAYS_REQUISITION} days.`,
        type: 'warning',
        link: '/JobRequisitions',
      });
    }
    await run("UPDATE entities SET data=$1 WHERE id=$2", [
      JSON.stringify({ ...r, stale_alerted_at: new Date().toISOString() }), row.id,
    ]);
    requisitionsFlagged++;
  }

  return { candidatesFlagged, requisitionsFlagged };
}
