// History capture for the Intelligent MIS — the data the app did not keep before:
//   • DeptTransfer       one record per department change (who, from, to, effective date, reason)
//   • HeadcountSnapshot  nightly: who is in which department, open vacancies, offer pipeline, candidate stages
//   • JobRequisition.closed_date / closed_reason, Candidate.status_history
// Precise capture happens in the write hooks (routes/entities.js); the nightly snapshot is the catch-all for
// any other write path (bulk imports, server-side functions) and detects changes by diffing against the last snapshot.
import { v4 as uuidv4 } from 'uuid';
import { buildModel, loadType, normDept } from './analytics.js';

const db = async () => import('../../db.js');
const IST_MS = 5.5 * 3600000;
const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const FILLED = new Set(['joined', 'hired', 'onboarded']);
const OFFER = new Set(['offered', 'offer_released', 'offer_sent', 'offer_accepted', 'offer_declined', 'offer_rejected', 'selected', 'joined', 'hired']);

// ── transfers ─────────────────────────────────────────────────────────────
export async function recordTransfer({ user_id, from_department, to_department, effective_date, reason = '', by = '', source = 'recorded' }) {
  const from = normDept(from_department), to = normDept(to_department);
  if (!user_id || from === to) return null;
  const { run, one } = await db();
  const eff = /^\d{4}-\d{2}-\d{2}$/.test(String(effective_date || '')) ? effective_date : istDate();
  // never record the same move twice (hook + nightly detection, or a double click)
  const dupe = await one("SELECT id FROM entities WHERE type='DeptTransfer' AND user_id=$1 AND data::jsonb->>'to_department'=$2 AND data::jsonb->>'effective_date'=$3", [user_id, to, eff]);
  if (dupe) return dupe.id;
  const id = uuidv4();
  const data = { id, user_id, from_department: from, to_department: to, effective_date: eff, reason: String(reason || '').slice(0, 300), recorded_by: by, source, recorded_at: new Date().toISOString() };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'DeptTransfer',$2,'active',$3)", [id, user_id, JSON.stringify(data)]);
  return id;
}

// ── write hooks (called from routes/entities.js after a successful PATCH; never throw) ──
export async function trackEntityChange(type, before, after, by) {
  try {
    if (type === 'Employee' && after.department !== undefined && normDept(after.department) !== normDept(before.department)) {
      await recordTransfer({ user_id: after.user_id || before.user_id, from_department: before.department, to_department: after.department, effective_date: after.department_effective_date, reason: after.department_change_reason, by, source: 'recorded' });
    }
    if (type === 'JobRequisition' && after.status !== before.status) await trackRequisition(after, before);
    if (type === 'Candidate' && after.status !== before.status) await appendCandidateStatus(after.id, after.status, by, 'edit');
  } catch (e) { console.warn('[mis-history] hook failed:', e.message); }
}

async function trackRequisition(after, before) {
  const { run, one } = await db();
  const data = { ...after };
  if (after.status === 'closed' && before.status !== 'closed') {
    const positions = Math.max(1, Number(after.number_of_positions) || 1);
    const row = await one("SELECT count(*) n FROM entities WHERE type='Candidate' AND data::jsonb->>'job_id'=$1 AND data::jsonb->>'status' IN ('joined','hired','onboarded')", [after.id]);
    data.closed_date = new Date().toISOString();
    data.closed_reason = Number(row?.n || 0) >= positions ? 'filled' : 'closed';
    data.closed_date_source = 'recorded';
  } else if (after.status !== 'closed' && before.status === 'closed') {
    delete data.closed_date; delete data.closed_reason; delete data.closed_date_source;
  } else return;
  await run('UPDATE entities SET data=$1 WHERE id=$2', [JSON.stringify(data), after.id]);
}

async function appendCandidateStatus(id, status, by, source) {
  const { run, one } = await db();
  const row = await one("SELECT data FROM entities WHERE id=$1 AND type='Candidate'", [id]);
  if (!row) return;
  const d = JSON.parse(row.data);
  const hist = Array.isArray(d.status_history) ? d.status_history : [];
  if (!hist.length && d.applied_date) hist.push({ status: 'applied', at: `${String(d.applied_date).slice(0, 10)}T00:00:00.000Z`, source: 'applied_date' });
  if (hist[hist.length - 1]?.status === status) return;
  hist.push({ status, at: new Date().toISOString(), by: by || '', source });
  d.status_history = hist;
  await run('UPDATE entities SET data=$1 WHERE id=$2', [JSON.stringify(d), id]);
}

// ── snapshot ──────────────────────────────────────────────────────────────
export async function buildSnapshot(date = istDate()) {
  const [employees, reqs, cands] = await Promise.all([loadType('Employee'), loadType('JobRequisition'), loadType('Candidate')]);
  const model = buildModel({ employees, shifts: [], holidays: [], exits: [] });
  const members = {}, byDept = {};
  for (const e of model.emps) {
    if (!model.activeOn(e, date)) continue; // same rule as headcount: people serving notice count until their last working day
    members[e.uid] = e.dept; byDept[e.dept] = (byDept[e.dept] || 0) + 1;
  }
  const byReq = {}; for (const c of cands) (byReq[c.job_id || ''] ||= []).push(c);
  const vac = { open: 0, reqs: 0, by_dept: {} };
  const reqStatus = {};
  for (const r of reqs) {
    reqStatus[r.id] = r.status;
    if (r.status !== 'published' && r.status !== 'open') continue;
    const positions = Math.max(1, Number(r.number_of_positions) || 1);
    const rem = Math.max(positions - (byReq[r.id] || []).filter(c => FILLED.has(c.status)).length, 0);
    const dp = normDept(r.department);
    vac.reqs++; vac.open += rem; vac.by_dept[dp] = (vac.by_dept[dp] || 0) + rem;
  }
  const candStatus = {}; for (const c of cands) candStatus[c.id] = c.status || 'applied';
  const offers = { released: cands.filter(c => OFFER.has(c.status)).length, accepted: cands.filter(c => c.status === 'offer_accepted').length, declined: cands.filter(c => ['offer_declined', 'offer_rejected'].includes(c.status)).length };
  // total sums the departments (not the member keys): duplicate employee records share one key
  return { date, taken_at: new Date().toISOString(), total: Object.values(byDept).reduce((x, n) => x + n, 0), by_dept: byDept, members, vacancies: vac, offers, req_status: reqStatus, cand_status: candStatus };
}

// Returns what changed since the previous snapshot; applies it when persist is true.
export async function runSnapshot({ date = istDate(), persist = true } = {}) {
  const { run, one } = await db();
  const snap = await buildSnapshot(date);
  const prevRow = await one("SELECT data FROM entities WHERE type='HeadcountSnapshot' AND data::jsonb->>'date' < $1 ORDER BY data::jsonb->>'date' DESC LIMIT 1", [date]);
  const prev = prevRow ? JSON.parse(prevRow.data) : null;
  const out = { date, snapshot: { total: snap.total, vacancies: snap.vacancies, offers: snap.offers }, transfers: [], candidateMoves: 0, closedReqs: 0, first: !prev, persisted: false };
  if (prev) {
    for (const [uid, dept] of Object.entries(snap.members)) {
      const was = prev.members?.[uid];
      if (was && normDept(was) !== normDept(dept)) out.transfers.push({ uid, from: was, to: dept });
    }
    for (const [id, st] of Object.entries(snap.cand_status)) if (prev.cand_status?.[id] && prev.cand_status[id] !== st) out.candidateMoves++;
    for (const [id, st] of Object.entries(snap.req_status)) if (st === 'closed' && prev.req_status?.[id] && prev.req_status[id] !== 'closed') out.closedReqs++;
  }
  if (!persist) return out;
  if (prev) {
    for (const t of out.transfers) await recordTransfer({ user_id: t.uid, from_department: t.from, to_department: t.to, effective_date: date, reason: 'Detected from nightly headcount snapshot', source: 'detected' });
    for (const [id, st] of Object.entries(snap.cand_status)) if (prev.cand_status?.[id] && prev.cand_status[id] !== st) await appendCandidateStatus(id, st, '', 'snapshot');
    for (const [id, st] of Object.entries(snap.req_status)) {
      if (st !== 'closed' || !prev.req_status?.[id] || prev.req_status[id] === 'closed') continue;
      const r = await one("SELECT data FROM entities WHERE id=$1 AND type='JobRequisition'", [id]);
      if (!r) continue;
      const d = JSON.parse(r.data);
      if (d.closed_date) continue;
      const positions = Math.max(1, Number(d.number_of_positions) || 1);
      const joined = (await one("SELECT count(*) n FROM entities WHERE type='Candidate' AND data::jsonb->>'job_id'=$1 AND data::jsonb->>'status' IN ('joined','hired','onboarded')", [id])).n;
      d.closed_date = new Date().toISOString(); d.closed_reason = Number(joined) >= positions ? 'filled' : 'closed'; d.closed_date_source = 'detected';
      await run('UPDATE entities SET data=$1 WHERE id=$2', [JSON.stringify(d), id]);
    }
  }
  const id = `snap-${date}`;
  const payload = JSON.stringify({ id, ...snap });
  const exists = await one("SELECT id FROM entities WHERE id=$1", [id]);
  if (exists) await run('UPDATE entities SET data=$1 WHERE id=$2', [payload, id]);
  else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'HeadcountSnapshot',NULL,'active',$2)", [id, payload]);
  out.persisted = true;
  return out;
}

// Called at boot and nightly: take today's snapshot if it is missing.
export async function ensureTodaySnapshot() {
  const { one } = await db();
  const have = await one("SELECT id FROM entities WHERE id=$1", [`snap-${istDate()}`]);
  if (have) return null;
  return runSnapshot({});
}
