import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.role !== 'hr')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { record_id, field, status, notes } = await req.json();
    if (!record_id || !field || !status) {
      return Response.json({ error: 'record_id, field, status required' }, { status: 400 });
    }

    const existing = await base44.asServiceRole.entities.ComplianceRecord.filter({ id: record_id });
    if (!existing || existing.length === 0) {
      return Response.json({ error: 'Record not found' }, { status: 404 });
    }

    const oldRecord = existing[0];
    const update = { [field]: status };
    if (notes) update.notes = notes;
    if (field.includes('pf') || field.includes('esi') || field.includes('tds')) {
      update.filed_by = user.email;
    }

    await base44.asServiceRole.entities.ComplianceRecord.update(record_id, update);

    await base44.asServiceRole.entities.ComplianceAuditLog.create({
      action: 'UPDATE_COMPLIANCE_STATUS',
      module: 'ComplianceRecord',
      entity_id: record_id,
      actor_id: user.id,
      actor_name: user.full_name,
      old_value: oldRecord[field],
      new_value: status,
      remarks: notes || ''
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});