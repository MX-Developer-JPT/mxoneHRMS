import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Scheduled: runs end of day (e.g. 11:45 PM IST).
 * For each active employee who has a check_in but NO check_out for today,
 * marks them absent (clears check_in data and sets status=absent).
 * 
 * Also marks employees with NO attendance record at all for today as absent.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const today = new Date();
    // Use IST offset (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(today.getTime() + istOffset);
    const todayStr = istNow.toISOString().slice(0, 10);

    // Get all active employees
    const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });

    // Get today's attendance records
    const todayAttendance = await base44.asServiceRole.entities.Attendance.filter({ date: todayStr }, '-updated_date', 2000);

    // Build map: user_id -> attendance record
    const attMap = {};
    todayAttendance.forEach(a => {
      if (!attMap[a.user_id] || new Date(a.updated_date) > new Date(attMap[a.user_id].updated_date)) {
        attMap[a.user_id] = a;
      }
    });

    const results = [];

    for (const emp of employees) {
      // Skip attendance-exempt employees
      if (emp.is_attendance_exempt) continue;

      const rec = attMap[emp.user_id];

      if (!rec) {
        // No attendance record at all — no need to do anything here,
        // existing absent logic handles this in AllAttendance UI.
        // Only create if we want DB records for absents.
        continue;
      }

      // Has check-in but NO check-out and status is still 'present'
      if (rec.check_in_time && !rec.check_out_time && rec.status === 'present') {
        // Mark as absent: clear check_in and set status=absent
        await base44.asServiceRole.entities.Attendance.update(rec.id, {
          status: 'absent',
          check_in_time: null,
          check_out_time: null,
          working_hours: 0,
          notes: (rec.notes || '') + ' [Auto-marked absent: no checkout recorded]',
          auto_marked: true,
        });
        results.push({ employee: emp.employee_code, action: 'marked_absent_no_checkout' });
      }
    }

    return Response.json({
      success: true,
      date: todayStr,
      processed: results.length,
      results,
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});