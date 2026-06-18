import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const month = body.month || new Date().getMonth() + 1;
    const year = body.year || new Date().getFullYear();

    const userRole = user.custom_role || user.role;
    const isHR = userRole === 'hr' || userRole === 'admin' || user.role === 'hr' || user.role === 'admin';
    const isManagement = userRole === 'management' || user.role === 'management';

    // Get the current user's employee record for reporting hierarchy
    let reportees = [];
    if (isHR) {
      reportees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' }, 'display_name');
    } else if (isManagement) {
      const mgrEmp = (await base44.entities.Employee.filter({ user_id: user.id }))[0];
      if (mgrEmp) {
        reportees = await base44.asServiceRole.entities.Employee.filter({ reporting_manager_id: user.id, status: 'active' }, 'display_name');
        // Also include self
        if (!reportees.find(r => r.user_id === user.id)) {
          reportees.push(mgrEmp);
        }
      }
    } else {
      // Regular employee — show their own data + possibly their department
      const ownEmp = (await base44.entities.Employee.filter({ user_id: user.id }))[0];
      if (ownEmp) reportees = [ownEmp];
    }

    if (reportees.length === 0) {
      return Response.json({ success: true, data: { employees: [], holidays: [], attendance: {}, leaves: {} } });
    }

    const userIds = reportees.map(e => e.user_id);

    // Get holidays
    const holidays = await base44.asServiceRole.entities.Holiday.filter({}, 'date');

    // Build start/end dates
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Get attendance for all reportees
    const attendanceRecords = await base44.asServiceRole.entities.Attendance.filter({});
    const filteredAttendance = attendanceRecords.filter(a =>
      userIds.includes(a.user_id) && a.date >= startDate && a.date <= endDate
    );

    // Organize attendance by user and date
    const attendance = {};
    userIds.forEach(uid => { attendance[uid] = {}; });
    filteredAttendance.forEach(a => {
      attendance[a.user_id][a.date] = {
        status: a.status || 'absent',
        check_in_time: a.check_in_time,
        check_out_time: a.check_out_time,
        working_hours: a.working_hours,
      };
    });

    // Get approved leaves for the month
    const allLeaves = await base44.asServiceRole.entities.Leave.filter({ status: 'approved' });
    const filteredLeaves = allLeaves.filter(l => {
      if (!userIds.includes(l.user_id)) return false;
      return (l.start_date <= endDate && (l.end_date || l.start_date) >= startDate);
    });

    const leaves = {};
    userIds.forEach(uid => { leaves[uid] = []; });
    filteredLeaves.forEach(l => {
      leaves[l.user_id].push({
        start_date: l.start_date,
        end_date: l.end_date,
        leave_type: l.leave_type || l.leave_policy_name,
        is_half_day: l.is_half_day || false,
        status: l.status,
      });
    });

    const employees = reportees.map(e => ({
      user_id: e.user_id,
      display_name: e.display_name,
      employee_code: e.employee_code,
      department: e.department,
      designation: e.designation,
    }));

    return Response.json({
      success: true,
      data: {
        employees,
        holidays: holidays.map(h => ({ date: h.date, name: h.name })),
        attendance,
        leaves,
      }
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});