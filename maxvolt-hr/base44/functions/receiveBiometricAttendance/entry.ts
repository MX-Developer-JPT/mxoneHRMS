import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Validate API key
  const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  const expectedKey = Deno.env.get('BIOMETRIC_AGENT_API_KEY');
  if (!apiKey || apiKey !== expectedKey) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const updateSyncLog = async (status, recordsSynced, errorMessage) => {
    const logs = await base44.asServiceRole.entities.BiometricSyncLog.list();
    const logData = {
      last_sync_time: new Date().toISOString(),
      records_synced: recordsSynced,
      status,
      error_message: errorMessage || null,
      triggered_by: 'mx-one-agent'
    };
    if (logs.length > 0) {
      await base44.asServiceRole.entities.BiometricSyncLog.update(logs[0].id, logData);
    } else {
      await base44.asServiceRole.entities.BiometricSyncLog.create(logData);
    }
  };

  try {
    const body = await req.json();

    // Expected payload: { records: [{ employee_code, timestamp, direction }] }
    // direction: "IN" or "OUT"
    const records = body.records || (body.employee_code ? [body] : []);

    if (!records || records.length === 0) {
      return Response.json({ error: 'No records provided' }, { status: 400 });
    }

    // Group by employee_code + date
    const grouped = {};
    for (const rec of records) {
      const empCode = String(rec.employee_code || rec.UserId || rec.user_id || '');
      const ts = new Date(rec.timestamp || rec.LogDate);
      const dateStr = ts.toISOString().slice(0, 10);
      const direction = (rec.direction || rec.Direction || 'IN').toUpperCase();
      const key = `${empCode}_${dateStr}`;
      if (!grouped[key]) grouped[key] = { empCode, dateStr, ins: [], outs: [] };
      if (direction === 'OUT') {
        grouped[key].outs.push(ts);
      } else {
        grouped[key].ins.push(ts);
      }
    }

    let syncedCount = 0;
    const errors = [];

    for (const key of Object.keys(grouped)) {
      const { empCode, dateStr, ins, outs } = grouped[key];

      // Find employee by employee_code
      const empResults = await base44.asServiceRole.entities.Employee.filter({ employee_code: empCode });
      if (!empResults || empResults.length === 0) {
        errors.push(`Employee not found: ${empCode}`);
        continue;
      }
      const userId = empResults[0].user_id;

      ins.sort((a, b) => a - b);
      outs.sort((a, b) => a - b);

      const checkIn = ins.length > 0 ? ins[0].toISOString() : null;
      const checkOut = outs.length > 0 ? outs[outs.length - 1].toISOString() : null;

      // Calculate working hours if both in and out
      let workingHours = null;
      if (checkIn && checkOut) {
        workingHours = (new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60);
      }

      const existing = await base44.asServiceRole.entities.Attendance.filter({ user_id: userId, date: dateStr });

      if (existing.length > 0) {
        const updateData = {};
        if (checkIn && !existing[0].check_in_time) updateData.check_in_time = checkIn;
        if (checkOut) updateData.check_out_time = checkOut;
        if (workingHours !== null) updateData.working_hours = parseFloat(workingHours.toFixed(2));
        if (Object.keys(updateData).length > 0) {
          await base44.asServiceRole.entities.Attendance.update(existing[0].id, updateData);
          syncedCount++;
        }
      } else {
        const newRecord = {
          user_id: userId,
          date: dateStr,
          status: 'present',
          auto_marked: true
        };
        if (checkIn) newRecord.check_in_time = checkIn;
        if (checkOut) newRecord.check_out_time = checkOut;
        if (workingHours !== null) newRecord.working_hours = parseFloat(workingHours.toFixed(2));
        await base44.asServiceRole.entities.Attendance.create(newRecord);
        syncedCount++;
      }
    }

    await updateSyncLog('success', syncedCount, errors.length > 0 ? errors.join('; ') : null);

    return Response.json({
      success: true,
      message: `Processed ${syncedCount} attendance records.`,
      records_synced: syncedCount,
      warnings: errors
    });

  } catch (error) {
    console.error('receiveBiometricAttendance error:', error.message);
    await updateSyncLog('failed', 0, error.message).catch(() => {});
    return Response.json({ error: error.message }, { status: 500 });
  }
});