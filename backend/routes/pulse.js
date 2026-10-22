// Pulse Surveys & eNPS — back end (every `ps_*` function; the old names createPulseSurvey / getPulseSurveys / … are
// aliases, see functions.js).
//
// Privacy model
//   • A survey is ANONYMOUS (default) or NAMED, chosen by HR when it is created and shown to every respondent first.
//   • Anonymous: the response row is keyed by a per-survey hash (no user id), only a department / designation snapshot
//     is kept; HR sees aggregates only, a breakdown (by department, designation, or a filter) is hidden when fewer than
//     MIN_GROUP people are behind it, exports shuffle the rows and mask small groups, and there is no employee-wise view.
//   • Named: HR / admin can open each employee's answers, filter by employee / department / designation, see who has not
//     responded, and export the individual responses. Opening an employee's answers and every export is logged.
//   • Raw responses are never available through the generic /api/entities endpoint (blocked in entities.js).
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { one, all, run } from '../db.js';
import { JWT_SECRET } from './auth.js';

export const MIN_GROUP = 5;
const MAX_Q = 60, MAX_OPTS = 10;
export const Q_TYPES = { rating: 'Rating (1–5)', nps: 'NPS (0–10)', text: 'Comment', single: 'Single choice', multi: 'Multiple choice', yesno: 'Yes / No' };
const ALIASES = {
  rating: ['rating', 'rating15', 'rating5', 'scale', 'scale15', 'star', 'stars'],
  nps: ['nps', '010', 'enps', 'nps010', 'recommend'],
  text: ['text', 'comment', 'comments', 'freetext', 'openended', 'opentext', 'textcomment'],
  single: ['single', 'singlechoice', 'singleselect', 'radio', 'choice', 'mcq'],
  multi: ['multi', 'multiple', 'multiplechoice', 'multiselect', 'checkbox', 'checkboxes'],
  yesno: ['yesno', 'yn', 'boolean', 'truefalse'],
};
export const normType = (t) => { const k = String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); return Object.keys(ALIASES).find(n => ALIASES[n].includes(k)) || null; };
const HR_ROLES = ['hr', 'admin'];
const nowIso = () => new Date().toISOString();
const clean = (v, n = 300) => String(v ?? '').trim().slice(0, n);
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg = (a) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 100) / 100 : null);

async function roleOf(cu) { if (!cu) return null; const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]); return u ? (u.custom_role || u.role) : null; }
const isHr = async (cu) => HR_ROLES.includes(await roleOf(cu));
const notAllowed = (res) => res.status(403).json({ success: false, error: 'HR or admin access required' });

// anonymous responses are keyed by a per-survey hash, so a row can be matched to nobody — but a person still cannot answer twice
const keyFor = (survey, userId) => (survey.anonymous === false ? userId : sha(`${survey.id}:${userId}:${JWT_SECRET}`).slice(0, 32));
const isAnon = (s) => s.anonymous !== false;   // surveys created before this setting existed were anonymous

// ── people ───────────────────────────────────────────────────────────────────────────────────
async function loadPeople() {
  const rows = await all("SELECT user_id, status, data FROM entities WHERE type='Employee'");
  const byUser = {}; const list = [];
  for (const r of rows) {
    const d = jparse(r.data); if (!d) continue;
    const uid = r.user_id || d.user_id; if (!uid) continue;
    const e = { user_id: uid, name: d.display_name || '', code: d.employee_code || '', department: d.department || '—', designation: d.designation || '—', location: d.work_location || '', manager_id: d.reporting_manager_id || null, active: r.status === 'active' };
    byUser[uid] = e; list.push(e);
  }
  for (const e of list) e.manager = byUser[e.manager_id]?.name || '';
  return { byUser, list };
}

// ── questions ────────────────────────────────────────────────────────────────────────────────
function normalizeQuestions(input) {
  const errs = []; const out = [];
  (Array.isArray(input) ? input : []).forEach((q, i) => {
    const n = i + 1; const text = clean(q?.text, 300); const type = normType(q?.type) || (q?.type === undefined ? 'rating' : null);
    if (!text) { errs.push(`Question ${n}: text is required`); return; }
    if (!type) { errs.push(`Question ${n}: unknown type "${q.type}"`); return; }
    const item = { id: clean(q.id, 20) || `q${n}`, text, type, required: type === 'text' ? q.required === true : q.required !== false };
    if (type === 'single' || type === 'multi') {
      const opts = [...new Set((Array.isArray(q.options) ? q.options : []).map(o => clean(o, 100)).filter(Boolean))];
      if (opts.length < 2) { errs.push(`Question ${n}: choice questions need at least 2 different options`); return; }
      if (opts.length > MAX_OPTS) { errs.push(`Question ${n}: at most ${MAX_OPTS} options`); return; }
      item.options = opts;
    }
    out.push(item);
  });
  const ids = new Set(); out.forEach((q, i) => { if (ids.has(q.id)) q.id = `q${i + 1}x`; ids.add(q.id); });
  if (out.length > MAX_Q) errs.push(`A survey can have at most ${MAX_Q} questions`);
  return { questions: out, errors: errs };
}

function cleanAnswers(survey, answers) {
  const out = {}; const errs = [];
  for (const q of survey.questions) {
    const v = answers?.[q.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (q.required !== false && q.type !== 'text') errs.push(`Please answer: ${q.text}`); continue; }
    if (q.type === 'rating') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) errs.push(`Invalid rating for: ${q.text}`); else out[q.id] = n; }
    else if (q.type === 'nps') { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10) errs.push(`Invalid score for: ${q.text}`); else out[q.id] = n; }
    else if (q.type === 'yesno') { if (v === 'yes' || v === 'no') out[q.id] = v; else errs.push(`Invalid answer for: ${q.text}`); }
    else if (q.type === 'single') { if ((q.options || []).includes(v)) out[q.id] = v; else errs.push(`Invalid choice for: ${q.text}`); }
    else if (q.type === 'multi') { const arr = [...new Set(Array.isArray(v) ? v : [v])]; if (arr.length && arr.every(x => (q.options || []).includes(x))) out[q.id] = arr; else errs.push(`Invalid choice for: ${q.text}`); }
    else out[q.id] = clean(v, 1500);
  }
  return { answers: out, errors: errs };
}
const display = (q, v) => (v === undefined || v === null ? '' : q.type === 'multi' ? (Array.isArray(v) ? v.join('; ') : String(v)) : q.type === 'yesno' ? (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : String(v)) : v);

// ── analytics over a set of responses ────────────────────────────────────────────────────────
function statsFor(survey, rows, shuffleComments) {
  const qs = survey.questions.map(q => {
    const vals = rows.map(r => r.answers[q.id]).filter(v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
    const base = { id: q.id, text: q.text, type: q.type, options: q.options, answered: vals.length };
    if (q.type === 'text') { let c = vals.map(String); if (shuffleComments) c = c.sort((a, b) => sha(a).localeCompare(sha(b))); return { ...base, comments: c.slice(0, 300) }; }
    if (q.type === 'rating' || q.type === 'nps') {
      const nums = vals.map(Number).filter(n => !isNaN(n)); const dist = {};
      nums.forEach(n => { dist[n] = (dist[n] || 0) + 1; });
      return { ...base, average: avg(nums), count: nums.length, distribution: dist };
    }
    const opts = q.type === 'yesno' ? ['yes', 'no'] : q.options || [];
    const counts = Object.fromEntries(opts.map(o => [o, 0]));
    for (const v of vals) for (const x of (Array.isArray(v) ? v : [v])) if (x in counts) counts[x]++;
    return { ...base, choices: opts.map(o => ({ value: o, label: q.type === 'yesno' ? (o === 'yes' ? 'Yes' : 'No') : o, count: counts[o], pct: pct(counts[o], vals.length) })) };
  });
  let enps = null;
  const npsQ = survey.questions.find(q => q.type === 'nps');
  if (npsQ) {
    const sc = rows.map(r => Number(r.answers[npsQ.id])).filter(n => !isNaN(n) && n >= 0);
    if (sc.length) { const pro = sc.filter(v => v >= 9).length, det = sc.filter(v => v <= 6).length; enps = { score: Math.round(((pro - det) / sc.length) * 100), promoters: pro, passives: sc.length - pro - det, detractors: det, total: sc.length, promoter_pct: pct(pro, sc.length), passive_pct: pct(sc.length - pro - det, sc.length), detractor_pct: pct(det, sc.length) }; }
  }
  return { questions: qs, enps };
}

function breakdown(survey, rows, field, anon) {
  const groups = {};
  for (const r of rows) (groups[r[field] || '—'] ||= []).push(r);
  const rate = survey.questions.filter(q => q.type === 'rating');
  const npsQ = survey.questions.find(q => q.type === 'nps');
  const mk = (name, rs) => {
    const ratings = rs.flatMap(r => rate.map(q => Number(r.answers[q.id])).filter(n => !isNaN(n)));
    let enps = null;
    if (npsQ) { const sc = rs.map(r => Number(r.answers[npsQ.id])).filter(n => !isNaN(n)); if (sc.length) enps = Math.round(((sc.filter(v => v >= 9).length - sc.filter(v => v <= 6).length) / sc.length) * 100); }
    return { name, count: rs.length, avg_rating: avg(ratings), enps };
  };
  let out = []; let small = [];
  for (const [name, rs] of Object.entries(groups)) { if (anon && rs.length < MIN_GROUP) small.push(...rs); else out.push(mk(name, rs)); }
  out.sort((a, b) => b.count - a.count);
  if (small.length) out.push(small.length >= MIN_GROUP || !out.length ? mk('Other (small groups)', small) : { name: 'Other (small groups)', count: small.length, avg_rating: null, enps: null, hidden: true });
  return out;
}

// ── dataset: the survey + responses resolved to people, with filters applied ─────────────────
async function loadDataset(surveyId, filters = {}) {
  const sRow = await one("SELECT data, status FROM entities WHERE type='PulseSurvey' AND id=$1", [surveyId]);
  if (!sRow) return { error: 'Survey not found' };
  const survey = { ...jparse(sRow.data), status: sRow.status };
  const anon = isAnon(survey);
  const { byUser, list } = await loadPeople();
  const respRows = await all("SELECT user_id, data FROM entities WHERE type='SurveyResponse' AND data::jsonb->>'survey_id'=$1", [surveyId]);
  let rows = respRows.map(r => {
    const d = jparse(r.data) || {};
    // who: named → the snapshot taken at submission; anonymous → only the department / designation snapshot
    let who;
    if (!anon) { const snap = d.respondent || {}; const live = byUser[snap.user_id || r.user_id] || {}; who = { user_id: snap.user_id || r.user_id, name: snap.name || live.name || '', code: snap.employee_code || live.code || '', department: snap.department || live.department || '—', designation: snap.designation || live.designation || '—', location: snap.location || live.location || '', manager: snap.manager || live.manager || '' }; }
    else { const snap = d.snapshot || byUser[r.user_id] || {}; who = { user_id: null, name: '', code: '', department: snap.department || '—', designation: snap.designation || '—', location: snap.location || '', manager: '' }; }
    return { id: d.id, ...who, submitted_at: d.submitted_at, answers: d.answers || {} };
  });
  const allRows = rows;
  // small-group masking for anonymous surveys (decided on the whole survey, not on the current filter)
  const deptN = {}, desgN = {};
  allRows.forEach(r => { deptN[r.department] = (deptN[r.department] || 0) + 1; desgN[r.designation] = (desgN[r.designation] || 0) + 1; });
  const mask = (r) => (anon ? { ...r, department: deptN[r.department] >= MIN_GROUP ? r.department : 'Other (small groups)', designation: desgN[r.designation] >= MIN_GROUP ? r.designation : 'Other (small groups)' } : r);
  const f = { department: clean(filters.department), designation: clean(filters.designation), location: clean(filters.location), user_id: clean(filters.user_id) };
  if (f.user_id && anon) return { error: 'Employee-wise results are not available for anonymous surveys' };
  const hit = (r) => (!f.department || r.department === f.department) && (!f.designation || r.designation === f.designation) && (!f.location || r.location === f.location) && (!f.user_id || r.user_id === f.user_id);
  const rawHits = allRows.filter(hit).length;          // how many people really sit behind this filter, before masking
  rows = rows.map(mask).filter(hit);
  const active = list.filter(e => e.active);
  const inScope = active.filter(e => (!f.department || e.department === f.department) && (!f.designation || e.designation === f.designation) && (!f.location || e.location === f.location) && (!f.user_id || e.user_id === f.user_id));
  const answered = new Set(allRows.map(r => r.user_id).filter(Boolean));
  const filtered = !!(f.department || f.designation || f.location || f.user_id);
  const suppressed = anon && (((filtered ? rows.length : allRows.length) < MIN_GROUP && rows.length > 0) || (filtered && rawHits > 0 && rawHits < MIN_GROUP));
  return { survey, anon, rows, allRows, active, inScope, answered, filtered, suppressed, filters: f, people: { byUser, list } };
}

async function logAccess(cu, action, survey, extra = {}) {
  try { const id = uuidv4(); await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'PulseAccessLog',$2,'logged',$3)", [id, cu.id, JSON.stringify({ id, action, survey_id: survey.id, survey_title: survey.title, anonymous: isAnon(survey), by: cu.id, at: nowIso(), ...extra })]); } catch (e) { console.warn('[pulse] access log failed:', e.message); }
}
async function notifyUsers(ids, { title, message, link = '/PulseSurveys' }) {
  const { sendPushToUser } = await import('../utils/push.js');
  for (const uid of ids) { try { await run('INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)', [uuidv4(), uid, title, message, 'info', link]); sendPushToUser(uid, { title, message, type: 'info', link }); } catch { /* best effort */ } }
}

// ── Excel template / import ──────────────────────────────────────────────────────────────────
const OPT_COLS = 8;
async function buildTemplate() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [{ header: 'No.', width: 6 }, { header: 'Question *', width: 60 }, { header: 'Type *', width: 18 }, { header: 'Required (Yes/No)', width: 18 }, ...Array.from({ length: OPT_COLS }, (_, i) => ({ header: `Option ${i + 1}`, width: 22 }))];
  ws.getRow(1).eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }, alignment: { vertical: 'middle', wrapText: true } }));
  const samples = [
    [1, 'I feel valued at Maxvolt.', 'Rating', 'Yes'],
    [2, 'How likely are you to recommend Maxvolt as a place to work?', 'NPS', 'Yes'],
    [3, 'Which of these helps you most in your work?', 'Single choice', 'Yes', 'My manager', 'My team', 'Training', 'Tools & systems'],
    [4, 'Which benefits matter most to you? (choose all that apply)', 'Multiple choice', 'No', 'Insurance', 'Flexible hours', 'Learning budget', 'Transport', 'Meals'],
    [5, 'Do you have the tools you need to do your job?', 'Yes/No', 'Yes'],
    [6, 'What is one thing we should improve?', 'Comment', 'No'],
  ];
  samples.forEach(r => ws.addRow(r));
  ws.getRow(2).eachCell(c => { c.font = { color: { argb: 'FF6B7280' }, italic: true }; });
  for (let r = 2; r <= 201; r++) {
    ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Rating,NPS,Single choice,Multiple choice,Yes/No,Comment"'] };
    ws.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
  }
  const ins = wb.addWorksheet('Instructions');
  ins.getColumn(1).width = 24; ins.getColumn(2).width = 100;
  const lines = [
    ['How to use this template', ''], ['', ''],
    ['1', 'Fill the "Questions" sheet — one question per row. The three grey example rows can be overwritten or deleted.'],
    ['2', 'Question and Type are required. Required (Yes/No) defaults to Yes for everything except Comment.'],
    ['3', 'Option 1…Option 8 are used only by Single choice and Multiple choice (at least 2 different options). Leave them empty for other types.'],
    ['4', `Up to ${MAX_Q} questions per survey. Do not rename the header row or the "Questions" sheet.`],
    ['5', 'Upload the file in Pulse Surveys → New survey → Import from Excel. Every problem is listed with its row number; fix the file and upload it again.'],
    ['', ''], ['Question types', ''],
    ...Object.entries({ Rating: 'Employees pick 1–5 (1 = poor, 5 = excellent). Gives an average.', NPS: 'Employees pick 0–10. Gives the eNPS (promoters 9–10, detractors 0–6).', 'Single choice': 'Pick one of your options.', 'Multiple choice': 'Pick any of your options.', 'Yes/No': 'A simple Yes or No.', Comment: 'Free-text answer.' }),
  ];
  lines.forEach(l => ins.addRow(l));
  ins.getRow(1).font = { bold: true, size: 14 }; ins.getRow(9).font = { bold: true, size: 12 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellText = (c) => {
  let v = c?.value;
  if (v == null) return '';
  if (typeof v === 'object') { if (v.richText) v = v.richText.map(t => t.text).join(''); else if ('result' in v) v = v.result; else if (v.text) v = v.text; else if (v instanceof Date) v = v.toISOString().slice(0, 10); }
  return String(v ?? '').trim();
};

async function parseImport(base64) {
  const ExcelJS = (await import('exceljs')).default;
  const buf = Buffer.from(String(base64 || '').replace(/^data:.*?;base64,/, ''), 'base64');
  if (!buf.length) return { errors: [{ row: 0, message: 'The file is empty' }] };
  if (buf.length > 5 * 1024 * 1024) return { errors: [{ row: 0, message: 'The file is larger than 5 MB' }] };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { return { errors: [{ row: 0, message: 'This is not a valid Excel (.xlsx) file. Please use the template.' }] }; }
  const ws = wb.getWorksheet('Questions') || wb.worksheets[0];
  if (!ws) return { errors: [{ row: 0, message: 'The workbook has no sheets' }] };
  const head = {}; ws.getRow(1).eachCell((c, i) => { head[cellText(c).toLowerCase().replace(/[^a-z0-9]/g, '')] = i; });
  const col = (...names) => { for (const n of names) if (head[n]) return head[n]; return null; };
  const cQ = col('question', 'questions', 'questiontext'), cT = col('type', 'questiontype'), cR = col('requiredyesno', 'required');
  const cOpts = Array.from({ length: OPT_COLS }, (_, i) => head[`option${i + 1}`]).filter(Boolean);
  if (!cQ || !cT) return { errors: [{ row: 1, message: 'The header row must contain "Question" and "Type" columns — please use the template.' }] };
  const errors = [], warnings = [], questions = []; const seen = new Set(); let rowsRead = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const text = cellText(row.getCell(cQ)), typeRaw = cellText(row.getCell(cT));
    const opts = cOpts.map(i => cellText(row.getCell(i))).filter(Boolean);
    const reqRaw = cR ? cellText(row.getCell(cR)).toLowerCase() : '';
    if (!text && !typeRaw && !opts.length) return;       // blank line
    rowsRead++;
    if (!text) { errors.push({ row: n, field: 'Question', message: 'Question text is missing' }); return; }
    if (text.length > 300) { errors.push({ row: n, field: 'Question', message: `Question is too long (${text.length} characters, maximum 300)` }); return; }
    if (!typeRaw) { errors.push({ row: n, field: 'Type', message: 'Type is missing — use Rating, NPS, Single choice, Multiple choice, Yes/No or Comment' }); return; }
    const type = normType(typeRaw);
    if (!type) { errors.push({ row: n, field: 'Type', message: `Unknown type "${typeRaw}" — use Rating, NPS, Single choice, Multiple choice, Yes/No or Comment` }); return; }
    if (reqRaw && !['yes', 'no', 'y', 'n', 'true', 'false'].includes(reqRaw)) { errors.push({ row: n, field: 'Required', message: `Required must be Yes or No (found "${reqRaw}")` }); return; }
    const key = text.toLowerCase(); if (seen.has(key)) warnings.push({ row: n, message: 'Duplicate of an earlier question (kept)' }); seen.add(key);
    const item = { text, type, required: reqRaw ? ['yes', 'y', 'true'].includes(reqRaw) : type !== 'text' };
    if (type === 'single' || type === 'multi') {
      const uniq = [...new Set(opts)];
      if (uniq.length < 2) { errors.push({ row: n, field: 'Options', message: `${Q_TYPES[type]} needs at least 2 different options (found ${uniq.length})` }); return; }
      if (uniq.length < opts.length) warnings.push({ row: n, message: 'Repeated options were merged' });
      if (uniq.some(o => o.length > 100)) { errors.push({ row: n, field: 'Options', message: 'An option is longer than 100 characters' }); return; }
      item.options = uniq;
    } else if (opts.length) warnings.push({ row: n, message: `Options are ignored for ${Q_TYPES[type]} questions` });
    questions.push(item);
  });
  if (!rowsRead) errors.push({ row: 0, message: 'No questions found — fill the Questions sheet (row 2 onwards)' });
  if (questions.length > MAX_Q) errors.push({ row: 0, message: `A survey can have at most ${MAX_Q} questions (found ${questions.length})` });
  return { questions, errors, warnings, rows_read: rowsRead };
}

// ── export ───────────────────────────────────────────────────────────────────────────────────
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const toCsv = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
const qLabel = (q, i) => `Q${i + 1}. ${q.text}`.slice(0, 120);
const fileSafe = (s) => String(s || 'survey').replace(/[^\w-]+/g, '_').slice(0, 50);
const ymd = (s) => String(s || '').slice(0, 10);

function responseTable(ds) {
  const { survey, anon } = ds;
  const qs = survey.questions;
  let rows = [...ds.rows];
  if (anon) rows.sort((a, b) => sha(a.id).localeCompare(sha(b.id)));   // order must not reveal who answered when
  else rows.sort((a, b) => (a.department || '').localeCompare(b.department || '') || (a.name || '').localeCompare(b.name || ''));
  const header = anon ? ['Response #', 'Department', 'Designation', 'Submitted on', ...qs.map(qLabel)] : ['Employee code', 'Employee name', 'Department', 'Designation', 'Location', 'Reporting manager', 'Submitted at', ...qs.map(qLabel)];
  const body = rows.map((r, i) => anon
    ? [i + 1, r.department, r.designation, ymd(r.submitted_at), ...qs.map(q => display(q, r.answers[q.id]))]
    : [r.code, r.name, r.department, r.designation, r.location, r.manager, r.submitted_at ? new Date(r.submitted_at).toISOString().replace('T', ' ').slice(0, 16) : '', ...qs.map(q => display(q, r.answers[q.id]))]);
  return { header, body, rows };
}

async function buildWorkbook(ds, st) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'Maxvolt One';
  const { survey, anon } = ds; const qs = survey.questions;
  const head = (ws, n) => { ws.getRow(n).eachCell(c => Object.assign(c, { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D28D9' } }, alignment: { wrapText: true, vertical: 'middle' } })); };
  const title = (ws, text, span) => { ws.addRow([text]); ws.mergeCells(1, 1, 1, Math.max(span, 2)); Object.assign(ws.getCell(1, 1), { font: { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } } }); };

  // Summary
  const s = wb.addWorksheet('Summary'); s.getColumn(1).width = 34; s.getColumn(2).width = 60;
  title(s, `Maxvolt Energy — ${survey.title}`, 2);
  const f = ds.filters; const fText = [f.department && `Department: ${f.department}`, f.designation && `Designation: ${f.designation}`, f.location && `Location: ${f.location}`, f.user_id && `Employee: ${ds.rows[0]?.name || f.user_id}`].filter(Boolean).join(' · ') || 'All employees';
  const info = [['Survey type', survey.type === 'enps' ? 'eNPS' : 'Pulse'], ['Privacy', anon ? 'Anonymous — individual answers are not linked to names' : 'Named — responses are linked to employees'], ['Status', survey.status], ['Created', ymd(survey.created_at)], ['Filter', fText], ['Responses', ds.rows.length], ['Employees in scope', ds.inScope.length], ['Response rate', `${pct(ds.rows.length, ds.inScope.length)}%`], ['Exported on', ymd(nowIso())]];
  if (st.enps) info.push(['eNPS', `${st.enps.score}  (promoters ${st.enps.promoters}, passives ${st.enps.passives}, detractors ${st.enps.detractors})`]);
  info.forEach(r => s.addRow(r)); s.getColumn(1).font = { bold: true };
  if (anon) s.addRow(['Note', `Groups of fewer than ${MIN_GROUP} people are merged into "Other (small groups)" to protect anonymity.`]);

  // Question analytics
  const a = wb.addWorksheet('Question analytics', { views: [{ state: 'frozen', ySplit: 2 }] });
  [8, 60, 16, 12, 12, 70].forEach((w, i) => { a.getColumn(i + 1).width = w; });
  title(a, 'Question-wise analytics', 6); a.addRow(['#', 'Question', 'Type', 'Answered', 'Average', 'Distribution / choices']); head(a, 2);
  st.questions.forEach((q, i) => {
    const dist = q.type === 'text' ? `${q.comments.length} comment(s)` : q.choices ? q.choices.map(c => `${c.label}: ${c.count} (${c.pct}%)`).join(' | ') : Object.keys(q.distribution).sort((x, y) => x - y).map(k => `${k}: ${q.distribution[k]}`).join(' | ');
    a.addRow([i + 1, q.text, Q_TYPES[q.type], q.answered, q.average ?? '', dist]);
  });
  // Breakdown
  const bd = wb.addWorksheet('By department & designation'); [30, 16, 12, 14, 12].forEach((w, i) => { bd.getColumn(i + 1).width = w; });
  title(bd, 'Responses by department and designation', 5); bd.addRow(['Group', 'Type', 'Responses', 'Avg rating (1–5)', 'eNPS']); head(bd, 2);
  for (const [lab, arr] of [['Department', breakdown(survey, ds.rows, 'department', anon)], ['Designation', breakdown(survey, ds.rows, 'designation', anon)]]) for (const g of arr) bd.addRow([g.name, lab, g.count, g.avg_rating ?? '', g.enps ?? '']);

  // Responses (wide)
  const rt = responseTable(ds);
  const r1 = wb.addWorksheet('Responses', { views: [{ state: 'frozen', ySplit: 2, xSplit: anon ? 1 : 2 }] });
  title(r1, anon ? 'Anonymous responses (shuffled)' : 'Employee-wise responses', rt.header.length); r1.addRow(rt.header); head(r1, 2);
  rt.header.forEach((h, i) => { r1.getColumn(i + 1).width = i < (anon ? 4 : 7) ? 18 : 28; });
  rt.body.forEach(r => r1.addRow(r));
  // Long format
  const l1 = wb.addWorksheet('Answers (one per row)', { views: [{ state: 'frozen', ySplit: 2 }] });
  const lh = anon ? ['Response #', 'Department', 'Designation', 'Question #', 'Question', 'Type', 'Answer'] : ['Employee code', 'Employee name', 'Department', 'Designation', 'Question #', 'Question', 'Type', 'Answer'];
  title(l1, 'Every answer on its own row (for pivot tables)', lh.length); l1.addRow(lh); head(l1, 2); [16, 24, 20, 20, 10, 50, 16, 40].forEach((w, i) => { l1.getColumn(i + 1).width = w; });
  rt.rows.forEach((r, ri) => qs.forEach((q, qi) => { const v = r.answers[q.id]; if (v === undefined || v === '') return; l1.addRow(anon ? [ri + 1, r.department, r.designation, qi + 1, q.text, Q_TYPES[q.type], display(q, v)] : [r.code, r.name, r.department, r.designation, qi + 1, q.text, Q_TYPES[q.type], display(q, v)]); }));
  // Not responded (named only)
  if (!anon) {
    const nr = wb.addWorksheet('Not responded'); [16, 28, 22, 24, 18, 24].forEach((w, i) => { nr.getColumn(i + 1).width = w; });
    title(nr, 'Employees who have not responded', 6); nr.addRow(['Employee code', 'Employee name', 'Department', 'Designation', 'Location', 'Reporting manager']); head(nr, 2);
    ds.inScope.filter(e => !ds.answered.has(e.user_id)).sort((x, y) => x.department.localeCompare(y.department) || x.name.localeCompare(y.name)).forEach(e => nr.addRow([e.code, e.name, e.department, e.designation, e.location, e.manager]));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── handlers ─────────────────────────────────────────────────────────────────────────────────
const HANDLERS = {
  async ps_create(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const title = clean(p.title, 150);
    if (!title) return res.json({ success: false, error: 'Title is required' });
    const type = p.type === 'enps' ? 'enps' : 'pulse';
    let input = Array.isArray(p.questions) ? p.questions : [];
    if (type === 'enps' && !input.some(q => normType(q.type) === 'nps')) input = [{ text: 'How likely are you to recommend Maxvolt as a place to work?', type: 'nps' }, ...input];
    const { questions, errors } = normalizeQuestions(input);
    if (errors.length) return res.json({ success: false, error: errors[0], errors });
    if (!questions.length) return res.json({ success: false, error: 'Add at least one question' });
    const closes = /^\d{4}-\d{2}-\d{2}$/.test(String(p.closes_at || '')) ? p.closes_at : null;
    const id = uuidv4();
    const survey = { id, title, description: clean(p.description, 500), type, questions, status: 'active', anonymous: p.anonymous !== false, created_by: cu.id, created_at: nowIso(), closes_at: closes };
    await run("INSERT INTO entities(id,type,status,data) VALUES($1,'PulseSurvey','active',$2)", [id, JSON.stringify(survey)]);
    const targets = await all("SELECT user_id FROM entities WHERE type='Employee' AND status='active'");
    await notifyUsers(targets.map(t => t.user_id).filter(Boolean), { title: '📋 New survey', message: `Please share your feedback: ${title}${survey.anonymous ? ' (anonymous)' : ''}` });
    return res.json({ success: true, survey });
  },

  // every signed-in person — employees, managers, HR — sees the surveys and can respond
  async ps_list(p, cu, res) {
    const hr = await isHr(cu);
    const surveys = (await all("SELECT data, status FROM entities WHERE type='PulseSurvey' ORDER BY created_at DESC")).map(r => ({ ...jparse(r.data), status: r.status })).filter(s => s.id);
    const mine = await all("SELECT user_id, data FROM entities WHERE type='SurveyResponse'");
    const done = new Set(); const counts = {};
    for (const r of mine) { const d = jparse(r.data); if (!d) continue; counts[d.survey_id] = (counts[d.survey_id] || 0) + 1; done.add(`${d.survey_id}|${r.user_id}`); }
    const out = surveys.map(s => ({ ...s, anonymous: isAnon(s), completed: done.has(`${s.id}|${keyFor(s, cu.id)}`) || done.has(`${s.id}|${cu.id}`), ...(hr ? { response_count: counts[s.id] || 0 } : {}), ...(!hr ? { created_by: undefined } : {}) }));
    return res.json({ success: true, surveys: out, is_hr: hr });
  },

  async ps_submit(p, cu, res) {
    const sRow = await one("SELECT data, status FROM entities WHERE type='PulseSurvey' AND id=$1", [p.survey_id]);
    if (!sRow) return res.json({ success: false, error: 'Survey not found' });
    const survey = { ...jparse(sRow.data), status: sRow.status };
    if (survey.status !== 'active') return res.json({ success: false, error: 'This survey is closed' });
    if (survey.closes_at && survey.closes_at < nowIso().slice(0, 10)) return res.json({ success: false, error: 'This survey has ended' });
    const key = keyFor(survey, cu.id);
    const dup = await one("SELECT id FROM entities WHERE type='SurveyResponse' AND data::jsonb->>'survey_id'=$1 AND (user_id=$2 OR user_id=$3)", [survey.id, key, cu.id]);
    if (dup) return res.json({ success: false, error: 'You have already responded to this survey' });
    const { answers, errors } = cleanAnswers(survey, p.answers);
    if (errors.length) return res.json({ success: false, error: errors[0], errors });
    if (!Object.keys(answers).length) return res.json({ success: false, error: 'Please answer at least one question' });
    const me = (await loadPeople()).byUser[cu.id] || {};
    const id = uuidv4();
    const doc = { id, survey_id: survey.id, answers, submitted_at: nowIso() };
    if (isAnon(survey)) doc.snapshot = { department: me.department || '—', designation: me.designation || '—', location: me.location || '' };
    else doc.respondent = { user_id: cu.id, name: me.name || '', employee_code: me.code || '', department: me.department || '—', designation: me.designation || '—', location: me.location || '', manager: me.manager || '' };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'SurveyResponse',$2,'submitted',$3)", [id, key, JSON.stringify(doc)]);
    return res.json({ success: true });
  },

  async ps_close(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const sRow = await one("SELECT data FROM entities WHERE type='PulseSurvey' AND id=$1", [p.survey_id]);
    if (!sRow) return res.json({ success: false, error: 'Survey not found' });
    const sd = { ...jparse(sRow.data), status: 'closed', closed_at: nowIso() };
    await run("UPDATE entities SET status='closed', data=$1 WHERE id=$2", [JSON.stringify(sd), p.survey_id]);
    if (sd.created_by) await notifyUsers([sd.created_by], { title: 'Survey closed', message: `"${sd.title}" is now closed. Results are ready to view.`, link: `/PulseSurveyResults?id=${sd.id}` });
    return res.json({ success: true });
  },

  // nudge people who have not responded yet (HR only learns how many were nudged, never who)
  async ps_remind(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const sRow = await one("SELECT data, status FROM entities WHERE type='PulseSurvey' AND id=$1", [p.survey_id]);
    if (!sRow) return res.json({ success: false, error: 'Survey not found' });
    const survey = { ...jparse(sRow.data), status: sRow.status };
    if (survey.status !== 'active') return res.json({ success: false, error: 'The survey is closed' });
    const { list } = await loadPeople();
    const done = new Set((await all("SELECT user_id FROM entities WHERE type='SurveyResponse' AND data::jsonb->>'survey_id'=$1", [survey.id])).map(r => r.user_id));
    const pending = list.filter(e => e.active && !done.has(keyFor(survey, e.user_id)) && !done.has(e.user_id));
    await notifyUsers(pending.map(e => e.user_id), { title: '📋 Survey reminder', message: `We would love your feedback: ${survey.title}` });
    await logAccess(cu, 'reminder', survey, { sent: pending.length });
    return res.json({ success: true, sent: pending.length });
  },

  ps_template: async (p, cu, res) => {
    if (!(await isHr(cu))) return notAllowed(res);
    return res.json({ success: true, base64: (await buildTemplate()).toString('base64'), filename: 'Pulse_Survey_Questions_Template.xlsx' });
  },

  // validates an uploaded template and returns the questions (nothing is saved until the survey is created)
  async ps_import(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const r = await parseImport(p.file_base64);
    const errors = r.errors || [];
    return res.json({ success: true, valid: errors.length === 0, questions: errors.length ? [] : r.questions, errors, warnings: r.warnings || [], rows_read: r.rows_read || 0 });
  },

  async ps_results(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const ds = await loadDataset(p.survey_id, p.filters || {});
    if (ds.error) return res.json({ success: false, error: ds.error });
    const { survey, anon, rows, active, inScope, answered, filtered, suppressed, people } = ds;
    // filter lists come from the whole population, so a narrow filter never hides the way back
    const uniq = (arr) => [...new Set(arr.filter(x => x && x !== '—'))].sort((a, b) => a.localeCompare(b));
    const options = { departments: uniq([...active.map(e => e.department), ...ds.allRows.map(r => r.department)]), designations: uniq([...active.map(e => e.designation), ...ds.allRows.map(r => r.designation)]), locations: uniq(active.map(e => e.location)) };
    if (!anon) options.employees = ds.allRows.map(r => ({ user_id: r.user_id, label: `${r.name}${r.code ? ` (${r.code})` : ''}` })).sort((a, b) => a.label.localeCompare(b.label));
    const head = { success: true, survey: { id: survey.id, title: survey.title, description: survey.description, type: survey.type, status: survey.status, anonymous: anon, created_at: survey.created_at, questions: survey.questions }, min_group: MIN_GROUP, filter_options: options, filtered, filters: ds.filters };
    const inScopeCount = inScope.length;
    if (suppressed || (anon && rows.length > 0 && rows.length < MIN_GROUP && !filtered && ds.allRows.length < MIN_GROUP)) {
      return res.json({ ...head, suppressed: true, message: `Fewer than ${MIN_GROUP} people${filtered ? ' match this filter' : ' have responded'} — results are hidden to protect anonymity.`, response_count: null, response_rate: null, questions: [], enps: null, breakdown: { department: [], designation: [] } });
    }
    const st = statsFor(survey, rows, anon);
    const out = { ...head, suppressed: false, response_count: rows.length, in_scope: inScopeCount, response_rate: pct(rows.length, inScopeCount), questions: st.questions, enps: st.enps, breakdown: { department: breakdown(survey, rows, 'department', anon), designation: breakdown(survey, rows, 'designation', anon) } };
    if (!anon) {
      out.responses = rows.map(r => ({ user_id: r.user_id, name: r.name, code: r.code, department: r.department, designation: r.designation, location: r.location, manager: r.manager, submitted_at: r.submitted_at, answers: Object.fromEntries(survey.questions.map(q => [q.id, display(q, r.answers[q.id])])) })).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
      out.not_responded = inScope.filter(e => !answered.has(e.user_id)).map(e => ({ user_id: e.user_id, name: e.name, code: e.code, department: e.department, designation: e.designation, location: e.location, manager: e.manager })).sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    }
    void people;
    return res.json(out);
  },

  // one employee's complete answers (named surveys only; logged)
  async ps_response(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const ds = await loadDataset(p.survey_id, { user_id: p.user_id });
    if (ds.error) return res.json({ success: false, error: ds.error });
    const r = ds.rows[0];
    if (!r) return res.json({ success: false, error: 'This employee has not responded' });
    await logAccess(cu, 'viewed_employee_response', ds.survey, { employee_user_id: r.user_id, employee_name: r.name });
    return res.json({ success: true, employee: { name: r.name, code: r.code, department: r.department, designation: r.designation, location: r.location, manager: r.manager }, submitted_at: r.submitted_at, answers: ds.survey.questions.map((q, i) => ({ n: i + 1, question: q.text, type: q.type, required: q.required !== false, answer: display(q, r.answers[q.id]) })) });
  },

  async ps_export(p, cu, res) {
    if (!(await isHr(cu))) return notAllowed(res);
    const ds = await loadDataset(p.survey_id, p.filters || {});
    if (ds.error) return res.json({ success: false, error: ds.error });
    if (ds.suppressed) return res.json({ success: false, error: `Fewer than ${MIN_GROUP} people match this filter — an anonymous survey cannot be exported for such a small group.` });
    if (!ds.rows.length) return res.json({ success: false, error: 'There are no responses to export for this selection' });
    const format = p.format === 'csv' ? 'csv' : 'xlsx';
    const name = `Pulse_${fileSafe(ds.survey.title)}_${ymd(nowIso())}`;
    await logAccess(cu, `exported_${format}`, ds.survey, { filters: ds.filters, rows: ds.rows.length });
    if (format === 'csv') {
      const rt = responseTable(ds);
      return res.json({ success: true, format, filename: `${name}.csv`, mime: 'text/csv;charset=utf-8', base64: Buffer.from(toCsv(rt.header, rt.body), 'utf8').toString('base64'), rows: rt.body.length });
    }
    const st = statsFor(ds.survey, ds.rows, isAnon(ds.survey));
    const buf = await buildWorkbook(ds, st);
    return res.json({ success: true, format, filename: `${name}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: buf.toString('base64'), rows: ds.rows.length });
  },
};

// the original function names keep working
export const PULSE_ALIASES = { createPulseSurvey: 'ps_create', getPulseSurveys: 'ps_list', submitSurveyResponse: 'ps_submit', closePulseSurvey: 'ps_close', getSurveyResults: 'ps_results' };

export async function handlePulse(name, p, cu, res) {
  if (!cu) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const fn = HANDLERS[PULSE_ALIASES[name] || name];
  if (!fn) return res.status(404).json({ success: false, error: `Unknown survey function: ${name}` });
  try { return await fn(p || {}, cu, res); }
  catch (e) { console.error('[pulse]', name, e); return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' }); }
}
