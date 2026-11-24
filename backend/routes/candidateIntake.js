// One place for every candidate, whatever the source: bulk CV upload, Naukri / LinkedIn / Indeed exports, quick add, and CVs that
// arrive by email. Every entry is matched against the candidates already in the app (email, phone, name + company) so a person is never
// duplicated — a repeat becomes a new CV and a new source on the same profile, with the history kept. Anything the app cannot place
// with confidence goes to an inbox for HR instead of being dropped. `ci_*` functions are dispatched from functions.js.
import { Router } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, timingSafeEqual } from 'crypto';
import { one, all, run } from '../db.js';
import { extractResumeText } from '../utils/cvReader.js';
import { analyseResumeText } from '../utils/cvScreening.js';
import { saveBuffer } from '../utils/fileStore.js';
import { cacheInvalidate } from './entities.js';
import * as LC from '../utils/hiringLifecycle.js';

const RECRUIT = ['hr', 'admin', 'recruiter'];
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const nowIso = () => new Date().toISOString();
const hasAny = (cx, list) => cx.roles.some((r) => list.includes(r));
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
export const SOURCES = ['careers_portal', 'naukri', 'linkedin', 'indeed', 'email', 'agency', 'walk_in', 'referral', 'internal_database', 'other'];
const normSource = (s) => { const k = String(s || '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return SOURCES.includes(k) ? k : (k.includes('naukri') ? 'naukri' : k.includes('linkedin') ? 'linkedin' : k.includes('indeed') ? 'indeed' : 'other'); };
const normEmail = (e) => { const m = String(e || '').trim().toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/); return m ? m[0] : ''; };
const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const candName = (c) => c.full_name || c.name || 'Candidate';

/** The person's name from the top of the CV, else from the file name. */
export function guessName(text, filename = '') {
  const BAD = /resume|curriculum|vitae|\bcv\b|profile|biodata|bio-data|contact|email|mobile|phone|address|objective|summary|page \d|confidential/i;
  for (const raw of String(text || '').split(/\r?\n/).slice(0, 14)) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (!l || l.length > 45 || /[@\d:/\\|]/.test(l) || BAD.test(l)) continue;
    const words = l.replace(/[^A-Za-z.' -]/g, '').trim().split(' ').filter(Boolean);
    if (words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w)) && words.join('').length >= 3) return titleCase(words.join(' '));
  }
  const base = String(filename).replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').replace(/\b(cv|resume|curriculum|vitae|updated|latest|final|new|naukri|linkedin|\d+)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return base && /[A-Za-z]{3}/.test(base) ? titleCase(base) : '';
}

async function loadIndex() {
  const rows = (await all("SELECT id, data FROM entities WHERE type='Candidate'")).map((r) => ({ ...jparse(r.data), id: r.id })).filter(Boolean);
  const idx = { byEmail: new Map(), byPhone: new Map(), byName: new Map(), rows };
  const add = (c) => {
    const e = normEmail(c.email), p = normPhone(c.phone), n = normName(c.full_name || c.name), co = normName(c.current_company);
    if (e) idx.byEmail.set(e, c); if (p) idx.byPhone.set(p, c); if (n && co) idx.byName.set(`${n}|${co}`, c);
  };
  rows.forEach(add); idx.add = add; return idx;
}
const findDup = (idx, { email, phone, name, company }) => {
  const e = normEmail(email), p = normPhone(phone), n = normName(name), co = normName(company);
  return (e && idx.byEmail.get(e)) || (p && idx.byPhone.get(p)) || (n && co && idx.byName.get(`${n}|${co}`)) || null;
};

async function loadReq(id) { if (!id) return null; const r = await one("SELECT id, data FROM entities WHERE type='JobRequisition' AND id=$1", [id]); return r ? { ...jparse(r.data), id: r.id } : null; }
const reqTitle = (r) => r?.designation || r?.position_title || r?.job_title || '';
const reqNo = (r) => r?.requisition_id || '';

async function saveCand(c) { await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3 AND type='Candidate'", [JSON.stringify(c), c.status || 'applied', c.id]); cacheInvalidate('Candidate'); }
async function logIntake(rec) {
  const id = uuidv4();
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'CandidateIntake',$2,$3,$4)", [id, rec.by || null, rec.status, JSON.stringify({ ...rec, id, at: nowIso() })]);
  return id;
}

/** Create a candidate, or add this CV / source to the person already in the app. */
async function placeCandidate(idx, f, ctx) {
  const { actorId = '', actorName = '', channel = 'upload' } = ctx;
  const source = normSource(f.source);
  const req = ctx.req || null;
  const dup = f.forceCandidateId ? idx.rows.find((c) => c.id === f.forceCandidateId) : findDup(idx, f);
  const cv = f.resume_url ? { url: f.resume_url, filename: f.filename || '', source, at: nowIso(), by: actorName || channel } : null;
  if (dup) {
    const next = { ...dup };
    if (cv) next.cv_history = [...(dup.cv_history || (dup.resume_url ? [{ url: dup.resume_url, filename: '', source: dup.source || 'careers_portal', at: dup.applied_date || '', by: 'earlier' }] : [])), cv];
    if (cv && !dup.resume_url) next.resume_url = cv.url;
    next.sources_seen = [...new Set([...(dup.sources_seen || [dup.source].filter(Boolean)), source])];
    if (req && (dup.requisition_id || dup.job_id) !== req.id) next.other_requisitions = [...(dup.other_requisitions || []), { requisition_id: req.id, mrf_no: reqNo(req), source, at: nowIso() }];
    else if (req && !dup.requisition_id && !dup.job_id) { next.requisition_id = req.id; next.job_id = req.id; next.position_applied = next.position_applied || reqTitle(req); next.department = next.department || req.department || ''; }
    for (const k of ['phone', 'email', 'current_company', 'current_designation', 'current_city']) if (!String(next[k] || '').trim() && f[k]) next[k] = f[k];
    next.timeline = LC.appendTimeline(dup, { type: 'note', text: `Came again through ${source.replace(/_/g, ' ')} (${channel})${cv ? ` — new CV ${cv.filename || ''}` : ''}${req && (dup.requisition_id || dup.job_id) !== req.id ? ` for ${reqNo(req) || reqTitle(req)}` : ''}`, by: actorId, by_name: actorName });
    await saveCand(next); idx.add(next); Object.assign(idx.rows.find((c) => c.id === dup.id) || {}, next);
    return { outcome: 'merged', candidate_id: dup.id, name: candName(dup), matched_on: normEmail(f.email) && normEmail(dup.email) === normEmail(f.email) ? 'email' : normPhone(f.phone) && normPhone(dup.phone) === normPhone(f.phone) ? 'phone' : 'name and company' };
  }
  const id = uuidv4();
  const c = {
    id, full_name: f.name, email: normEmail(f.email), phone: String(f.phone || '').trim(), source, status: 'applied', applied_date: nowIso(),
    current_company: f.current_company || '', current_designation: f.current_designation || '', current_city: f.current_city || '',
    experience_years: f.experience_years ?? '', current_ctc: f.current_ctc ?? '', expected_ctc: f.expected_ctc ?? '', notice_period: f.notice_period || '', skills: f.skills || undefined,
    resume_url: f.resume_url || '', profile_url: f.profile_url || '', intake_channel: channel, intake_by: actorName || '', notes: f.notes || '', sources_seen: [source],
    ...(req ? { requisition_id: req.id, job_id: req.id, position_applied: reqTitle(req), department: req.department || '' } : { needs_requisition: true, position_applied: f.position_applied || '' }),
    cv_history: cv ? [cv] : [],
    timeline: [{ at: nowIso(), type: 'status', to: 'applied', text: `Added from ${source.replace(/_/g, ' ')} (${channel})${req ? ` for ${reqNo(req) || reqTitle(req)}` : ' — no requisition yet'}`, by: actorId, by_name: actorName || channel }],
  };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Candidate',$2,'applied',$3)", [id, null, JSON.stringify(c)]);
  cacheInvalidate('Candidate'); idx.add(c); idx.rows.push(c);
  // read the CV by rules to fill experience / skills / education (the AI read is still one click on the candidate)
  if (c.resume_url) { try { const { performResumeParse } = await import('./functions.js'); await performResumeParse(id, c.resume_url, c, { useAI: false }); } catch (e) { console.warn('[intake] CV read failed:', e.message); } }
  return { outcome: 'created', candidate_id: id, name: c.full_name };
}

/** One CV file (already stored) -> read -> place. Returns what happened, never throws for a bad file. */
async function intakeFile(idx, { file_url, filename, source, req, actorId, actorName, channel, note, extra = {} }) {
  const out = { filename: filename || file_url, file_url };
  try {
    const { resumeText, extractionError } = await extractResumeText(file_url);
    const a = resumeText ? analyseResumeText(resumeText) : null;
    const email = normEmail(extra.email || a?.contacts?.email), phone = normPhone(extra.phone || a?.contacts?.phone);
    const name = extra.name || guessName(resumeText, filename);
    if (!resumeText || (!email && !phone)) {
      const reason = !resumeText ? (extractionError || 'The CV could not be read') : 'No email or phone number found on the CV';
      const iid = await logIntake({ status: 'needs_review', channel, source: normSource(source), file_url, filename, reason, guessed_name: name, requisition_id: req?.id || '', note: note || '', excerpt: String(resumeText || '').slice(0, 600), by: actorId });
      return { ...out, outcome: 'needs_review', reason, name, intake_id: iid };
    }
    const placed = await placeCandidate(idx, { name: name || email.split('@')[0], email, phone, source, resume_url: file_url, filename, experience_years: a?.experience_years ?? '', ...extra }, { actorId, actorName, channel, req });
    await logIntake({ status: placed.outcome, channel, source: normSource(source), file_url, filename, candidate_id: placed.candidate_id, requisition_id: req?.id || '', note: note || '', by: actorId });
    return { ...out, ...placed };
  } catch (e) { console.error('[intake] file failed:', e); return { ...out, outcome: 'failed', reason: e.message }; }
}

// ── spreadsheet columns ──
const COLS = {
  name: ['name', 'candidatename', 'fullname', 'applicantname', 'candidate'], email: ['email', 'emailid', 'emailaddress', 'mail'], phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'contact', 'contactno', 'phoneno', 'cellphone'],
  experience_years: ['experience', 'totalexperience', 'totalexp', 'exp', 'experienceyears', 'workexperience', 'yearsofexperience'], current_company: ['currentcompany', 'company', 'currentemployer', 'employer', 'organisation', 'organization'],
  current_designation: ['designation', 'currentdesignation', 'jobtitle', 'currentrole', 'title'], current_city: ['location', 'city', 'currentlocation', 'currentcity'], current_ctc: ['currentctc', 'ctc', 'currentsalary', 'currentlpa'],
  expected_ctc: ['expectedctc', 'expectedsalary', 'ectc', 'expectedlpa'], notice_period: ['noticeperiod', 'notice', 'noticedays'], skills: ['skills', 'keyskills', 'skillset'], resume_url: ['resumeurl', 'cvurl', 'resumelink', 'cvlink', 'resume', 'cv', 'profilelink'],
};
const detectCols = (headers) => { const map = {}; const norm = headers.map((h) => String(h).toLowerCase().replace(/[^a-z]/g, '')); for (const [k, syn] of Object.entries(COLS)) { const i = norm.findIndex((h) => syn.includes(h)); if (i >= 0) map[k] = headers[i]; } return map; };
const lakhs = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); if (!Number.isFinite(n) || n <= 0) return ''; return n < 1000 ? Math.round(n * 100000) : n; };   // "6" / "6.5" LPA -> rupees

// ── handlers ──
const H = {
  async ci_options({ cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const reqs = (await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((r) => ({ ...jparse(r.data), id: r.id })).filter((r) => (r.mrf_version === 2 ? ['published', 'on_hold'].includes(r.status) : ['approved', 'published', 'on_hold'].includes(r.status)));
    const inbox = (await all("SELECT COUNT(*)::int AS n FROM entities WHERE type='CandidateIntake' AND status='needs_review'"))[0].n;
    return res.json({ success: true, sources: SOURCES, requisitions: reqs.map((r) => ({ id: r.id, mrf_no: reqNo(r), title: reqTitle(r), department: r.department || '' })).sort((a, b) => (a.title || '').localeCompare(b.title || '')), inbox_count: inbox,
      email: { enabled: !!process.env.INBOUND_EMAIL_SECRET, endpoint: `${(process.env.APP_URL || 'https://maxone.maxvoltenergy.com').replace(/\/+$/, '')}/api/intake/email` } });
  },

  // up to 15 already-uploaded CVs per call (the screen sends batches)
  async ci_bulk_cv({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can add candidates', 403);
    const files = (p.files || []).filter((f) => f && f.file_url);
    if (!files.length) return fail(res, 'Choose at least one CV');
    if (files.length > 15) return fail(res, 'Send at most 15 CVs per request');
    const req = p.requisition_id ? await loadReq(p.requisition_id) : null;
    if (p.requisition_id && !req) return fail(res, 'Requisition not found');
    const idx = await loadIndex(); const results = [];
    for (const f of files) results.push(await intakeFile(idx, { file_url: f.file_url, filename: f.filename, source: p.source, req, actorId: cx.cu.id, actorName: cx.name, channel: 'bulk upload', note: p.note }));
    const n = (o) => results.filter((r) => r.outcome === o).length;
    return res.json({ success: true, created: n('created'), merged: n('merged'), needs_review: n('needs_review'), failed: n('failed'), results });
  },

  // Naukri / LinkedIn / Indeed / any Excel or CSV: preview first, then apply exactly that preview
  async ci_sheet({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can add candidates', 403);
    if (!p.file_url) return fail(res, 'Upload the Excel / CSV file first');
    let buf; try { const r = await fetch(p.file_url); if (!r.ok) throw new Error(`Server returned ${r.status}`); buf = Buffer.from(await r.arrayBuffer()); } catch (e) { return fail(res, `Could not read the file: ${e.message}`); }
    const XLSX = await import('xlsx'); let wb; try { wb = XLSX.read(buf, { type: 'buffer' }); } catch (e) { return fail(res, `This does not look like an Excel / CSV file: ${e.message}`); }
    const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return fail(res, 'The file has no rows');
    if (rows.length > 1000) return fail(res, 'Import at most 1,000 rows at a time');
    const headers = Object.keys(rows[0]); const map = { ...detectCols(headers), ...(p.mapping || {}) };
    if (!map.name || (!map.email && !map.phone)) return res.json({ success: false, error: `Could not find the Name and Email / Phone columns. Columns found: ${headers.join(', ')}`, headers, mapping: map });
    const req = p.requisition_id ? await loadReq(p.requisition_id) : null;
    const idx = await loadIndex(); const seen = new Set(); const plan = [];
    rows.forEach((r, i) => {
      const g = (k) => (map[k] ? r[map[k]] : '');
      const f = { name: String(g('name')).trim(), email: normEmail(g('email')), phone: String(g('phone')).trim(), current_company: String(g('current_company')).trim(), current_designation: String(g('current_designation')).trim(), current_city: String(g('current_city')).trim(),
        experience_years: (() => { const n = Number(String(g('experience_years')).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : ''; })(), current_ctc: lakhs(g('current_ctc')), expected_ctc: lakhs(g('expected_ctc')), notice_period: String(g('notice_period')).trim(),
        skills: String(g('skills')).split(/[,;|]/).map((s) => s.trim()).filter(Boolean), resume_url: /^https?:\/\//i.test(String(g('resume_url'))) ? String(g('resume_url')).trim() : '', source: p.source };
      const key = normEmail(f.email) || normPhone(f.phone);
      if (!f.name) return plan.push({ row: i + 2, action: 'invalid', reason: 'No name', f });
      if (!normEmail(f.email) && !normPhone(f.phone)) return plan.push({ row: i + 2, action: 'invalid', reason: 'No email or phone', f });
      if (seen.has(key)) return plan.push({ row: i + 2, action: 'invalid', reason: 'Same person appears twice in this file', f });
      seen.add(key);
      const dup = findDup(idx, f);
      plan.push({ row: i + 2, action: dup ? 'merge' : 'new', match: dup ? candName(dup) : '', f });
    });
    const hash = createHash('sha1').update(JSON.stringify([p.source, req?.id || '', plan.map((x) => [x.row, x.action, x.f.email, x.f.phone, x.f.name])])).digest('hex');
    const sum = { rows: plan.length, new: plan.filter((x) => x.action === 'new').length, merge: plan.filter((x) => x.action === 'merge').length, invalid: plan.filter((x) => x.action === 'invalid').length };
    if (p.mode !== 'apply') return res.json({ success: true, preview: true, preview_hash: hash, mapping: map, headers, summary: sum, rows: plan.slice(0, 300).map((x) => ({ row: x.row, action: x.action, reason: x.reason || '', match: x.match || '', name: x.f.name, email: x.f.email, phone: x.f.phone, company: x.f.current_company, experience: x.f.experience_years })) });
    if (!p.preview_hash || p.preview_hash !== hash) return fail(res, 'The file or the candidates changed since the preview. Run the preview again and confirm it.');
    let created = 0, merged = 0;
    for (const x of plan) {
      if (x.action === 'invalid') continue;
      const placed = await placeCandidate(idx, x.f, { actorId: cx.cu.id, actorName: cx.name, channel: 'spreadsheet', req });
      if (placed.outcome === 'created') created++; else merged++;
    }
    await logIntake({ status: 'imported', channel: 'spreadsheet', source: normSource(p.source), filename: p.filename || '', note: `${created} new, ${merged} already in the app, ${sum.invalid} skipped`, requisition_id: req?.id || '', by: cx.cu.id });
    return res.json({ success: true, created, merged, skipped: sum.invalid });
  },

  // a recruiter adds one person quickly: a few details, optionally a CV or a profile link
  async ci_quick_add({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Only HR / recruiters can add candidates', 403);
    const name = String(p.full_name || '').trim(); const email = normEmail(p.email); const phone = normPhone(p.phone);
    if (!name) return fail(res, 'Enter the candidate name');
    if (!email && !phone) return fail(res, 'Enter an email or a phone number');
    const req = p.requisition_id ? await loadReq(p.requisition_id) : null;
    const idx = await loadIndex();
    const extra = { current_company: p.current_company, current_designation: p.current_designation, current_city: p.current_city, experience_years: Number(p.experience_years) || '', expected_ctc: lakhs(p.expected_ctc), notice_period: p.notice_period, profile_url: p.profile_url, notes: p.notes };
    const placed = await placeCandidate(idx, { name, email, phone, source: p.source, resume_url: p.file_url || '', filename: p.filename || '', ...extra }, { actorId: cx.cu.id, actorName: cx.name, channel: 'quick add', req });
    await logIntake({ status: placed.outcome, channel: 'quick add', source: normSource(p.source), candidate_id: placed.candidate_id, requisition_id: req?.id || '', by: cx.cu.id });
    return res.json({ success: true, ...placed });
  },

  async ci_inbox_list({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const st = p.status || 'needs_review';
    const rows = (await all("SELECT id, data FROM entities WHERE type='CandidateIntake' ORDER BY created_at DESC LIMIT 400")).map((r) => ({ ...jparse(r.data), id: r.id })).filter((x) => st === 'all' || x.status === st);
    const noReq = (await all("SELECT id, data FROM entities WHERE type='Candidate'")).map((r) => ({ ...jparse(r.data), id: r.id })).filter((c) => c.needs_requisition && !c.requisition_id).map((c) => ({ id: c.id, name: candName(c), email: c.email, source: c.source, at: c.applied_date, position_applied: c.position_applied || '' }));
    return res.json({ success: true, items: rows.slice(0, 200), without_requisition: noReq });
  },

  // HR settles an inbox item: create the candidate (with the details typed in), add it to an existing person, or dismiss it
  async ci_inbox_resolve({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const r = await one("SELECT id, data FROM entities WHERE type='CandidateIntake' AND id=$1", [p.intake_id]); if (!r) return fail(res, 'Item not found', 404);
    const item = { ...jparse(r.data), id: r.id };
    const done = async (status, extra = {}) => { await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify({ ...item, status, resolved_at: nowIso(), resolved_by: cx.name, ...extra }), status, r.id]); };
    if (p.action === 'dismiss') { await done('dismissed', { dismiss_reason: String(p.reason || '').slice(0, 200) }); return res.json({ success: true }); }
    const req = (p.requisition_id || item.requisition_id) ? await loadReq(p.requisition_id || item.requisition_id) : null;
    const idx = await loadIndex();
    const f = { name: String(p.full_name || item.guessed_name || '').trim(), email: p.email, phone: p.phone, source: item.source, resume_url: item.file_url || '', filename: item.filename || '' };
    if (p.action === 'merge') { if (!p.candidate_id) return fail(res, 'Choose the candidate to add this CV to'); f.forceCandidateId = p.candidate_id; f.name = f.name || 'Candidate'; }
    else if (!f.name || (!normEmail(f.email) && !normPhone(f.phone))) return fail(res, 'Enter the name and an email or phone number');
    const placed = await placeCandidate(idx, f, { actorId: cx.cu.id, actorName: cx.name, channel: item.channel || 'inbox', req });
    await done(placed.outcome, { candidate_id: placed.candidate_id });
    return res.json({ success: true, ...placed });
  },

  async ci_assign_requisition({ p, cx, res }) {
    if (!hasAny(cx, RECRUIT)) return fail(res, 'Not allowed', 403);
    const req = await loadReq(p.requisition_id); if (!req) return fail(res, 'Choose a requisition');
    const r = await one("SELECT id, data FROM entities WHERE type='Candidate' AND id=$1", [p.candidate_id]); if (!r) return fail(res, 'Candidate not found', 404);
    const c = { ...jparse(r.data), id: r.id };
    if (c.requisition_id || c.job_id) return fail(res, 'This candidate already has a requisition');
    const next = { ...c, requisition_id: req.id, job_id: req.id, position_applied: c.position_applied || reqTitle(req), department: c.department || req.department || '', needs_requisition: false, timeline: LC.appendTimeline(c, { type: 'note', text: `Linked to ${reqNo(req) || reqTitle(req)}`, by: cx.cu.id, by_name: cx.name }) };
    await saveCand(next); return res.json({ success: true });
  },

  // where the email intake stands (HR / admin)
  async ci_email_info({ cx, res }) {
    if (!hasAny(cx, ['hr', 'admin'])) return fail(res, 'Not allowed', 403);
    const last = (await all("SELECT data FROM entities WHERE type='CandidateIntake' AND data LIKE '%\"channel\":\"email\"%' ORDER BY created_at DESC LIMIT 5")).map((r) => jparse(r.data));
    return res.json({ success: true, enabled: !!process.env.INBOUND_EMAIL_SECRET, endpoint: `${(process.env.APP_URL || 'https://maxone.maxvoltenergy.com').replace(/\/+$/, '')}/api/intake/email`, recent: last.map((x) => ({ at: x.at, from: x.from, subject: x.subject, status: x.status })) });
  },
};
export default H;

export async function handleIntake(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  const u = await one('SELECT role, custom_role, full_name, email FROM users WHERE id=$1', [cu.id]);
  if (!u) return fail(res, 'Unauthorized', 401);
  const emp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [cu.id]);
  const cx = { cu, roles: [u.role, u.custom_role].filter(Boolean), name: jparse(emp?.data)?.display_name || u.full_name || u.email || '' };
  const fn = H[name]; if (!fn) return fail(res, `Unknown function ${name}`, 404);
  try { return await fn({ p: p || {}, cx, res }); } catch (e) { console.error(`[intake/${name}]`, e); if (!res.headersSent) return fail(res, e.message || 'Something went wrong', 500); }
}

// ── CVs that arrive by email ─────────────────────────────────────────────────────────────────────────────────────
// Point the mail service's inbound webhook at POST /api/intake/email?key=<INBOUND_EMAIL_SECRET>. Works with Brevo inbound parsing and
// with any service that can post { from, to, subject, text, attachments: [{ filename, content_base64 }] }.
const sourceOfSender = (from, subject) => { const s = `${from} ${subject}`.toLowerCase(); return s.includes('naukri') ? 'naukri' : s.includes('linkedin') ? 'linkedin' : s.includes('indeed') ? 'indeed' : 'email'; };
const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
const CV_EXT = /\.(pdf|docx?|rtf|txt)$/i;

async function reqFromMail({ to, subject, text }) {
  const hay = `${(to || []).join(' ')} ${subject || ''} ${String(text || '').slice(0, 1500)}`;
  const m = hay.match(/MRF-\d{4}-\d{3,5}/i);
  if (m) { const r = (await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((x) => ({ ...jparse(x.data), id: x.id })).find((x) => String(x.requisition_id || '').toUpperCase() === m[0].toUpperCase()); if (r) return r; }
  const live = (await all("SELECT id, data FROM entities WHERE type='JobRequisition'")).map((x) => ({ ...jparse(x.data), id: x.id })).filter((r) => (r.mrf_version === 2 ? r.status === 'published' : ['published', 'approved'].includes(r.status)));
  const subj = normName(subject);
  const hits = live.filter((r) => { const t = normName(reqTitle(r)); return t.length >= 6 && subj.includes(t); });
  return hits.length === 1 ? hits[0] : null;
}

export async function processInboundEmail(msg) {
  const from = msg.from || ''; const subject = msg.subject || ''; const source = sourceOfSender(from, subject);
  const req = await reqFromMail({ to: msg.to, subject, text: msg.text });
  const idx = await loadIndex(); const results = [];
  const files = (msg.attachments || []).filter((a) => a.buffer && CV_EXT.test(a.filename || ''));
  for (const a of files) {
    const stored = await saveBuffer({ buffer: a.buffer, filename: a.filename, mime: a.contentType || 'application/octet-stream' });
    // the candidate's contacts come from the CV itself — the sender's address (often HR forwarding) is never used as the candidate's
    results.push(await intakeFile(idx, { file_url: stored.file_url, filename: a.filename, source, req, actorId: '', actorName: `Email from ${from}`, channel: 'email', note: subject}));
  }
  if (!files.length) {
    const iid = await logIntake({ status: 'needs_review', channel: 'email', source, from, subject, reason: 'The email has no CV attached', requisition_id: req?.id || '', excerpt: String(msg.text || '').slice(0, 800), guessed_name: '' });
    results.push({ outcome: 'needs_review', intake_id: iid });
  }
  await logIntake({ status: 'received', channel: 'email', source, from, subject, count: results.length, outcomes: results.map((r) => r.outcome) });
  return results;
}

export const inboundRouter = Router();
inboundRouter.use(express.json({ limit: '40mb' }));
inboundRouter.post('/email', async (req, res) => {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return res.status(503).json({ error: 'Email intake is not switched on' });
  if (!safeEq(req.query.key || req.headers['x-intake-key'], secret)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [body];                         // Brevo sends { items: [...] }
    let handled = 0;
    for (const it of items) {
      const from = it.from || it.From?.Address || it.sender || '';
      const to = [].concat(it.to || it.To || []).map((t) => (typeof t === 'string' ? t : t.Address || t.address || '')).filter(Boolean);
      const attachments = [];
      for (const a of it.attachments || it.Attachments || []) {
        const filename = a.filename || a.Name || a.name || '';
        let buffer = null;
        if (a.content_base64 || a.content) buffer = Buffer.from(a.content_base64 || a.content, 'base64');
        else if (a.DownloadToken && process.env.BREVO_API_KEY) {
          try { const r = await fetch(`https://api.brevo.com/v3/inbound/attachments/${encodeURIComponent(a.DownloadToken)}`, { headers: { 'api-key': process.env.BREVO_API_KEY } }); if (r.ok) buffer = Buffer.from(await r.arrayBuffer()); } catch (e) { console.warn('[intake] attachment download failed:', e.message); }
        } else if (a.url && /^https?:\/\//i.test(a.url)) { try { const r = await fetch(a.url); if (r.ok) buffer = Buffer.from(await r.arrayBuffer()); } catch { /* skipped */ } }
        if (buffer && buffer.length <= 15 * 1024 * 1024) attachments.push({ filename, buffer, contentType: a.contentType || a.ContentType });
      }
      await processInboundEmail({ from, to, subject: it.subject || it.Subject || '', text: it.text || it.RawTextBody || it.ExtractedMarkdownMessage || '', attachments });
      handled++;
    }
    return res.json({ ok: true, handled });
  } catch (e) { console.error('[intake/email]', e); return res.status(500).json({ error: 'Could not process the email' }); }
});
