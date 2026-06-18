import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data, old_data } = payload;

    if (!data || !event) {
      return Response.json({ error: 'Missing data or event' }, { status: 400 });
    }

    const asset = data;
    const old = old_data || {};

    // Determine what changed
    const logs = [];

    if (event.type === 'create') {
      logs.push({
        asset_id: asset.id,
        asset_name: asset.asset_name,
        asset_identifier: asset.asset_id,
        previous_status: '',
        new_status: asset.status || 'available',
        assigned_to_user_id: asset.assigned_to_user_id || '',
        field_changed: 'created',
        old_value: '',
        new_value: `Asset created: ${asset.asset_name} (${asset.asset_id})`,
        notes: `Initial status: ${asset.status || 'available'}`,
      });
    }

    if (event.type === 'update') {
      // Status change
      if (asset.status !== old.status) {
        let assignedTo = asset.assigned_to_user_id || '';
        let assignedName = '';
        if (assignedTo && assignedTo !== '__common__') {
          try {
            const emps = await base44.asServiceRole.entities.Employee.filter({ user_id: assignedTo });
            if (emps.length > 0) assignedName = emps[0].display_name || '';
          } catch (_) {}
        }
        logs.push({
          asset_id: asset.id,
          asset_name: asset.asset_name,
          asset_identifier: asset.asset_id,
          previous_status: old.status || '',
          new_status: asset.status,
          assigned_to_user_id: assignedTo,
          assigned_to_name: assignedName,
          field_changed: 'status',
          old_value: old.status || '',
          new_value: asset.status,
          notes: `Status changed from "${old.status || 'none'}" to "${asset.status}"`,
        });
      }

      // Assignment change
      if (asset.assigned_to_user_id !== old.assigned_to_user_id) {
        let assignedName = '';
        const assignedTo = asset.assigned_to_user_id || '';
        if (assignedTo && assignedTo !== '__common__') {
          try {
            const emps = await base44.asServiceRole.entities.Employee.filter({ user_id: assignedTo });
            if (emps.length > 0) assignedName = emps[0].display_name || '';
          } catch (_) {}
        }
        let oldAssignedName = '';
        if (old.assigned_to_user_id && old.assigned_to_user_id !== '__common__') {
          try {
            const oldEmps = await base44.asServiceRole.entities.Employee.filter({ user_id: old.assigned_to_user_id });
            if (oldEmps.length > 0) oldAssignedName = oldEmps[0].display_name || '';
          } catch (_) {}
        }
        logs.push({
          asset_id: asset.id,
          asset_name: asset.asset_name,
          asset_identifier: asset.asset_id,
          previous_status: asset.status,
          new_status: asset.status,
          assigned_to_user_id: assignedTo,
          assigned_to_name: assignedName,
          field_changed: 'assignment',
          old_value: old.assigned_to_user_id ? (oldAssignedName || old.assigned_to_user_id) : 'Unassigned',
          new_value: assignedTo ? (assignedName || assignedTo) : 'Unassigned',
          notes: assignedTo ? `Assigned to ${assignedName || assignedTo}` : 'Asset unassigned',
        });
      }

      // Condition change
      if (asset.condition !== old.condition && old.condition) {
        logs.push({
          asset_id: asset.id,
          asset_name: asset.asset_name,
          asset_identifier: asset.asset_id,
          previous_status: asset.status,
          new_status: asset.status,
          assigned_to_user_id: asset.assigned_to_user_id || '',
          field_changed: 'condition',
          old_value: old.condition || '',
          new_value: asset.condition,
          notes: `Condition changed from "${old.condition}" to "${asset.condition}"`,
        });
      }

      // Return detection
      if (asset.returned_date && asset.returned_date !== old.returned_date) {
        logs.push({
          asset_id: asset.id,
          asset_name: asset.asset_name,
          asset_identifier: asset.asset_id,
          previous_status: old.status || '',
          new_status: asset.status,
          assigned_to_user_id: '',
          field_changed: 'return',
          old_value: '',
          new_value: asset.returned_date,
          notes: `Asset returned on ${asset.returned_date}, condition: ${asset.returned_condition || 'N/A'}`,
        });
      }
    }

    // Bulk create all log entries
    if (logs.length > 0) {
      await base44.asServiceRole.entities.AssetActivityLog.bulkCreate(logs);
    }

    return Response.json({ success: true, logs_created: logs.length });
  } catch (error) {
    console.error('onAssetChanged error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});