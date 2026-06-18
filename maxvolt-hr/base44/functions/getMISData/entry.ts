import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Fetch all core data in parallel
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    const [employees, attendance, leaves, payrolls, candidates, exits, tickets, reimbursements, performances, leaveBalances, assets, complianceDeadlines, complianceRecords] = await Promise.all([
      base44.asServiceRole.entities.Employee.list(),
      base44.asServiceRole.entities.Attendance.filter({ date: { $gte: thirtyDaysAgoStr } }, '-date', 5000),
      base44.asServiceRole.entities.Leave.list(),
      base44.asServiceRole.entities.Payroll.list(),
      base44.asServiceRole.entities.Candidate.list(),
      base44.asServiceRole.entities.Exit.list(),
      base44.asServiceRole.entities.Ticket.list(),
      base44.asServiceRole.entities.Reimbursement.list(),
      base44.asServiceRole.entities.Performance.list(),
      base44.asServiceRole.entities.LeaveBalance.list(),
      base44.asServiceRole.entities.Asset.list(),
      base44.asServiceRole.entities.ComplianceDeadline.list(),
      base44.asServiceRole.entities.ComplianceRecord.list(),
    ]);

    // --- KEY METRICS ---
    const activeEmployees = employees.filter(e => e.status === 'active');
    const totalActive = activeEmployees.length;

    const todayAttendance = attendance.filter(a => a.date && String(a.date).slice(0, 10) === todayStr);
    const presentToday = todayAttendance.filter(a => ['present', 'half_day', 'on_duty'].includes(a.status)).length;
    const absentToday = totalActive - presentToday;

    const activeLeaves = leaves.filter(l => l.status === 'approved' && l.start_date <= todayStr && l.end_date >= todayStr).length;

    // Current month payroll cost
    const currentPayrolls = payrolls.filter(p => p.month === currentMonth && p.year === currentYear);
    const totalPayrollCost = currentPayrolls.reduce((sum, p) => sum + (p.net_salary || 0), 0);

    // Attrition rate (last 12 months)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const recentExits = exits.filter(e => e.exit_date && new Date(e.exit_date) >= twelveMonthsAgo);
    const attritionRate = totalActive > 0 ? ((recentExits.length / (totalActive + recentExits.length)) * 100).toFixed(1) : 0;

    // --- BIOMETRIC STATS (current month) ---
    const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    const monthAttendance = attendance.filter(a => a.date && String(a.date).slice(0, 10) >= monthStart && String(a.date).slice(0, 10) <= monthEnd);
    const biometricRecords = monthAttendance.filter(a => a.biometric_synced);
    const avgWorkingHours = biometricRecords.length > 0
      ? (biometricRecords.reduce((s, a) => s + (a.working_hours || 0), 0) / biometricRecords.length)
      : 0;
    const avgBreakHours = biometricRecords.length > 0
      ? (biometricRecords.reduce((s, a) => s + (a.break_hours || 0), 0) / biometricRecords.length)
      : 0;
    const avgDailyPunches = biometricRecords.length > 0
      ? (biometricRecords.reduce((s, a) => s + (a.total_punches || 0), 0) / biometricRecords.length)
      : 0;

    // --- ATTENDANCE TRENDS (last 7 days) ---
    const attendanceTrends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayAttendance = attendance.filter(a => a.date && String(a.date).slice(0, 10) === dateStr);
      const present = dayAttendance.filter(a => ['present', 'half_day', 'on_duty'].includes(a.status)).length;
      const absent = dayAttendance.filter(a => a.status === 'absent').length;
      const late = dayAttendance.filter(a => a.late_arrival === true).length;
      attendanceTrends.push({
        date: dateStr,
        label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
        present,
        absent,
        late,
      });
    }

    // --- HEADCOUNT GROWTH (last 6 months) ---
    const headcountGrowth = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
      const count = employees.filter(e => e.date_of_joining && e.date_of_joining <= monthEnd && (e.status === 'active' || (e.exit_date && e.exit_date > monthEnd))).length;
      headcountGrowth.push({
        month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        headcount: count,
      });
    }

    // --- ATTRITION TREND (last 6 months) ---
    const attritionTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
      const monthExits = exits.filter(e => e.exit_date && e.exit_date >= monthStart && e.exit_date <= monthEnd).length;
      attritionTrend.push({
        month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
        exits: monthExits,
      });
    }

    // --- DEPARTMENT BREAKDOWN ---
    const deptMap = {};
    activeEmployees.forEach(e => {
      const dept = e.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { name: dept, count: 0, present: 0 };
      deptMap[dept].count++;
      const hasTodayAttendance = todayAttendance.find(a => a.user_id === e.user_id && ['present', 'half_day', 'on_duty'].includes(a.status));
      if (hasTodayAttendance) deptMap[dept].present++;
    });
    const departmentBreakdown = Object.values(deptMap).sort((a, b) => b.count - a.count);

    // --- LEAVE ANALYTICS ---
    const approvedLeaves = leaves.filter(l => l.status === 'approved');
    const pendingLeaves = leaves.filter(l => l.status === 'pending');
    const leaveTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];
      const count = approvedLeaves.filter(l => l.start_date >= monthStart && l.start_date <= monthEnd).length;
      leaveTrend.push({ month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), count });
    }

    // --- PAYROLL ANALYTICS (last 6 months) ---
    const payrollTrend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const monthPayrolls = payrolls.filter(p => p.month === m && p.year === y);
      const total = monthPayrolls.reduce((s, p) => s + (p.net_salary || 0), 0);
      payrollTrend.push({ month: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), total });
    }

    // Dept salary distribution
    const deptSalary = {};
    currentPayrolls.forEach(p => {
      const emp = employees.find(e => e.user_id === p.user_id);
      const dept = emp?.department || 'Unknown';
      deptSalary[dept] = (deptSalary[dept] || 0) + (p.net_salary || 0);
    });
    const salarByDept = Object.entries(deptSalary).map(([dept, total]) => ({ dept, total })).sort((a, b) => b.total - a.total);

    // --- RECRUITMENT ---
    const totalCandidates = candidates.length;
    const hired = candidates.filter(c => c.status === 'joined').length;
    const rejected = candidates.filter(c => c.status === 'rejected').length;
    const inPipeline = candidates.filter(c => !['joined', 'rejected'].includes(c.status)).length;
    const sourceMap = {};
    candidates.forEach(c => {
      const src = c.source || 'other';
      sourceMap[src] = (sourceMap[src] || 0) + 1;
    });
    const hiringBySource = Object.entries(sourceMap).map(([source, count]) => ({ source, count }));

    // --- PERFORMANCE ---
    const ratings = [1, 2, 3, 4, 5];
    const ratingDist = ratings.map(r => ({
      rating: `${r} Star`,
      count: performances.filter(p => Math.round(p.overall_rating) === r).length,
    }));

    // --- TICKETS ---
    const openTickets = tickets.filter(t => t.status === 'open').length;
    const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;
    const ticketsByCategory = {};
    tickets.forEach(t => {
      const cat = t.category || 'other';
      ticketsByCategory[cat] = (ticketsByCategory[cat] || 0) + 1;
    });

    // --- REIMBURSEMENTS ---
    const totalReimbursements = reimbursements.reduce((s, r) => s + (r.amount || 0), 0);
    const pendingReimbursements = reimbursements.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0);
    const expenseByCategory = {};
    reimbursements.forEach(r => {
      expenseByCategory[r.expense_type || 'other'] = (expenseByCategory[r.expense_type || 'other'] || 0) + (r.amount || 0);
    });

    // --- AI INSIGHTS ---
    const insights = [];
    const attendanceRate = totalActive > 0 ? (presentToday / totalActive * 100) : 100;
    if (attendanceRate < 70) insights.push({ type: 'warning', message: `Low attendance today: ${attendanceRate.toFixed(1)}% — ${absentToday} employees absent.` });
    if (attritionRate > 15) insights.push({ type: 'danger', message: `High attrition alert: ${attritionRate}% annualized attrition rate detected.` });
    if (pendingLeaves.length > 10) insights.push({ type: 'info', message: `${pendingLeaves.length} leave requests are pending approval.` });
    if (openTickets > 5) insights.push({ type: 'info', message: `${openTickets} helpdesk tickets are open and unresolved.` });

    const deptWithHighAbsence = departmentBreakdown.filter(d => d.count > 0 && (d.present / d.count) < 0.6);
    if (deptWithHighAbsence.length > 0) {
      insights.push({ type: 'warning', message: `High absenteeism in: ${deptWithHighAbsence.map(d => d.name).join(', ')}` });
    }
    if (insights.length === 0) insights.push({ type: 'success', message: 'All metrics are within normal range. Good overall health!' });

    // --- ASSET ANALYTICS ---
    const assetTotal = assets.length;
    const assetAssigned = assets.filter(a => a.status === 'assigned').length;
    const assetAvailable = assets.filter(a => a.status === 'available').length;
    const assetUnderRepair = assets.filter(a => a.status === 'under_repair').length;
    const assetDiscarded = assets.filter(a => a.status === 'discarded').length;
    const overdueReturns = assets.filter(a => a.status === 'assigned' && a.return_date && a.return_date < todayStr).length;
    const commonAssets = assets.filter(a => a.assigned_to_user_id === '__common__').length;
    const assetTotalValue = assets.reduce((s, a) => s + (a.purchase_cost || 0), 0);
    const assetByType = {};
    assets.forEach(a => { const t = a.asset_type_name || 'Other'; assetByType[t] = (assetByType[t] || 0) + 1; });

    // --- EXIT ANALYTICS ---
    const exitInNotice = exits.filter(e => e.status === 'in_notice').length;
    const exitClearancePending = exits.filter(e => ['clearance_pending', 'clearance_done'].includes(e.status)).length;
    const exitFnfPending = exits.filter(e => e.status === 'fnf_pending').length;
    const exitCompletedMonth = exits.filter(e => {
      if (e.status !== 'completed' || !e.last_working_date) return false;
      const lwd = new Date(e.last_working_date);
      return lwd.getMonth() === currentMonth - 1 && lwd.getFullYear() === currentYear;
    }).length;
    const noticeDays = exits.filter(e => e.resignation_date && e.last_working_date).map(e => {
      const days = Math.round((new Date(e.last_working_date) - new Date(e.resignation_date)) / (1000 * 60 * 60 * 24));
      return days > 0 ? days : null;
    }).filter(Boolean);
    const avgNoticeDays = noticeDays.length > 0 ? Math.round(noticeDays.reduce((a, b) => a + b, 0) / noticeDays.length) : 0;

    // --- COMPLIANCE ANALYTICS ---
    const pfTotal = complianceRecords.reduce((s, r) => s + (r.pf_employee_contribution || 0) + (r.pf_employer_contribution || 0), 0);
    const esiTotal = complianceRecords.reduce((s, r) => s + (r.esi_employee_contribution || 0) + (r.esi_employer_contribution || 0), 0);
    const tdsTotal = complianceRecords.reduce((s, r) => s + (r.tds_deduction || 0), 0);
    const gratuityTotal = complianceRecords.reduce((s, r) => s + (r.gratuity_provision || 0), 0);
    const ptTotal = complianceRecords.reduce((s, r) => s + (r.pt_deduction || 0), 0);
    const kycMissing = employees.filter(e => !e.pan_number || !e.aadhar_number).length;
    const kycCompliant = activeEmployees.length - kycMissing;
    const overdueDeadlines = complianceDeadlines.filter(d => d.status !== 'completed' && d.due_date && d.due_date < todayStr).length;

    return Response.json({
      metrics: {
        totalActive,
        presentToday,
        absentToday,
        activeLeaves,
        totalPayrollCost,
        attritionRate: parseFloat(attritionRate),
        pendingLeaveRequests: pendingLeaves.length,
        openTickets,
        biometricSyncedCount: biometricRecords.length,
        avgWorkingHours: parseFloat(avgWorkingHours.toFixed(2)),
        avgBreakHours: parseFloat(avgBreakHours.toFixed(2)),
        avgDailyPunches: parseFloat(avgDailyPunches.toFixed(1)),
      },
      attendanceTrends,
      headcountGrowth,
      attritionTrend,
      departmentBreakdown,
      leaveTrend,
      payrollTrend,
      salarByDept,
      recruitment: { totalCandidates, hired, rejected, inPipeline, hiringBySource },
      ratingDist,
      tickets: { openTickets, resolvedTickets, byCategory: Object.entries(ticketsByCategory).map(([cat, count]) => ({ cat, count })) },
      reimbursements: { total: totalReimbursements, pending: pendingReimbursements, byCategory: Object.entries(expenseByCategory).map(([cat, total]) => ({ cat, total })) },
      assets: {
        total: assetTotal, assigned: assetAssigned, available: assetAvailable,
        underRepair: assetUnderRepair, discarded: assetDiscarded,
        overdueReturns, commonAssets, totalValue: assetTotalValue,
        byType: Object.entries(assetByType).map(([name, count]) => ({ name, count })),
      },
      exits: {
        total: exits.length, inNotice: exitInNotice, clearancePending: exitClearancePending,
        fnfPending: exitFnfPending, completedMonth: exitCompletedMonth, avgNoticeDays,
      },
      compliance: {
        pfTotal, esiTotal, tdsTotal, gratuityTotal, ptTotal,
        kycCompliant, kycMissing: kycMissing > 0 ? kycMissing : Math.max(0, kycMissing),
        overdueDeadlines,
      },
      insights,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});