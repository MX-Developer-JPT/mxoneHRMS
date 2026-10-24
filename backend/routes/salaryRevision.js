// Salary revision letters (change in PF rules) — HR/Admin only.
//
// Flow: upload the HR sheet → preview previous vs revised CTC (+ unmatched rows)
// → download/review letters (single, ZIP) → apply revised CTC to salary
// structures (old structure kept as inactive history) → send ONE individual
// email per employee. Each step is explicit and logged (who/when), and apply /
// send are idempotent: a second click skips what is already done unless HR
// deliberately re-sends.
//
// Storage: entities rows — SalaryRevisionBatch (the uploaded sheet + settings,
// no password kept) and SalaryRevisionLog (append-only apply/send audit).
import { Router } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { one, all, run, withTransaction } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { sendEmail } from '../utils/email.js';
import { renderPdf, getLetterheadBgDataUrl, getStampDataUrl, LETTERHEAD_MARGINS } from './functions.js';
import { cacheInvalidate } from './entities.js';
import {
  parseRevisionWorkbook, computeDiff, rowWarnings, namesAgree, pickEmployee,
  buildLetterDocDef, buildEmail, buildStructure, DEFAULT_REASON,
} from '../utils/salaryRevision.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

async function requireHR(req, res) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  let cu = null;
  try { cu = t ? jwt.verify(t, JWT_SECRET) : null; } catch { /* fall through */ }
  if (!cu) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const u = await one('SELECT id, role, custom_role, full_name FROM users WHERE id=$1', [cu.id]);
  const role = u?.custom_role || u?.role;
  if (!u || !['hr', 'admin'].includes(role)) { res.status(403).json({ error: 'HR/Admin access required' }); return null; }
  return { id: u.id, name: u.full_name || '' };
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const maskEmail = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');
const isoDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);

async function loadBatch(id) {
  const r = await one("SELECT id, data FROM entities WHERE type='SalaryRevisionBatch' AND id=$1", [id]);
  return r ? { ...JSON.parse(r.data), id: r.id } : null;
}
async function saveBatch(b) {
  const { id, ...rest } = b;
  await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE type='SalaryRevisionBatch' AND id=$2", [JSON.stringify(rest), id]);
}
async function writeLog(batchId, code, userId, rec) {
  const data = { batch_id: batchId, code, user_id: userId, at: new Date().toISOString(), ...rec };
  await run(`INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,'SalaryRevisionLog',$2,'active',1,$3)`,
    [uuidv4(), userId || null, JSON.stringify(data)]);
}
async function loadLogs(batchId) {
  const rows = await all("SELECT data FROM entities WHERE type='SalaryRevisionLog' AND data::jsonb->>'batch_id'=$1 ORDER BY created_at", [batchId]);
  return rows.map(r => JSON.parse(r.data));
}

/** Fold the audit log into per-code state. */
function stateFromLogs(logs) {
  const st = {};
  for (const l of logs) {
    const s = (st[l.code] = st[l.code] || { applied: null, sent: [], last_error: null, last_action_error: null, tests: 0 });
    if (l.action === 'apply') { if (l.ok) s.applied = l; else s.last_action_error = { action: 'apply', at: l.at, error: l.error }; }
    else if (l.action === 'send') { if (l.ok) s.sent.push(l); else s.last_error = { at: l.at, error: l.error }; }
    else if (l.action === 'test_send') s.tests++;
  }
  return st;
}

function publicRow(row, st) {
  const s = st[row.code] || {};
  const lastSent = s.sent?.length ? s.sent[s.sent.length - 1] : null;
  return {
    code: row.code, name: row.name, department: row.department, designation: row.designation,
    previous: row.previous, revised: row.revised, diff: row.diff,
    match: row.match, warnings: row.warnings, eligible: row.eligible, ineligible_reason: row.ineligible_reason || null,
    email_masked: row.email_masked || null, db: row.db || null,
    applied: s.applied ? { at: s.applied.at, by: s.applied.by_name, structure_id: s.applied.structure_id } : null,
    sent: lastSent ? { at: lastSent.at, by: lastSent.by_name, count: s.sent.length } : null,
    send_error: !lastSent && s.last_error ? s.last_error : null,
    apply_error: !s.applied && s.last_action_error?.action === 'apply' ? s.last_action_error : null,
  };
}

function batchSummary(b, st) {
  const rows = b.rows;
  const eligible = rows.filter(r => r.eligible);
  return {
    id: b.id, filename: b.filename, created_at: b.created_at, created_by_name: b.created_by_name,
    effective_date: b.effective_date, letter_date: b.letter_date, reason_text: b.reason_text,
    signatory: b.signatory, contact_email: b.contact_email, include_take_home: b.include_take_home,
    counts: {
      sheet_rows: rows.length,
      unmatched: rows.filter(r => r.match?.status === 'unmatched').length,
      no_change: rows.filter(r => r.diff?.unchanged).length,
      ineligible: rows.filter(r => !r.eligible).length,
      eligible: eligible.length,
      applied: eligible.filter(r => st[r.code]?.applied).length,
      sent: eligible.filter(r => st[r.code]?.sent?.length).length,
    },
    totals: eligible.reduce((a, r) => ({ previous: a.previous + r.previous.total, revised: a.revised + r.revised.total }), { previous: 0, revised: 0 }),
  };
}

const assets = () => ({ letterhead: getLetterheadBgDataUrl(), stamp: getStampDataUrl(), marginTop: LETTERHEAD_MARGINS.top, marginBottom: LETTERHEAD_MARGINS.bottom });
const empOf = (r) => ({ code: r.code, name: r.name, designation: r.designation, department: r.department });
const letterFor = (b, r) => renderPdf(buildLetterDocDef({ emp: empOf(r), previous: r.previous, revised: r.revised, batch: b, assets: assets() }));
const safeName = (s) => String(s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const letterFilename = (r) => `${safeName(r.code)}_${safeName(r.name)}_Salary_Revision_Letter.pdf`;

/** Rows a bulk action applies to: explicit codes, else every eligible row. */
function targets(b, codes) {
  const set = Array.isArray(codes) && codes.length ? new Set(codes.map(c => String(c).toUpperCase())) : null;
  return b.rows.filter(r => r.eligible && (!set || set.has(r.code.toUpperCase())));
}

/* ───────────────────────── upload + preview ───────────────────────── */
router.post('/upload', upload.single('file'), async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  if (!req.file) return res.status(400).json({ error: 'Choose the revised CTC file (.xls / .xlsx).' });
  let parsed;
  try { parsed = await parseRevisionWorkbook(req.file.buffer, req.body.password || ''); }
  catch (e) { return res.status(400).json({ error: e.message, code: e.code || 'PARSE_FAILED' }); }

  // Match to employees by employee code (case-insensitive); users supply e-mail.
  const emps = await all("SELECT id, user_id, status, data FROM entities WHERE type='Employee'");
  const users = await all('SELECT id, email FROM users');
  const emailBy = Object.fromEntries(users.map(u => [u.id, u.email]));
  const ssRows = await all("SELECT user_id, data FROM entities WHERE type='SalaryStructure' AND status='active'");
  const ssBy = {};
  for (const s of ssRows) { try { (ssBy[s.user_id] = ssBy[s.user_id] || []).push(JSON.parse(s.data)); } catch { /* skip */ } }
  const byCode = {};
  for (const e of emps) {
    let d; try { d = JSON.parse(e.data); } catch { continue; }
    const c = String(d.employee_code || '').trim().toUpperCase();
    if (!c) continue;
    (byCode[c] = byCode[c] || []).push({ entity_id: e.id, user_id: e.user_id, status: e.status, email: emailBy[e.user_id] || d.official_email || '', full_name: d.full_name || d.display_name || '', hasStructure: !!ssBy[e.user_id]?.length });
  }

  const seen = new Set();
  const rows = parsed.rows.map(r => {
    const warnings = rowWarnings(r);
    const key = r.code.toUpperCase();
    if (seen.has(key)) warnings.push('Employee code appears more than once in the sheet');
    seen.add(key);
    const { diff, changed, unchanged } = computeDiff(r.previous, r.revised);
    const cands = byCode[key] || [];
    const { pick, duplicate, ambiguous } = pickEmployee(cands);
    const out = { ...r, diff: { ...diff, changed, unchanged }, warnings, eligible: true };
    if (!pick) {
      out.match = { status: 'unmatched' }; out.eligible = false; out.ineligible_reason = 'No employee with this code';
      return out;
    }
    out.match = { status: duplicate ? 'duplicate' : 'matched', employee_name: pick.full_name };
    out.user_id = pick.user_id; out.employee_entity_id = pick.entity_id;
    out.email_masked = maskEmail(pick.email);
    if (duplicate) warnings.push(`${cands.length} employee records share this code — using the ${ambiguous ? 'first (please verify)' : 'best match'}: ${maskEmail(pick.email)}`);
    if (!namesAgree(r.name, pick.full_name)) warnings.push(`Name differs from the employee record (${pick.full_name})`);
    if (!pick.email) { warnings.push('No email address on record'); }
    const active = ssBy[pick.user_id]?.[0];
    const dbMonthly = active ? r2m(active) : null;
    out.db = { has_structure: !!active, monthly_total: dbMonthly };
    if (!active) warnings.push('No active salary structure on record — apply will create one');
    else if (dbMonthly != null && Math.abs(dbMonthly - r.previous.total) > 2) warnings.push(`Salary structure in the system (${Math.round(dbMonthly).toLocaleString('en-IN')}/month) differs from the sheet's current CTC`);
    if (pick.status !== 'active') { out.eligible = false; out.ineligible_reason = `Employee status: ${pick.status || 'inactive'}`; }
    else if (unchanged) { out.eligible = false; out.ineligible_reason = 'No change in CTC'; }
    return out;
  });

  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const batch = {
    filename: String(req.file.originalname || 'upload').slice(0, 120),
    created_at: now.toISOString(), created_by: cu.id, created_by_name: cu.name,
    sheet: parsed.sheet,
    effective_date: isoDate(req.body.effective_date) || firstOfMonth,
    letter_date: todayIso(),
    reason_text: DEFAULT_REASON,
    signatory: 'Human Resources',
    contact_email: process.env.HR_EMAIL || 'hr@maxvoltenergy.com',
    include_take_home: true,
    rows,
  };
  const id = uuidv4();
  await run(`INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,'SalaryRevisionBatch',NULL,'active',1,$2)`, [id, JSON.stringify(batch)]);
  const b = { ...batch, id };
  const st = {};
  res.json({ success: true, batch: batchSummary(b, st), rows: rows.map(r => publicRow(r, st)) });
});

// monthly total of an existing structure (ctc is annual; total_ctc is monthly)
function r2m(s) { return s.total_ctc ? Number(s.total_ctc) : s.ctc ? Number(s.ctc) / 12 : null; }

router.get('/batches', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const rows = await all("SELECT id, data FROM entities WHERE type='SalaryRevisionBatch' ORDER BY created_at DESC LIMIT 20");
  const out = [];
  for (const r of rows) {
    const b = { ...JSON.parse(r.data), id: r.id };
    out.push(batchSummary(b, stateFromLogs(await loadLogs(b.id))));
  }
  res.json({ batches: out });
});

router.get('/batches/:id', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const st = stateFromLogs(await loadLogs(b.id));
  res.json({ batch: batchSummary(b, st), rows: b.rows.map(r => publicRow(r, st)) });
});

router.post('/batches/:id/settings', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const p = req.body || {};
  const logs = await loadLogs(b.id);
  const touched = logs.some(l => l.ok && (l.action === 'apply' || l.action === 'send'));
  if (isoDate(p.effective_date)) {
    if (touched && p.effective_date !== b.effective_date) return res.status(409).json({ error: 'The effective date cannot change after salary structures were applied or letters were sent.' });
    b.effective_date = p.effective_date;
  }
  if (isoDate(p.letter_date)) b.letter_date = p.letter_date;
  if (typeof p.reason_text === 'string' && p.reason_text.trim()) b.reason_text = p.reason_text.trim().slice(0, 2000);
  if (typeof p.signatory === 'string') b.signatory = p.signatory.trim().slice(0, 120) || 'Human Resources';
  if (typeof p.contact_email === 'string' && /^\S+@\S+\.\S+$/.test(p.contact_email.trim())) b.contact_email = p.contact_email.trim();
  if (typeof p.include_take_home === 'boolean') b.include_take_home = p.include_take_home;
  await saveBatch(b);
  const st = stateFromLogs(logs);
  res.json({ success: true, batch: batchSummary(b, st) });
});

router.delete('/batches/:id', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const logs = await loadLogs(req.params.id);
  if (logs.some(l => l.ok)) return res.status(409).json({ error: 'This batch has applied/sent records and cannot be deleted.' });
  await run("DELETE FROM entities WHERE type='SalaryRevisionBatch' AND id=$1", [req.params.id]);
  res.json({ success: true });
});

/* ───────────────────────── review: letters ───────────────────────── */
router.get('/batches/:id/letter/:code', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const r = b.rows.find(x => x.code.toUpperCase() === String(req.params.code).toUpperCase());
  if (!r || r.match?.status === 'unmatched') return res.status(404).json({ error: 'No letter for this code' });
  const pdf = await letterFor(b, r);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${letterFilename(r)}"`);
  res.send(pdf);
});

router.post('/batches/:id/letters.zip', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const list = targets(b, req.body?.codes);
  if (!list.length) return res.status(400).json({ error: 'No letters match the selection.' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="Salary_Revision_Letters_${b.effective_date}.zip"`);
  const zip = archiver('zip', { zlib: { level: 6 } });
  zip.on('error', (e) => { console.error('[salary-revision] zip error:', e.message); res.destroy(e); });
  zip.pipe(res);
  for (const r of list) zip.append(await letterFor(b, r), { name: letterFilename(r) });
  await zip.finalize();
});

/* ───────────────────────── apply to salary structures ───────────────────────── */
router.post('/batches/:id/apply', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const list = targets(b, req.body?.codes);
  const st = stateFromLogs(await loadLogs(b.id));
  const todo = list.filter(r => !st[r.code]?.applied);
  const already = list.length - todo.length;
  // Two-step: without confirm_count nothing is written, the caller gets the count to confirm.
  if (Number(req.body?.confirm_count) !== todo.length) {
    return res.json({ success: true, dry_run: true, will_apply: todo.length, already_applied: already, effective_date: b.effective_date });
  }
  const results = [];
  for (const r of todo) {
    try {
      const out = await withTransaction(async (c) => {
        const cur = (await c.query("SELECT id, data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active' ORDER BY created_at DESC", [r.user_id])).rows;
        // Idempotency guard even if the log is missing: a structure from this batch already exists.
        const dup = (await c.query("SELECT id FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND data::jsonb->>'revision_batch_id'=$2", [r.user_id, b.id])).rows[0];
        if (dup) return { structure_id: dup.id, existed: true };
        const prev = cur[0] ? { ...JSON.parse(cur[0].data), id: cur[0].id } : null;
        const id = uuidv4();
        const s = buildStructure({ id, userId: r.user_id, prevStructure: prev, revised: r.revised, batch: b, approvedBy: cu.id, now: new Date().toISOString() });
        await c.query(`INSERT INTO entities (id, type, user_id, status, is_active, data) VALUES ($1,'SalaryStructure',$2,'active',1,$3)`, [id, r.user_id, JSON.stringify(s)]);
        // Old structures stay as inactive history, stamped with what superseded them.
        const dayBefore = new Date(new Date(b.effective_date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
        for (const o of cur) {
          const od = JSON.parse(o.data);
          od.status = 'inactive'; od.superseded_by = id; od.superseded_at = new Date().toISOString(); od.effective_to = od.effective_to || dayBefore; od.superseded_by_batch = b.id;
          await c.query("UPDATE entities SET status='inactive', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(od), o.id]);
        }
        return { structure_id: id, replaced: cur.length };
      });
      await writeLog(b.id, r.code, r.user_id, { action: 'apply', ok: true, by: cu.id, by_name: cu.name, structure_id: out.structure_id, effective_date: b.effective_date });
      results.push({ code: r.code, ok: true, structure_id: out.structure_id });
    } catch (e) {
      console.error('[salary-revision] apply failed for', r.code, e.message);
      await writeLog(b.id, r.code, r.user_id, { action: 'apply', ok: false, by: cu.id, by_name: cu.name, error: e.message.slice(0, 200) }).catch(() => {});
      results.push({ code: r.code, ok: false, error: e.message.slice(0, 200) });
    }
  }
  cacheInvalidate('SalaryStructure');
  res.json({ success: true, applied: results.filter(x => x.ok).length, failed: results.filter(x => !x.ok).length, already_applied: already, results });
});

/* ───────────────────────── send emails ───────────────────────── */
const sending = new Set();
router.post('/batches/:id/send', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const b = await loadBatch(req.params.id);
  if (!b) return res.status(404).json({ error: 'Batch not found' });
  const p = req.body || {};
  const test_to = typeof p.test_to === 'string' ? p.test_to.trim() : '';
  if (test_to && !/^\S+@\S+\.\S+$/.test(test_to)) return res.status(400).json({ error: 'Enter a valid test email address.' });
  const list = targets(b, p.codes);
  const st = stateFromLogs(await loadLogs(b.id));
  const resend = p.resend === true;
  // A test send mails the letter to HR's own address, never to the employee, and is not recorded as "sent".
  const todo = test_to ? list.slice(0, 3) : list.filter(r => resend || !st[r.code]?.sent?.length);
  const skipped = list.length - todo.length;
  if (!test_to && Number(p.confirm_count) !== todo.length) {
    return res.json({ success: true, dry_run: true, will_send: todo.length, already_sent: skipped, not_applied: todo.filter(r => !st[r.code]?.applied).length });
  }
  if (sending.has(b.id)) return res.status(409).json({ error: 'A send for this batch is already running.' });
  sending.add(b.id);
  const results = [];
  try {
    for (const r of todo) {
      const fresh = (await all('SELECT email FROM users WHERE id=$1', [r.user_id]))[0];
      const to = test_to || fresh?.email;
      // Re-check the log right before sending so two overlapping clicks can't double-send.
      if (!test_to && !resend && stateFromLogs(await loadLogs(b.id))[r.code]?.sent?.length) { results.push({ code: r.code, ok: true, skipped: true }); continue; }
      try {
        if (!to) throw new Error('No email address on record');
        const pdf = await letterFor(b, r);
        const mail = buildEmail({ emp: empOf(r), previous: r.previous, revised: r.revised, batch: b });
        const out = await sendEmail({
          to, subject: (test_to ? '[TEST] ' : '') + mail.subject, html: mail.html, text: mail.text,
          attachments: [{ filename: letterFilename(r), content: pdf }], meta: { source: 'salary-revision' },
        });
        await writeLog(b.id, r.code, r.user_id, { action: test_to ? 'test_send' : 'send', ok: true, by: cu.id, by_name: cu.name, to_masked: maskEmail(to), message_id: out?.messageId || '', resend: resend && !test_to });
        results.push({ code: r.code, ok: true });
      } catch (e) {
        await writeLog(b.id, r.code, r.user_id, { action: test_to ? 'test_send' : 'send', ok: false, by: cu.id, by_name: cu.name, to_masked: maskEmail(to), error: String(e.message).slice(0, 200) }).catch(() => {});
        results.push({ code: r.code, ok: false, error: String(e.message).slice(0, 200) });
      }
    }
  } finally { sending.delete(b.id); }
  res.json({ success: true, test: !!test_to, sent: results.filter(x => x.ok && !x.skipped).length, failed: results.filter(x => !x.ok).length, already_sent: skipped, results });
});

router.get('/batches/:id/log', async (req, res) => {
  const cu = await requireHR(req, res); if (!cu) return;
  const logs = await loadLogs(req.params.id);
  res.json({ log: logs.slice(-500).reverse().map(l => ({ at: l.at, code: l.code, action: l.action, ok: l.ok, by: l.by_name, to: l.to_masked || null, error: l.error || null })) });
});

export default router;
