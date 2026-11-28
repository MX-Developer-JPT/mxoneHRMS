// Letter support functions: authorised signatories (sg_*) and the letter send log (lt_*).
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { listSignatories } from '../utils/signatoryStore.js';
import { validSignature } from '../utils/signatory.js';
import { renderPdf } from '../utils/pdfRender.js';
import { validEmail } from '../utils/hrMail.js';

const parse = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const fail = (res, error, code = 400) => res.status(code).json({ success: false, error });
const clean = (v, n = 120) => String(v ?? '').trim().slice(0, n);

export async function audit(userId, entity_type, change_type, entity_id, detail = {}) {
  try {
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)",
      [uuidv4(), userId, JSON.stringify({ entity_type, entity_id, change_type, ...detail, timestamp: new Date().toISOString() })]);
  } catch { /* audit is best-effort */ }
}

export async function handleLetters(name, p, cu, res) {
  if (!cu) return res.status(401).json({ error: 'Unauthorized' });
  const u = await one('SELECT role, custom_role, full_name FROM users WHERE id=$1', [cu.id]) || {};
  const has = (...roles) => [u.role, u.custom_role].some((r) => roles.includes(r));

  if (name.startsWith('sg_')) {
    if (name === 'sg_list') {
      if (!has('hr', 'admin', 'management', 'recruiter')) return fail(res, 'Access denied', 403);
      return res.json({ success: true, signatories: await listSignatories(), can_edit: has('hr', 'admin') });
    }
    if (!has('hr', 'admin')) return fail(res, 'HR / Admin access required', 403);
    if (name === 'sg_save') {
      const nm = clean(p.name), designation = clean(p.designation);
      if (nm.length < 2 || !designation) return fail(res, 'Enter the signatory name and designation.');
      if (p.signature && !validSignature(p.signature)) return fail(res, 'The signature must be a PNG or JPG image under 400 KB.');
      // a damaged picture would break every letter that prints it, so it must render before it is accepted
      if (p.signature) {
        try { await renderPdf({ content: [{ image: p.signature, width: 50 }], defaultStyle: { font: 'Roboto' } }); }
        catch { return fail(res, 'This image file could not be read. Save it again as a PNG or JPG and retry.'); }
      }
      const existing = p.id ? await one("SELECT data FROM entities WHERE type='AuthorisedSignatory' AND id=$1", [p.id]) : null;
      if (p.id && !existing) return fail(res, 'Signatory not found', 404);
      const id = p.id || uuidv4();
      const before = existing ? parse(existing.data) : {};
      const others = await listSignatories();
      const is_default = !!p.is_default || !others.some((s) => s.id !== id);
      const data = { ...before, id, name: nm, designation, signature: p.signature === undefined ? before.signature || '' : p.signature, is_default, updated_by: cu.id, updated_by_name: u.full_name || '', updated_at: new Date().toISOString() };
      if (existing) await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify(data), id]);
      else await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuthorisedSignatory',NULL,'active',$2)", [id, JSON.stringify(data)]);
      if (is_default) for (const s of others) if (s.id !== id && s.is_default) await run('UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2', [JSON.stringify({ ...s, is_default: false }), s.id]);
      await audit(cu.id, 'AuthorisedSignatory', existing ? 'updated' : 'created', id, { name: nm, designation, actor_name: u.full_name || '' });
      return res.json({ success: true, signatories: await listSignatories() });
    }
    if (name === 'sg_delete') {
      const row = await one("SELECT data FROM entities WHERE type='AuthorisedSignatory' AND id=$1", [p.id]);
      if (!row) return fail(res, 'Signatory not found', 404);
      await run("DELETE FROM entities WHERE type='AuthorisedSignatory' AND id=$1", [p.id]);
      await audit(cu.id, 'AuthorisedSignatory', 'deleted', p.id, { name: parse(row.data).name, actor_name: u.full_name || '' });
      return res.json({ success: true, signatories: await listSignatories() });
    }
  }

  if (name === 'lt_recipient') {
    if (!has('hr', 'admin')) return fail(res, 'HR / Admin access required', 403);
    const row = await one('SELECT email, former_email FROM users WHERE id=$1', [p.user_id]);
    if (!row) return fail(res, 'Employee account not found', 404);
    // a leaver's login address is moved aside when the account is disabled; their real address is kept in former_email
    const email = row.former_email || row.email || '';
    return res.json({ success: true, registered_email: validEmail(email) ? email : '', former: !!row.former_email });
  }

  if (name === 'lt_log') {
    if (!has('hr', 'admin', 'management')) return fail(res, 'Access denied', 403);
    let rows = (await all("SELECT data FROM entities WHERE type='LetterDispatch' ORDER BY created_at DESC LIMIT 2000")).map((r) => parse(r.data));
    if (p.document_id) rows = rows.filter((r) => r.document_id === p.document_id);
    return res.json({ success: true, dispatches: rows });
  }

  return res.status(400).json({ error: `Unknown function ${name}` });
}
