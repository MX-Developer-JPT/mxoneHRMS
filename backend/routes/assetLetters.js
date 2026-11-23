// Asset handover letters — every `al_*` function (dispatched from functions.js).
//
//   al_schemas   the specification schema of every asset category / type (drives the Add-Asset form)
//   al_generate  create (or revise) a letter for one employee and the assets issued to them
//   al_list      letters (HR/admin/management: everyone's, filterable; anyone else: their own)
//   al_get       one letter with its stored content
//   al_pdf       print-ready A4 PDF, with or without the digital letterhead
//   al_event     record a print / preview of a letter in its history
//
// A letter is a SNAPSHOT: the structured content (employee, asset specifications, wording) is stored on the letter at the
// moment it is generated and both the screen preview and the PDF are rendered from that snapshot. Editing the asset later
// never changes a letter already issued — it only marks the letter "out of date" so HR can generate a revised one.
// AssetLetter is a PRIVATE entity type: the generic entity API cannot read or write it.
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { allSchemas, resolveSchema, specFingerprint } from '../utils/assetSpecs.js';
import { buildModel, buildPdf as renderLetterPdf } from '../utils/assetLetterDoc.js';
import { logAssetActivity, auditLog } from '../utils/assetAudit.js';

const MANAGE = ['hr', 'admin', 'front_desk_admin'];
const VIEW_ALL = ['hr', 'admin', 'management', 'front_desk_admin'];
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const jparse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const istToday = () => istNow().toISOString().slice(0, 10);

// ── storage ──
// A user's role may sit in `role` or in `custom_role` (an employee given the front-desk role keeps role='user'), so a permission
// is granted when EITHER matches — the same rule hasRole() uses everywhere else in functions.js.
async function rolesOf(cu) { if (!cu) return []; const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]); return u ? [u.role, u.custom_role].filter(Boolean) : []; }
const hasAny = (cx, list) => cx.roles.some(r => list.includes(r));
async function nameOfUser(id) {
  const e = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [id]).catch(() => null);
  const d = e ? jparse(e.data) : null;
  if (d?.display_name) return d.display_name;
  const u = await one('SELECT full_name, email FROM users WHERE id=$1', [id]).catch(() => null);
  return u?.full_name || u?.email || '';
}
async function loadLetter(id) { const r = await one("SELECT data FROM entities WHERE type='AssetLetter' AND id=$1", [id]); return r ? jparse(r.data) : null; }
async function saveLetter(l) {
  const json = JSON.stringify(l);
  const u = await run("UPDATE entities SET data=$1, status=$2, updated_at=NOW()::TEXT WHERE type='AssetLetter' AND id=$3", [json, l.status, l.id]);
  if (!u.rowCount) await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AssetLetter',$2,$3,$4)", [l.id, l.user_id, l.status, json]);
}
const allLetters = async () => (await all("SELECT data FROM entities WHERE type='AssetLetter'")).map(r => jparse(r.data)).filter(Boolean);

function fyOf(ymd) { const y = Number(String(ymd).slice(0, 4)); const m = Number(String(ymd).slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; }
async function nextRef(issueYmd) {
  const prefix = `MVE/HR/AL/${fyOf(issueYmd)}/`;
  const rows = await allLetters();
  let max = 0;
  for (const l of rows) { if (String(l.ref_no || '').startsWith(prefix)) { const n = parseInt(String(l.ref_no).slice(prefix.length), 10); if (n > max) max = n; } }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// ── letter list / detail ──
async function loadAssetsByIds(ids) {
  if (!ids.length) return {};
  const rows = await all("SELECT data FROM entities WHERE type='Asset' AND id = ANY($1::text[])", [ids]);
  const out = {}; for (const r of rows) { const d = jparse(r.data); if (d) out[d.id] = d; }
  return out;
}
async function loadTypes() {
  const out = {}; for (const r of await all("SELECT data FROM entities WHERE type='AssetType'")) { const d = jparse(r.data); if (d) out[d.id] = d; }
  return out;
}
function summarise(l, assetMap, types) {
  let outdated = false; let acknowledged_at = null; let allSigned = l.asset_ids.length > 0;
  const changed = [];
  for (const b of l.model?.assets || []) {
    const a = assetMap[b.entity_id];
    if (!a) { outdated = true; changed.push(`${b.name}: asset record removed`); allSigned = false; continue; }
    if (a.assigned_to_user_id !== l.user_id) { outdated = true; changed.push(`${b.name}: no longer assigned to this employee`); }
    else if (specFingerprint(a, types[a.asset_type_id]) !== b.fingerprint) { outdated = true; changed.push(`${b.name}: details changed after this letter`); }
    if (a.signed_at && String(a.signed_at) >= String(l.generated_at || '')) { if (!acknowledged_at || a.signed_at > acknowledged_at) acknowledged_at = a.signed_at; } else allSigned = false;
  }
  return {
    id: l.id, ref_no: l.ref_no, version: l.version || 1, status: l.status, user_id: l.user_id, employee_name: l.employee_name, employee_code: l.employee_code,
    designation: l.designation, department: l.department, asset_ids: l.asset_ids, asset_codes: l.asset_codes, asset_names: l.asset_names, issue_date: l.issue_date, letter_date: l.letter_date,
    generated_at: l.generated_at, generated_by: l.generated_by, generated_by_name: l.generated_by_name, revises: l.revises || null, superseded_by: l.superseded_by || null,
    outdated: l.status !== 'superseded' && outdated, outdated_reasons: l.status !== 'superseded' ? changed : [], acknowledged_at: l.signature?.at || (allSigned ? acknowledged_at : null),
    signed_by_name: l.signature?.signed_by_name || '', signed: !!l.signature,
    print_count: l.print_count || 0, download_count: l.download_count || 0, history: l.history || [],
  };
}

// ── handlers ──
const HANDLERS = {
  async al_schemas({ res }) {
    const types = await loadTypes();
    const byType = {};
    for (const t of Object.values(types)) byType[t.id] = resolveSchema(t);
    return res.json({ success: true, categories: allSchemas(), types: byType });
  },

  async al_generate({ p, cx, res }) {
    if (!hasAny(cx, MANAGE)) return fail(res, 'Only HR, admin or front desk admin can generate asset letters', 403);
    const userId = String(p.user_id || '');
    const ids = [...new Set((Array.isArray(p.asset_ids) ? p.asset_ids : []).map(String))];
    if (!userId || !ids.length) return fail(res, 'Choose the employee and at least one asset.');
    if (ids.length > 25) return fail(res, 'A letter can list at most 25 assets.');
    const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
    const emp = empRow ? jparse(empRow.data) : null;
    if (!emp) return fail(res, 'Employee record not found.', 404);
    const amap = await loadAssetsByIds(ids);
    const types = await loadTypes();
    const assets = [];
    for (const id of ids) {
      const a = amap[id];
      if (!a) return fail(res, 'One of the assets no longer exists.', 404);
      if (a.assigned_to_user_id !== userId) return fail(res, `${a.asset_name || 'An asset'} (${a.asset_id || ''}) is not assigned to ${emp.display_name || 'this employee'}.`);
      assets.push(a);
    }
    const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(p.issue_date || '') ? p.issue_date
      : (assets.map(a => String(a.assignment_date || '').slice(0, 10)).filter(Boolean).sort().pop() || istToday());
    const prints = await allLetters();
    const fingerprint = assets.map(a => `${a.id}:${specFingerprint(a, types[a.asset_type_id])}`).sort().join('|');
    let revises = null;
    if (p.revises_letter_id) { revises = prints.find(l => l.id === p.revises_letter_id); if (!revises) return fail(res, 'The letter to revise was not found.', 404); if (revises.status === 'superseded') return fail(res, 'That letter was already revised — revise the latest one.'); }
    else {
      // The same employee, same assets, nothing changed: reuse the letter that is already on record instead of numbering a duplicate.
      const same = prints.find(l => l.user_id === userId && l.status !== 'superseded' && l.fingerprint === fingerprint);
      if (same) return res.json({ success: true, reused: true, letter: await present(same, types) });
    }
    const by = cx.cu.id; const byName = await nameOfUser(by);
    const baseRef = revises ? String(revises.ref_no).replace(/-R\d+$/, '') : await nextRef(issueDate);
    const version = revises ? (revises.version || 1) + 1 : 1;
    const ref = revises ? `${baseRef}-R${version - 1}` : baseRef;
    const model = buildModel({ emp, userName: await nameOfUser(userId), assets, types, letterDate: istToday(), issueDate, ref, issuedBy: byName });
    const letter = {
      id: uuidv4(), ref_no: ref, version, status: 'issued', user_id: userId, employee_name: model.employee.name, employee_code: model.employee.code,
      designation: model.employee.designation, department: model.employee.department, asset_ids: ids, asset_codes: assets.map(a => a.asset_id || ''), asset_names: assets.map(a => a.asset_name || ''),
      issue_date: issueDate, letter_date: model.letter_date, generated_at: new Date().toISOString(), generated_by: by, generated_by_name: byName, fingerprint,
      revises: revises?.id || null, print_count: 0, download_count: 0, history: [{ at: new Date().toISOString(), by, by_name: byName, action: revises ? 'revised' : 'generated' }], model,
    };
    await saveLetter(letter);
    if (revises) { revises.status = 'superseded'; revises.superseded_by = letter.id; (revises.history ||= []).push({ at: new Date().toISOString(), by, by_name: byName, action: 'superseded', note: `Replaced by ${ref}` }); await saveLetter(revises); }
    await auditLog('AssetLetter', letter.id, by, revises ? 'revise' : 'generate', { ref_no: ref, employee_user_id: userId, asset_ids: ids, revises: revises?.ref_no || null });
    for (const a of assets) {
      await logAssetActivity({ asset_id: a.id, asset_name: a.asset_name, asset_identifier: a.asset_id, assigned_to_user_id: userId, assigned_to_name: model.employee.name, changed_by_user_id: by, changed_by_name: byName,
        field_changed: 'letter', new_value: ref, notes: `${revises ? 'Revised handover letter' : 'Handover letter'} ${ref} generated for ${model.employee.name}.` });
    }
    return res.json({ success: true, letter: await present(letter, types) });
  },

  async al_list({ p, cx, res }) {
    const viewAll = hasAny(cx, VIEW_ALL);
    let rows = await allLetters();
    if (!viewAll) rows = rows.filter(l => l.user_id === cx.cu.id);
    else if (p.user_id) rows = rows.filter(l => l.user_id === p.user_id);
    if (p.status) rows = rows.filter(l => l.status === p.status);
    rows.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)));
    rows = rows.slice(0, Math.min(Number(p.limit) || 500, 1000));
    const ids = [...new Set(rows.flatMap(l => l.asset_ids || []))];
    const amap = await loadAssetsByIds(ids); const types = await loadTypes();
    return res.json({ success: true, letters: rows.map(l => summarise(l, amap, types)), can_manage: hasAny(cx, MANAGE) });
  },

  async al_get({ p, cx, res }) {
    const l = await loadLetter(p.id);
    if (!l) return fail(res, 'Letter not found', 404);
    if (!hasAny(cx, VIEW_ALL) && l.user_id !== cx.cu.id) return fail(res, 'You do not have access to this letter', 403);
    return res.json({ success: true, letter: await present(l, await loadTypes()) });
  },

  async al_pdf({ p, cx, res }) {
    const l = await loadLetter(p.id);
    if (!l) return fail(res, 'Letter not found', 404);
    if (!hasAny(cx, VIEW_ALL) && l.user_id !== cx.cu.id) return fail(res, 'You do not have access to this letter', 403);
    const withLetterhead = p.letterhead !== false;
    const fx = await import('./functions.js');
    const buf = await renderLetterPdf(l.model, withLetterhead, { renderPdf: fx.renderPdf, letterheadBg: fx.getLetterheadBgDataUrl(), stamp: fx.getStampDataUrl(), margins: fx.LETTERHEAD_MARGINS, signature: l.signature || null });
    if (p.log !== false) await recordEvent(l, cx, 'download', withLetterhead ? 'with_letterhead' : 'without_letterhead');
    const safe = String(l.employee_name || 'Employee').replace(/[^A-Za-z0-9]+/g, '_');
    return res.json({ success: true, base64: buf.toString('base64'), filename: `Asset_Handover_${safe}_${String(l.ref_no).replace(/[^A-Za-z0-9-]+/g, '_')}${withLetterhead ? '' : '_no_letterhead'}.pdf` });
  },

  // The employee named in the letter signs it (drawn signature). It marks the letter acknowledged and every asset in it as signed.
  async al_sign({ p, cx, res }) {
    const l = await loadLetter(p.id);
    if (!l) return fail(res, 'Letter not found', 404);
    if (l.user_id !== cx.cu.id) return fail(res, 'Only the employee named in this letter can sign it.', 403);
    if (l.status === 'superseded') return fail(res, 'This letter was replaced by a revised one — please sign the latest letter.');
    if (l.signature) return fail(res, 'You have already signed this letter.');
    if (p.agreed !== true) return fail(res, 'Please confirm that you agree to the terms of the letter.');
    const img = String(p.signature || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img) || img.length < 800) return fail(res, 'Please draw your signature.');
    if (img.length > 400000) return fail(res, 'The signature image is too large — please sign again.');
    const name = l.employee_name || await nameOfUser(cx.cu.id);
    const at = new Date().toISOString();
    l.signature = { data_url: img, signed_by: cx.cu.id, signed_by_name: name, at, ip: String(p.ip || '').slice(0, 60) };
    l.acknowledged_at = at;
    (l.history ||= []).push({ at, by: cx.cu.id, by_name: name, action: 'signed' });
    await saveLetter(l);
    let signedAssets = 0;
    for (const id of l.asset_ids || []) {
      const r = await one("SELECT id, data FROM entities WHERE type='Asset' AND id=$1", [id]);
      const a = r ? jparse(r.data) : null;
      if (!a || a.assigned_to_user_id !== cx.cu.id) continue;       // returned or moved since: nothing to sign for that one
      const upd = { ...a, status: 'signed', signed_at: at, signed_by_name: name, notes: `${a.notes ? a.notes + '\n' : ''}✓ Digitally signed by ${name} on ${at.slice(0, 10)} (letter ${l.ref_no})` };
      await run("UPDATE entities SET status='signed', data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), r.id]);
      await logAssetActivity({ asset_id: a.id, asset_name: a.asset_name, asset_identifier: a.asset_id, previous_status: a.status || 'assigned', new_status: 'signed', assigned_to_user_id: cx.cu.id, assigned_to_name: name, changed_by_user_id: cx.cu.id, changed_by_name: name, field_changed: 'checkout', new_value: 'Digitally signed & acknowledged', notes: `Handover letter ${l.ref_no} signed by the employee.` });
      signedAssets++;
    }
    await auditLog('AssetLetter', l.id, cx.cu.id, 'sign', { ref_no: l.ref_no, assets_signed: signedAssets });
    try { if (l.generated_by) await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,'success','/AssetTracking')", [uuidv4(), l.generated_by, 'Asset letter signed', `${name} signed handover letter ${l.ref_no}.`]); } catch { /* notification is best-effort */ }
    return res.json({ success: true, signed_assets: signedAssets, letter: await present(l, await loadTypes()) });
  },

  async al_event({ p, cx, res }) {
    const l = await loadLetter(p.id);
    if (!l) return fail(res, 'Letter not found', 404);
    if (!hasAny(cx, VIEW_ALL) && l.user_id !== cx.cu.id) return fail(res, 'You do not have access to this letter', 403);
    const action = ['print', 'preview'].includes(p.action) ? p.action : null;
    if (!action) return fail(res, 'Unknown event');
    await recordEvent(l, cx, action, p.variant === 'without_letterhead' ? 'without_letterhead' : 'with_letterhead');
    return res.json({ success: true });
  },
};

async function recordEvent(l, cx, action, variant) {
  const by = cx.cu.id; const byName = await nameOfUser(by);
  l.history = [...(l.history || []), { at: new Date().toISOString(), by, by_name: byName, action, variant }].slice(-100);
  if (action === 'print') l.print_count = (l.print_count || 0) + 1;
  if (action === 'download') l.download_count = (l.download_count || 0) + 1;
  await saveLetter(l);
  if (action !== 'preview') await auditLog('AssetLetter', l.id, by, action, { ref_no: l.ref_no, variant });
}

async function present(l, types) {
  const amap = await loadAssetsByIds(l.asset_ids || []);
  return { ...summarise(l, amap, types), model: l.model, signature: l.signature ? { data_url: l.signature.data_url, signed_by_name: l.signature.signed_by_name, at: l.signature.at } : null };
}

export async function handleAssetLetters(name, p, cu, res) {
  if (!cu) return fail(res, 'Unauthorized', 401);
  const roles = await rolesOf(cu);
  if (!roles.length) return fail(res, 'Unauthorized', 401);
  const H = HANDLERS[name];
  if (!H) return fail(res, `Unknown function ${name}`, 404);
  try { return await H({ p: p || {}, cx: { cu, roles }, res }); }
  catch (e) { console.error(`[assetLetters/${name}]`, e); if (!res.headersSent) return fail(res, e.message || 'Something went wrong', 500); }
}
