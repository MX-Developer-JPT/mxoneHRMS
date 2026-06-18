import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { regularisation_id, action, comment, role } = await req.json();
    if (!regularisation_id || !action) return Response.json({ error: 'Missing required fields' }, { status: 400 });

    const reg = await base44.asServiceRole.entities.AttendanceRegularisation.filter({ id: regularisation_id });
    if (!reg.length) return Response.json({ error: 'Regularisation not found' }, { status: 404 });

    const record = reg[0];
    const now = new Date().toISOString();
    const auditLog = record.audit_log || [];

    let updateData = {};

    if (role === 'manager') {
      // Manager actions
      if (!['approved', 'rejected', 'sent_back'].includes(action)) {
        return Response.json({ error: 'Invalid manager action' }, { status: 400 });
      }
      const newStatus = action === 'approved' ? 'manager_approved' : action === 'rejected' ? 'rejected' : 'sent_back';
      auditLog.push({ actor_id: user.id, actor_name: user.full_name, action: `manager_${action}`, comment: comment || '', timestamp: now });
      updateData = { status: newStatus, manager_action: action, manager_comment: comment || '', manager_actioned_at: now, audit_log: auditLog };

    } else if (role === 'hr') {
      // HR final approval
      if (!['approved', 'rejected'].includes(action)) {
        return Response.json({ error: 'Invalid HR action' }, { status: 400 });
      }
      auditLog.push({ actor_id: user.id, actor_name: user.full_name, action: `hr_${action}`, comment: comment || '', timestamp: now });

      if (action === 'approved') {
        // Find and update attendance record
        const attDate = record.attendance_date.split('T')[0];
        const attRecords = await base44.asServiceRole.entities.Attendance.filter({ user_id: record.user_id, date: attDate });
        
        if (attRecords.length > 0) {
          const att = attRecords[0];
          const dateStr = attDate; // YYYY-MM-DD

          let newCheckIn = att.check_in_time;
          let newCheckOut = att.check_out_time;

          if (record.requested_check_in) {
            newCheckIn = `${dateStr}T${record.requested_check_in}:00.000Z`;
          }
          if (record.requested_check_out) {
            newCheckOut = `${dateStr}T${record.requested_check_out}:00.000Z`;
          }

          // Recalculate working hours
          let workingHours = att.working_hours || 0;
          if (newCheckIn && newCheckOut) {
            const diffMs = new Date(newCheckOut) - new Date(newCheckIn);
            workingHours = Math.max(0, diffMs / (1000 * 60 * 60));
          }

          const beforeSnapshot = { check_in_time: att.check_in_time, check_out_time: att.check_out_time, working_hours: att.working_hours, status: att.status };
          const newStatus = workingHours >= 8 ? 'present' : workingHours >= 4 ? 'half_day' : att.status;

          await base44.asServiceRole.entities.Attendance.update(att.id, {
            check_in_time: newCheckIn,
            check_out_time: newCheckOut,
            working_hours: Math.round(workingHours * 100) / 100,
            status: newStatus,
            regularization_requested: false,
            regularization_status: 'approved',
            regularization_approved_by: user.id,
            notes: (att.notes || '') + ` [Regularised on ${attDate}]`
          });

          // Log before/after in audit
          auditLog[auditLog.length - 1].before = beforeSnapshot;
          auditLog[auditLog.length - 1].after = { check_in_time: newCheckIn, check_out_time: newCheckOut, working_hours: workingHours, status: newStatus };
        } else {
          // Create new attendance record
          const dateStr = attDate;
          let newCheckIn = record.requested_check_in ? `${dateStr}T${record.requested_check_in}:00.000Z` : null;
          let newCheckOut = record.requested_check_out ? `${dateStr}T${record.requested_check_out}:00.000Z` : null;
          let workingHours = 0;
          if (newCheckIn && newCheckOut) {
            workingHours = Math.max(0, (new Date(newCheckOut) - new Date(newCheckIn)) / (1000 * 60 * 60));
          }
          const newStatus = workingHours >= 8 ? 'present' : workingHours >= 4 ? 'half_day' : 'present';
          await base44.asServiceRole.entities.Attendance.create({
            user_id: record.user_id, date: dateStr, check_in_time: newCheckIn, check_out_time: newCheckOut,
            working_hours: Math.round(workingHours * 100) / 100, status: newStatus, regularization_status: 'approved',
            regularization_approved_by: user.id, notes: `[Created via regularisation on ${now}]`
          });
        }

        // Flag payroll for this month for recalculation
        const attDateObj = new Date(record.attendance_date);
        const payrollMonth = attDateObj.getMonth() + 1;
        const payrollYear = attDateObj.getFullYear();
        const payrollRecords = await base44.asServiceRole.entities.Payroll.filter({
          user_id: record.user_id,
          month: payrollMonth,
          year: payrollYear
        });
        for (const pr of payrollRecords) {
          if (pr.status === 'draft' || pr.status === 'processed') {
            await base44.asServiceRole.entities.Payroll.update(pr.id, {
              notes: (pr.notes || '') + ` [Attendance regularised on ${now} — recalculation required]`,
              status: 'draft'
            });
          }
        }

        updateData = { status: 'completed', hr_action: 'approved', hr_comment: comment || '', hr_actioned_by: user.id, hr_actioned_at: now, audit_log: auditLog, attendance_updated: true };
      } else {
        updateData = { status: 'rejected', hr_action: 'rejected', hr_comment: comment || '', hr_actioned_by: user.id, hr_actioned_at: now, audit_log: auditLog };
      }
    } else {
      return Response.json({ error: 'Invalid role' }, { status: 400 });
    }

    await base44.asServiceRole.entities.AttendanceRegularisation.update(regularisation_id, updateData);

    return Response.json({ success: true, status: updateData.status });

  } catch (error) {
    console.error('processRegularisation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});