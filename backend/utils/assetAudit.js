// Audit trail for the Asset Tracking module: every asset creation / change / assignment / return and every letter event
// becomes an AssetActivityLog row (shown in the Activity History on the Asset Tracking page) and, for letters, an
// AuditLog row too. Writers never throw — an audit failure must not block the business action.
import { v4 as uuidv4 } from 'uuid';
import { one, run } from '../db.js';
import { resolveSchema, specChanges } from './assetSpecs.js';

const nowIso = () => new Date().toISOString();

export async function logAssetActivity(e) {
  try {
    const id = uuidv4();
    const rec = { id, previous_status: '', new_status: '', old_value: '', new_value: '', notes: '', ...e };
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AssetActivityLog',$2,'active',$3)", [id, e.assigned_to_user_id && e.assigned_to_user_id !== '__common__' ? e.assigned_to_user_id : null, JSON.stringify(rec)]);
  } catch (err) { console.error('[asset-audit] activity log failed:', err.message); }
}

export async function auditLog(entityType, entityId, by, changeType, extra = {}) {
  try {
    const id = uuidv4();
    await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [id, by || null,
      JSON.stringify({ id, entity_type: entityType, entity_id: entityId, changed_by: by || null, change_type: changeType, timestamp: nowIso(), ...extra })]);
  } catch (err) { console.error('[asset-audit] audit log failed:', err.message); }
}

async function nameOf(userId) {
  if (!userId || userId === '__common__') return userId === '__common__' ? 'Common Asset' : '';
  const e = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]).catch(() => null);
  if (e) { try { const d = JSON.parse(e.data); if (d.display_name) return d.display_name; } catch { /* fall through */ } }
  const u = await one('SELECT full_name FROM users WHERE id=$1', [userId]).catch(() => null);
  return u?.full_name || '';
}

// Called by the generic entity route after an Asset is created (before = null) or updated.
export async function auditAssetChange(cu, before, after, type) {
  try {
    const by = cu?.id || null;
    const byName = (await nameOf(by)) || cu?.email || '';
    const base = { asset_id: after.id, asset_name: after.asset_name, asset_identifier: after.asset_id, changed_by_user_id: by, changed_by_name: byName, assigned_to_user_id: after.assigned_to_user_id || '' };
    const toName = await nameOf(after.assigned_to_user_id);
    if (!before) {
      await logAssetActivity({ ...base, field_changed: 'created', new_status: after.status || 'available', assigned_to_name: toName, notes: `Asset registered by ${byName || 'HR'}${after.assigned_to_user_id ? ` and assigned to ${toName}` : ''}.` });
      return;
    }
    if ((before.assigned_to_user_id || '') !== (after.assigned_to_user_id || '')) {
      const fromName = await nameOf(before.assigned_to_user_id);
      await logAssetActivity({ ...base, field_changed: after.assigned_to_user_id ? 'assignment' : 'return', previous_status: before.status || '', new_status: after.status || '', assigned_to_name: toName,
        old_value: fromName, new_value: toName, notes: after.assigned_to_user_id ? `Assigned to ${toName}${before.assigned_to_user_id ? ` (was ${fromName})` : ''}.` : `Taken back from ${fromName || 'employee'}.` });
    } else if ((before.status || '') !== (after.status || '') && after.status !== 'signed') {
      await logAssetActivity({ ...base, field_changed: 'status', previous_status: before.status || '', new_status: after.status || '', assigned_to_name: toName, notes: `Status changed to ${after.status}.` });
    }
    if ((before.condition || '') !== (after.condition || '')) {
      await logAssetActivity({ ...base, field_changed: 'condition', assigned_to_name: toName, old_value: before.condition || '', new_value: after.condition || '', notes: 'Physical condition updated.' });
    }
    const ch = specChanges(before, after, type).filter(c => !['Physical Condition'].includes(c.label));
    if (ch.length) {
      await logAssetActivity({ ...base, field_changed: 'specs', assigned_to_name: toName, notes: `Specifications updated: ${ch.slice(0, 8).map(c => `${c.label}: ${c.from || '—'} → ${c.to || '—'}`).join('; ')}${ch.length > 8 ? ` (+${ch.length - 8} more)` : ''}`.slice(0, 900) });
    }
  } catch (err) { console.error('[asset-audit] asset change audit failed:', err.message); }
}

export { resolveSchema };
