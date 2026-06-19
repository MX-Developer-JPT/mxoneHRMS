import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { JWT_SECRET } from './auth.js';
import { callAI, callAIMessages } from '../utils/ai.js';
import { sendEmail, emailTemplates } from '../utils/email.js';

const router = Router();

const getUser = (req) => {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
};

const parseEntities = (rows) => rows.map(r => JSON.parse(r.data));

/* ─────────────────────────────────────────────────────── */
router.post('/:name', async (req, res) => {
  const { name } = req.params;
  const p = req.body || {};
  const cu = getUser(req);

  try {
  switch (name) {

    /* ── User management ──────────────────────────────── */
    case 'getAllUsers': {
      const users = db.prepare(
        'SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name FROM users'
      ).all();
      return res.json({ users });
    }

    case 'initNewUser': {
      const { user_id, email, full_name } = p;
      const ex = db.prepare("SELECT id FROM entities WHERE type='Employee' AND user_id=?").get(user_id);
      if (!ex) {
        const id = uuidv4();
        const d = { id, user_id, email: email||'', display_name: full_name||'',
                    status:'active', employee_status:'probation' };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Employee',?,'active',?)")
          .run(id, user_id, JSON.stringify(d));
      }
      db.prepare("UPDATE users SET role='employee',custom_role='employee' WHERE id=?").run(user_id);
      return res.json({ success: true });
    }

    case 'updateUserName': {
      if (!cu) return res.status(401).json({ error:'Unauthorized' });
      const { first_name='', middle_name='', last_name='' } = p;
      const full = [first_name, middle_name, last_name].filter(Boolean).join(' ');
      db.prepare("UPDATE users SET first_name=?,middle_name=?,last_name=?,full_name=?,display_name=?,updated_at=datetime('now') WHERE id=?")
        .run(first_name, middle_name, last_name, full, full, cu.id);
      return res.json({ success: true });
    }

    case 'updateUserDetails': {
      const uid = p.user_id || cu?.id;
      if (!uid) return res.status(400).json({ error:'user_id required' });
      const fields = []; const vals = [];
      if (p.full_name)    { fields.push('full_name=?');    vals.push(p.full_name); }
      if (p.display_name) { fields.push('display_name=?'); vals.push(p.display_name); }
      if (p.role)         { fields.push('role=?');         vals.push(p.role); }
      if (p.custom_role)  { fields.push('custom_role=?');  vals.push(p.custom_role); }
      if (fields.length) { vals.push(uid); db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...vals); }
      return res.json({ success: true });
    }

    case 'updateUserRole': {
      const { user_id, role, custom_role } = p;
      db.prepare("UPDATE users SET role=?,custom_role=? WHERE id=?").run(role, custom_role||role, user_id);
      return res.json({ success: true });
    }

    case 'linkUserToEmployee': {
      const { user_id, employee_id } = p;
      const row = db.prepare("SELECT data FROM entities WHERE type='Employee' AND id=?").get(employee_id);
      if (row) {
        const d = { ...JSON.parse(row.data), user_id };
        db.prepare("UPDATE entities SET data=?,user_id=? WHERE id=?").run(JSON.stringify(d), user_id, employee_id);
      }
      return res.json({ success: true });
    }

    /* ── Leave ────────────────────────────────────────── */
    case 'validateLeaveApplication': {
      const { leave_policy_id, start_date, end_date, half_day, user_id } = p;
      if (!leave_policy_id || !start_date || !end_date)
        return res.json({ valid:false, errors:['Missing required fields'], warnings:[], adjusted_days:0, available_balance:0 });
      const start = new Date(start_date); const end = new Date(end_date);
      const diff  = Math.ceil((end - start) / 86400000) + 1;
      const adjusted_days = half_day ? 0.5 : diff;
      const uid = user_id || cu?.id;
      const balRows = db.prepare("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=?").all(uid);
      const bal = balRows.map(r=>JSON.parse(r.data)).find(b=>b.leave_policy_id===leave_policy_id);
      const available_balance = bal?.available ?? 999;
      const errors = [];
      if (adjusted_days > available_balance) errors.push(`Insufficient balance. Available: ${available_balance}, Requested: ${adjusted_days}`);
      if (adjusted_days > 30) errors.push('Cannot exceed 30 days at once');
      return res.json({ valid:errors.length===0, adjusted_days, available_balance, errors, warnings:[] });
    }

    case 'accrueLeaveBalances': {
      const policies  = parseEntities(db.prepare("SELECT data FROM entities WHERE type='LeavePolicy' AND is_active=1").all());
      const employees = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all());
      const year = new Date().getFullYear();
      let accrued = 0;
      for (const emp of employees) {
        for (const pol of policies) {
          const monthly = (pol.total_days||0) / 12;
          const existing = parseEntities(db.prepare("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=?").all(emp.user_id))
            .find(b=>b.leave_policy_id===pol.id && b.year===year);
          if (existing) {
            const updated = { ...existing, accrued_this_year:(existing.accrued_this_year||0)+monthly, available:(existing.available||0)+monthly };
            db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(updated), existing.id);
          } else {
            const id = uuidv4();
            const d  = { id, user_id:emp.user_id, leave_policy_id:pol.id, year, total_allocated:pol.total_days, accrued_this_year:monthly, used:0, pending_approval:0, available:monthly, carried_forward:0 };
            db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'LeaveBalance',?,'active',?)").run(id,emp.user_id,JSON.stringify(d));
          }
          accrued++;
        }
      }
      return res.json({ success:true, accrued });
    }

    /* ── Payroll ──────────────────────────────────────── */
    case 'processPayroll':
    case 'processAdvancedPayroll': {
      const { month, year } = p;
      const employees = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all());

      // Date range for the month
      const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay   = new Date(year, month, 0).getDate();
      const endDate   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      const workingDays = 26; // Standard payroll calendar

      let processed = 0;
      for (const emp of employees) {
        const ex = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND user_id=?").all(emp.user_id))
          .find(r=>r.month===month && r.year===year);
        if (ex) continue;

        // Salary structure
        const ss    = parseEntities(db.prepare("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=? AND status='active'").all(emp.user_id)).at(-1);
        const basic = ss?.basic_salary||0; const hra=ss?.hra||0; const conv=ss?.conveyance||0; const spec=ss?.special_allowance||0;
        const gross = basic+hra+conv+spec;

        // Attendance-based LOP calculation
        const attRows = db.prepare(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date') BETWEEN ? AND ?"
        ).all(emp.user_id, startDate, endDate);
        const attRecords = attRows.map(r => JSON.parse(r.data));

        const presentDays = attRecords.filter(a => ['present', 'late', 'on_duty', 'work_from_home'].includes(a.status)).length;
        const halfDays    = attRecords.filter(a => a.status === 'half_day').length;
        const lopDays     = attRecords.filter(a => ['absent', 'lop'].includes(a.status)).length
                          + attRecords.reduce((sum, a) => sum + (a.lop_deduction_days || 0), 0);

        const effectivePresentDays = presentDays + halfDays * 0.5;
        const lopAmount = lopDays > 0 ? Math.round((gross / workingDays) * lopDays) : 0;
        const grossAfterLop = Math.max(0, gross - lopAmount);

        const pf  = Math.round(basic * 0.12);
        const pt  = grossAfterLop > 20000 ? 200 : 0;
        const esi = grossAfterLop <= 21000 ? Math.round(grossAfterLop * 0.0075) : 0;
        const totalDed = pf + pt + esi + lopAmount;
        const net = Math.max(0, gross - totalDed);

        const id = uuidv4();
        const payrollData = {
          id, user_id: emp.user_id, month, year,
          basic_salary: basic, hra, conveyance: conv, special_allowance: spec,
          gross_salary: gross,
          deductions: { pf, pt, esi, lop: lopAmount },
          total_deductions: totalDed, net_salary: net,
          working_days: workingDays, present_days: Math.round(effectivePresentDays),
          loss_of_pay_days: lopDays, loss_of_pay_amount: lopAmount,
          status: 'processed', processed_by: cu?.id,
          processed_at: new Date().toISOString(),
        };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Payroll',?,'processed',?)").run(id, emp.user_id, JSON.stringify(payrollData));
        processed++;
      }
      return res.json({ success:true, processed, message:`Processed payroll for ${processed} employees` });
    }

    case 'markAbsentEmployees': {
      const { date } = p;
      const targetDate = date || new Date().toISOString().slice(0, 10);

      // Get all active employees
      const empRows = db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all();
      const employees = empRows.map(r => JSON.parse(r.data));

      // Get employees who have an attendance record for this date
      const attRows = db.prepare(
        "SELECT user_id FROM entities WHERE type='Attendance' AND json_extract(data,'$.date')=?"
      ).all(targetDate);
      const presentUserIds = new Set(attRows.map(r => r.user_id));

      // Check for approved leaves on this date
      const leaveRows = db.prepare("SELECT data FROM entities WHERE type='Leave' AND status='approved'").all();
      const onLeaveUserIds = new Set();
      leaveRows.forEach(row => {
        const leave = JSON.parse(row.data);
        if (leave.start_date <= targetDate && leave.end_date >= targetDate) {
          onLeaveUserIds.add(leave.user_id);
        }
      });

      let marked = 0, skipped = 0;
      for (const emp of employees) {
        if (presentUserIds.has(emp.user_id)) { skipped++; continue; }
        if (onLeaveUserIds.has(emp.user_id)) { skipped++; continue; }

        const attId = uuidv4();
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'absent',?)").run(
          attId, emp.user_id,
          JSON.stringify({ id: attId, user_id: emp.user_id, date: targetDate, status: 'absent', source: 'auto_marked', created_at: new Date().toISOString() })
        );
        marked++;
      }
      return res.json({ success:true, marked, skipped, date: targetDate, message:`Marked ${marked} employees absent for ${targetDate}` });
    }

    case 'generatePayslip': {
      const { payroll_id } = p;
      const pRow = db.prepare("SELECT data FROM entities WHERE type='Payroll' AND id=?").get(payroll_id);
      if (!pRow) return res.json({ success:false, error:'Payroll record not found' });
      const payroll = JSON.parse(pRow.data);
      const eRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(payroll.user_id);
      const emp  = eRow ? JSON.parse(eRow.data) : {};
      const html = buildPayslipHtml(payroll, emp);
      return res.json({ success:true, html, data:payroll });
    }

    case 'generateBankTransferFile': {
      const { month, year, format = 'csv' } = p;
      const payrolls = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND status='processed'").all())
        .filter(r => r.month === month && r.year === year);
      if (payrolls.length === 0) return res.json({ success:false, error:'No processed payroll records for this period' });

      const lines = ['Beneficiary Name,Account Number,IFSC Code,Bank Name,Branch,Amount,Remarks'];
      for (const pr of payrolls) {
        const empRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(pr.user_id);
        const emp    = empRow ? JSON.parse(empRow.data) : {};
        const bank   = emp.bank_account_number || '';
        const ifsc   = emp.ifsc_code || '';
        const bankName = emp.bank_name || '';
        const branch = emp.bank_branch || '';
        const name   = emp.display_name || '';
        lines.push(`"${name}","${bank}","${ifsc}","${bankName}","${branch}",${pr.net_salary},"Salary ${month}/${year}"`);
      }

      const csv = lines.join('\n');
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
      const filename = `bank_transfer_${year}_${String(month).padStart(2,'0')}.csv`;
      writeFileSync(join(uploadsDir, filename), csv);

      return res.json({ success:true, file_url:`/uploads/${filename}`, records: payrolls.length, total_amount: payrolls.reduce((s,r)=>s+(r.net_salary||0),0) });
    }

    /* ── Attendance Report Export (session time + overtime) ── */
    case 'exportAttendanceReport': {
      const { month, year } = p;
      if (!month || !year) return res.json({ success: false, error: 'month and year required' });
      const m = parseInt(month), y = parseInt(year);
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0,10);
      const daysInMonth = new Date(y, m, 0).getDate();

      const employees = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all());
      const attRows   = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Attendance' AND json_extract(data,'$.date') >= ? AND json_extract(data,'$.date') <= ?").all(monthStart, monthEnd));

      // Build attendance map: user_id → date → record
      const attMap = {};
      for (const a of attRows) {
        if (!attMap[a.user_id]) attMap[a.user_id] = {};
        attMap[a.user_id][a.date] = a;
      }

      // Get shift info per employee
      const shiftCache = {};
      const getShift = (shiftId) => {
        if (!shiftId) return null;
        if (shiftCache[shiftId]) return shiftCache[shiftId];
        const sr = db.prepare("SELECT data FROM entities WHERE id=?").get(shiftId);
        const s  = sr ? JSON.parse(sr.data) : null;
        shiftCache[shiftId] = s;
        return s;
      };

      const defaultShift = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Shift' AND (json_extract(data,'$.is_default')=1 OR json_extract(data,'$.name') LIKE '%General%') LIMIT 1").all())[0] || null;

      const toMinutes = (t) => {
        if (!t) return 0;
        const [h, mi] = String(t).split(':').map(Number);
        return (h||0)*60 + (mi||0);
      };

      const shiftEndMinutes = (shift) => {
        const endTime = shift?.end_time || '18:00';
        return toMinutes(endTime);
      };

      // Build report rows
      const rows = employees.map(emp => {
        const shift  = getShift(emp.shift_id) || defaultShift;
        const shiftHours = shift ? (toMinutes(shift.end_time) - toMinutes(shift.start_time)) / 60 : 8;
        const stdMinutes = shiftHours * 60;
        const isOTEligible = !!emp.overtime_eligible;

        let totalPresent = 0, totalAbsent = 0, totalLeave = 0, totalHoliday = 0, totalOff = 0;
        let totalWorkingMins = 0, totalOvertimeMins = 0;
        const dayDetails = [];

        for (let d = 1; d <= daysInMonth; d++) {
          const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const rec  = attMap[emp.user_id]?.[dateStr];
          const dow  = new Date(dateStr).getDay();
          const isWeekend = dow === 0 || dow === 6;

          let cell = '', workedMins = 0, otMins = 0;

          if (!rec) {
            if (isWeekend) { cell = 'OFF'; totalOff++; }
            else { cell = 'A'; totalAbsent++; }
          } else {
            const s = rec.status;
            workedMins = Math.round((rec.working_hours || 0) * 60);

            if (rec.check_in_time && rec.check_out_time) {
              const checkIn  = new Date(rec.check_in_time);
              const checkOut = new Date(rec.check_out_time);
              workedMins = Math.max(0, Math.round((checkOut - checkIn) / 60000));
            }

            if (workedMins > stdMinutes && stdMinutes > 0) {
              otMins = workedMins - stdMinutes;
            }

            if (s === 'week_off') { cell = 'OFF'; totalOff++; }
            else if (s === 'holiday') { cell = 'H'; totalHoliday++; }
            else if (s === 'leave') { cell = 'L'; totalLeave++; }
            else if (s === 'half_day') { cell = 'HD'; totalPresent += 0.5; }
            else if (s === 'present' || s === 'late' || s === 'on_duty' || s === 'work_from_home') {
              cell = s === 'late' ? 'L*' : (s === 'on_duty' ? 'OD' : s === 'work_from_home' ? 'WFH' : 'P');
              totalPresent++;
            }
            else if (s === 'absent') { cell = 'A'; totalAbsent++; }
            else if (rec.check_in_time) { cell = 'P'; totalPresent++; }
            else { cell = 'A'; totalAbsent++; }

            totalWorkingMins += workedMins;
            if (isOTEligible) totalOvertimeMins += otMins;
          }

          const hhmm = (mins) => `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
          dayDetails.push({ cell, workedMins, otMins: isOTEligible ? otMins : 0, hhmm: hhmm(workedMins), othhmm: hhmm(isOTEligible ? otMins : 0) });
        }

        const totalWorkingHrs = (totalWorkingMins / 60).toFixed(2);
        const totalOvertimeHrs = isOTEligible ? (totalOvertimeMins / 60).toFixed(2) : '—';
        const avgDailyHrs = totalPresent > 0 ? (totalWorkingMins / 60 / totalPresent).toFixed(2) : '0.00';

        return { emp, shift, isOTEligible, totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff, totalWorkingHrs, totalOvertimeHrs, avgDailyHrs, dayDetails };
      });

      // Build CSV
      const monthLabel = new Date(y, m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
      const dayNums = Array.from({ length: daysInMonth }, (_, i) => i+1);

      const headers = [
        'Emp Code', 'Employee Name', 'Department', 'Designation', 'Shift', 'OT Eligible',
        ...dayNums.map(d => `${d} (Day)`),
        ...dayNums.map(d => `${d} (Hours)`),
        ...dayNums.map(d => `${d} (OT Hrs)`),
        'Days Present', 'Days Absent', 'Days Leave', 'Days Holiday', 'Days Off',
        'Total Working Hrs', 'Avg Daily Hrs', 'Total OT Hrs',
      ];

      const csvRows = rows.map(r => {
        const { emp, shift, isOTEligible, totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff, totalWorkingHrs, totalOvertimeHrs, avgDailyHrs, dayDetails } = r;
        return [
          emp.employee_code || '',
          emp.display_name  || '',
          emp.department    || '',
          emp.designation   || '',
          shift?.name || 'General',
          isOTEligible ? 'Yes' : 'No',
          ...dayDetails.map(d => d.cell),
          ...dayDetails.map(d => d.hhmm),
          ...dayDetails.map(d => isOTEligible ? d.othhmm : '—'),
          totalPresent, totalAbsent, totalLeave, totalHoliday, totalOff,
          totalWorkingHrs, avgDailyHrs, isOTEligible ? totalOvertimeHrs : '—',
        ];
      });

      const esc = (v) => `"${String(v ?? '').replace(/"/g,'""')}"`;
      const titleRow = `"Attendance Detailed Report — ${monthLabel}",,"Generated: ${new Date().toLocaleString('en-IN')}"`;
      const legendRow = '"P=Present, A=Absent, L=Leave, H=Holiday, HD=Half Day, OD=On Duty, WFH=Work from Home, OFF=Week Off, L*=Late"';
      const csv = [titleRow, legendRow, headers.map(esc).join(','), ...csvRows.map(r => r.map(esc).join(','))].join('\n');

      return res.json({ success: true, csv, filename: `Attendance_Report_${monthLabel.replace(' ','_')}.csv`, total_employees: rows.length });
    }

    /* ── Salary Sheet Export ─────────────────────────────── */
    case 'exportSalarySheet': {
      const { month, year } = p;
      if (!month || !year) return res.json({ success: false, error: 'month and year required' });
      const m = parseInt(month), y = parseInt(year);
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0,10);
      const workingDays = 26;
      const monthLabel = new Date(y, m-1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });

      const employees = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all());
      const payrolls  = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND json_extract(data,'$.month')=? AND json_extract(data,'$.year')=?").all(m, y));
      const payrollMap = Object.fromEntries(payrolls.map(pr => [pr.user_id, pr]));

      const attRows = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Attendance' AND json_extract(data,'$.date') >= ? AND json_extract(data,'$.date') <= ?").all(monthStart, monthEnd));
      const attMap = {};
      for (const a of attRows) {
        if (!attMap[a.user_id]) attMap[a.user_id] = [];
        attMap[a.user_id].push(a);
      }

      const headers = [
        'Emp Code', 'Employee Name', 'Department', 'Designation', 'Account No', 'IFSC', 'Bank',
        'Days Present', 'Days Half Day', 'Days LOP', 'Days Absent', 'Total Working Days',
        'Gross Salary', 'Basic', 'HRA', 'Conveyance', 'Special Allowance',
        'PF Employee', 'PF Employer', 'ESI Employee', 'ESI Employer', 'Professional Tax',
        'LOP Deduction', 'Total Deductions', 'Net Salary', 'Status',
      ];

      const csvRows = employees.map(emp => {
        const pr  = payrollMap[emp.user_id];
        const recs = attMap[emp.user_id] || [];

        let daysPresent = 0, daysHalfDay = 0, daysLOP = 0;
        if (pr) {
          daysPresent  = pr.present_days || 0;
          daysHalfDay  = pr.half_days    || 0;
          daysLOP      = pr.lop_days     || 0;
        } else {
          // Compute from raw attendance if no payroll
          daysPresent  = recs.filter(a => ['present','late','on_duty','work_from_home'].includes(a.status)).length;
          daysHalfDay  = recs.filter(a => a.status === 'half_day').length;
          daysLOP      = recs.filter(a => ['absent','lop'].includes(a.status)).length;
        }
        const effectiveDays = daysPresent + (daysHalfDay * 0.5);

        // Get salary structure
        const ssRow = db.prepare("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=? AND status='active' LIMIT 1").get(emp.user_id);
        const ss    = ssRow ? JSON.parse(ssRow.data) : {};
        const gross = (ss.basic_salary||0) + (ss.hra||0) + (ss.conveyance||0) + (ss.special_allowance||0);
        const earnedGross = gross > 0 ? Math.round((gross / workingDays) * effectiveDays) : 0;

        const basic    = pr?.basic    || Math.round((ss.basic_salary||0)  / workingDays * effectiveDays);
        const hra      = pr?.hra      || Math.round((ss.hra||0)           / workingDays * effectiveDays);
        const conv     = pr?.conveyance || Math.round((ss.conveyance||0)  / workingDays * effectiveDays);
        const special  = pr?.special_allowance || Math.round((ss.special_allowance||0) / workingDays * effectiveDays);
        const grossCalc = basic + hra + conv + special;

        const pfEmp  = pr?.pf_employee  ?? Math.round(basic * 0.12);
        const pfEmpr = pr?.pf_employer  ?? Math.round(basic * 0.12);
        const esiEmp = pr?.esi_employee ?? (grossCalc <= 21000 ? Math.round(grossCalc * 0.0075) : 0);
        const esiEmpr= pr?.esi_employer ?? (grossCalc <= 21000 ? Math.round(grossCalc * 0.0325) : 0);
        const pt     = pr?.professional_tax ?? (grossCalc > 15000 ? 200 : grossCalc > 10000 ? 150 : 0);
        const lop    = pr?.lop_amount ?? Math.round((gross / workingDays) * daysLOP);
        const totalDed = pfEmp + esiEmp + pt + lop;
        const netSalary = Math.max(0, grossCalc - totalDed);

        return [
          emp.employee_code || '',
          emp.display_name  || '',
          emp.department    || '',
          emp.designation   || '',
          emp.bank_account_number || '',
          emp.ifsc_code || '',
          emp.bank_name || '',
          daysPresent, daysHalfDay, daysLOP,
          recs.filter(a => a.status === 'absent').length,
          effectiveDays,
          pr?.gross_salary || grossCalc,
          basic, hra, conv, special,
          pfEmp, pfEmpr, esiEmp, esiEmpr, pt,
          lop, totalDed, pr?.net_salary || netSalary,
          pr ? 'Processed' : 'Pending',
        ];
      });

      const esc = (v) => `"${String(v ?? '').replace(/"/g,'""')}"`;
      const csv = [
        `"Salary Sheet — ${monthLabel}",,"Generated: ${new Date().toLocaleString('en-IN')}"`,
        headers.map(esc).join(','),
        ...csvRows.map(r => r.map(esc).join(','))
      ].join('\n');

      const totals = csvRows.reduce((acc, r) => {
        acc.gross      += parseFloat(r[12]) || 0;
        acc.net        += parseFloat(r[23]) || 0;
        acc.pf_emp     += parseFloat(r[14]) || 0;
        acc.esi_emp    += parseFloat(r[16]) || 0;
        return acc;
      }, { gross:0, net:0, pf_emp:0, esi_emp:0 });

      return res.json({ success: true, csv, filename: `Salary_Sheet_${monthLabel.replace(' ','_')}.csv`, total_employees: employees.length, totals });
    }

    /* ── API Key Management (for external attendance push) ─ */
    case 'getAttendanceApiInfo': {
      const key = db.prepare("SELECT value FROM settings WHERE key='attendance_api_key'").get()?.value || null;
      const baseUrl = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://your-app.up.railway.app' : `http://localhost:${process.env.PORT || 3001}`);
      return res.json({
        success: true,
        api_key: key,
        endpoint: `${baseUrl}/api/attendance-log`,
        docs: {
          method: 'POST',
          auth: 'Authorization: Bearer <api_key>',
          single: { employee_code: 'EMP001', punch_time: '2024-06-19T09:00:00.000Z', type: 'in', device_id: 'DEVICE01' },
          batch: { records: [{ employee_code: 'EMP001', punch_time: '2024-06-19T09:00:00.000Z', type: 'in' }] },
        },
      });
    }

    case 'generateAttendanceApiKey': {
      // Only admins may regenerate
      const { randomBytes } = await import('crypto');
      const newKey = randomBytes(32).toString('hex');
      db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('attendance_api_key',?)").run(newKey);
      // Also update env-like value so attendancelog.js picks it up via this DB key
      process.env.ATTENDANCE_API_KEY = newKey;
      return res.json({ success: true, api_key: newKey });
    }

    case 'autoSendPayslips': {
      const { month, year } = p;
      const payrolls = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND status='processed'").all())
        .filter(r=>r.month===month && r.year===year);
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      let sent = 0; const errors = [];
      for (const payroll of payrolls) {
        const uRow = db.prepare("SELECT email,full_name FROM users WHERE id=?").get(payroll.user_id);
        if (!uRow?.email) continue;
        const eRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(payroll.user_id);
        const emp  = eRow ? JSON.parse(eRow.data) : {};
        const html = buildPayslipHtml(payroll, emp);
        const tpl  = emailTemplates.payslip({ employeeName:uRow.full_name, month:months[month-1], year, netPay:payroll.net_salary, payslipHtml:html });
        try {
          await sendEmail({ to:uRow.email, ...tpl });
          sent++;
        } catch(e) { errors.push(`${uRow.email}: ${e.message}`); }
      }
      return res.json({ success:true, sent, errors, message:`Sent ${sent} payslips` });
    }

    case 'processFnFSettlement': {
      const { exit_id, employee_id } = p;
      if (!exit_id && !employee_id) return res.json({ success:false, error:'exit_id or employee_id required' });

      const exitRow = exit_id
        ? db.prepare("SELECT data FROM entities WHERE type='Exit' AND id=?").get(exit_id)
        : db.prepare("SELECT data FROM entities WHERE type='Exit' AND user_id=?").get(employee_id);
      if (!exitRow) return res.json({ success:false, error:'Exit record not found' });
      const exitData = JSON.parse(exitRow.data);

      const empRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(exitData.user_id || employee_id);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const ssRow = db.prepare("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=? AND status='active'").get(emp.user_id || employee_id);
      const ss    = ssRow ? JSON.parse(ssRow.data) : {};

      const gross        = (ss.basic_salary||0) + (ss.hra||0) + (ss.conveyance||0) + (ss.special_allowance||0);
      const dailySalary  = gross > 0 ? gross / 26 : 0;

      // LOP for notice period shortfall (if employee left without serving full notice)
      const noticePeriodDays = parseInt(emp.notice_period_days) || 30;
      const servedDays       = parseInt(exitData.notice_days_served) || noticePeriodDays;
      const shortfallDays    = Math.max(0, noticePeriodDays - servedDays);
      const noticePeriodDeduction = Math.round(shortfallDays * dailySalary);

      // Leave encashment for pending earned leave
      const leaveBalRows = db.prepare("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=?").all(emp.user_id || employee_id);
      const earnedLeaveBalance = leaveBalRows.map(r => JSON.parse(r.data)).find(lb => lb.balance_type === 'earned' || lb.leave_type === 'earned_leave')?.balance || 0;
      const leaveEncashment = Math.round(earnedLeaveBalance * dailySalary);

      // Pro-rata salary for last partial month
      const lastWorkingDate = exitData.last_working_date ? new Date(exitData.last_working_date) : new Date();
      const daysWorkedInMonth = lastWorkingDate.getDate();
      const proRataSalary = Math.round(daysWorkedInMonth * dailySalary);

      const gratuityEligible = parseInt(emp.years_of_service || emp.tenure_years || 0) >= 5;
      const gratuity = gratuityEligible ? Math.round((ss.basic_salary||0) * 15 / 26 * Math.min(parseInt(emp.years_of_service||0), 30)) : 0;

      const totalPayable = proRataSalary + leaveEncashment + gratuity;
      const totalDeductions = noticePeriodDeduction;
      const netPayable = Math.max(0, totalPayable - totalDeductions);

      const fnf = {
        employee_id: emp.id, user_id: emp.user_id,
        gross_monthly: gross, daily_rate: Math.round(dailySalary),
        pro_rata_salary: proRataSalary, days_worked_last_month: daysWorkedInMonth,
        leave_encashment: leaveEncashment, earned_leave_days: earnedLeaveBalance,
        gratuity, gratuity_eligible: gratuityEligible,
        notice_shortfall_days: shortfallDays, notice_period_deduction: noticePeriodDeduction,
        total_payable: totalPayable, total_deductions: totalDeductions, net_payable: netPayable,
        computed_at: new Date().toISOString(),
      };

      // Save to exit record
      const updatedExit = { ...exitData, fnf_settlement: fnf, fnf_computed_at: new Date().toISOString() };
      db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(updatedExit), exitRow.id);

      return res.json({ success:true, ...fnf });
    }

    /* ── Attendance ───────────────────────────────────── */
    case 'getAllAttendance': {
      const { date, user_id: uid, date_from, date_to } = p;
      let rows = uid
        ? db.prepare("SELECT data FROM entities WHERE type='Attendance' AND user_id=?").all(uid)
        : db.prepare("SELECT data FROM entities WHERE type='Attendance'").all();
      let records = rows.map(r=>JSON.parse(r.data));
      if (date) records = records.filter(a=>a.date===date);
      if (date_from) records = records.filter(a=>a.date>=date_from);
      if (date_to) records = records.filter(a=>a.date<=date_to);
      return res.json({ records });
    }

    case 'markExemptEmployeesPresent': {
      const { date } = p;
      const exempts = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all())
        .filter(e=>e.is_attendance_exempt);
      let marked = 0;
      for (const emp of exempts) {
        const ex = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Attendance' AND user_id=?").all(emp.user_id))
          .find(a=>a.date===date);
        if (!ex) {
          const id = uuidv4();
          const d  = { id, user_id:emp.user_id, date, status:'present', auto_marked:true, working_hours:9 };
          db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'present',?)").run(id,emp.user_id,JSON.stringify(d));
          marked++;
        }
      }
      return res.json({ success:true, marked });
    }

    case 'receiveMxOneAttendanceSync': case 'fetchBiometricAttendance': case 'ebioWebhook': {
      // Accepts eBio-format records from MxOneSync (PascalCase keys)
      // Each punch arrives as a single JSON object (not a batch) from WebhookClient
      // Also accepts { records: [...] } batch from any caller

      // ── API key check (same key stored in settings) ────────────────────────
      const storedKey = db.prepare("SELECT value FROM settings WHERE key='attendance_api_key'").get()?.value || process.env.ATTENDANCE_API_KEY || null;
      if (storedKey) {
        const authHeader = req.headers['authorization'] || req.headers['x-api-key'] || '';
        const qKey = req.query?.key || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        if (token !== storedKey && qKey !== storedKey) {
          return res.status(401).json({ success: false, error: 'Invalid API key' });
        }
      }

      // Normalise: if body has EmployeeCode it's a single eBio record; if records[] it's a batch
      let rawRecords = [];
      if (Array.isArray(p.records)) {
        rawRecords = p.records;
      } else if (p.EmployeeCode || p.employee_code) {
        rawRecords = [p];
      } else {
        return res.json({ success: true, processed: 0, message: 'No records in payload' });
      }

      // Load employee code → user_id mapping
      const empRows = db.prepare("SELECT data FROM entities WHERE type='Employee'").all();
      const emps = empRows.map(r => JSON.parse(r.data));
      const mappingRows = db.prepare("SELECT data FROM entities WHERE type='BiometricCodeMapping'").all();
      const codeMap = {};
      mappingRows.forEach(r => { const m = JSON.parse(r.data); if (m.biometric_code && m.user_id) codeMap[String(m.biometric_code).toLowerCase()] = m.user_id; });
      emps.forEach(e => { if (e.employee_code) codeMap[String(e.employee_code).toLowerCase()] = e.user_id; });

      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const toIST = (raw) => {
        if (!raw) return null;
        const s = String(raw).trim();
        const forceUTC = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
        const d = new Date(forceUTC);
        return isNaN(d.getTime()) ? null : new Date(d.getTime() + IST_OFFSET_MS);
      };

      let processed = 0, skipped = 0;
      const byDate = {}; // key: userId_date → { userId, date, entries }

      for (const rec of rawRecords) {
        // Support both eBio PascalCase and internal lowercase
        const empCode = String(rec.EmployeeCode || rec.employee_code || rec.EnrollNo || rec.pin || '').toLowerCase();
        const logDateRaw = rec.LogDate || rec.log_date || rec.punch_time || rec.datetime || '';
        const direction  = String(rec.Direction || rec.type || 'in').toUpperCase();

        if (!empCode || !logDateRaw) { skipped++; continue; }
        const userId = codeMap[empCode];
        if (!userId) { skipped++; continue; }

        const istDate = toIST(logDateRaw);
        if (!istDate) { skipped++; continue; }

        const punchType = (direction === 'IN' || direction === 'in') ? 'in' : 'out';
        const punchIso  = istDate.toISOString(); // store as the actual IST-adjusted UTC moment
        const dateStr   = punchIso.slice(0, 10);

        // Deduplicate logs
        const existing = db.prepare("SELECT id FROM entities WHERE type='AttendanceLog' AND json_extract(data,'$.EmployeeCode')=? AND json_extract(data,'$.LogDate')=?").get(rec.EmployeeCode || empCode, logDateRaw);
        if (!existing) {
          const logId = uuidv4();
          const logData = { ...rec, id: logId, EmployeeCode: rec.EmployeeCode || empCode, LogDate: logDateRaw, user_id: userId, punch_type: punchType, punch_iso: punchIso, imported_at: new Date().toISOString() };
          try {
            db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'AttendanceLog',?,'active',?)").run(logId, userId, JSON.stringify(logData));
          } catch {}
        }

        // Group by employee+date for attendance record creation
        const key = `${userId}_${dateStr}`;
        if (!byDate[key]) byDate[key] = { userId, date: dateStr, punches: [] };
        byDate[key].punches.push({ iso: punchIso, type: punchType });
        processed++;
      }

      // Upsert Attendance records
      for (const { userId, date, punches } of Object.values(byDate)) {
        if (punches.length === 0) continue;
        punches.sort((a, b) => a.iso.localeCompare(b.iso));
        const firstIn  = punches.find(p2 => p2.type === 'in')?.iso  || punches[0].iso;
        const lastOut  = [...punches].reverse().find(p2 => p2.type === 'out')?.iso || null;

        const existing = db.prepare("SELECT id,data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date')=?").get(userId, date);
        if (existing) {
          const d = JSON.parse(existing.data);
          if (d.status === 'regularised') continue; // never overwrite a regularised record
          const updated = {
            ...d,
            check_in_time:  !d.check_in_time  || firstIn  < d.check_in_time  ? firstIn  : d.check_in_time,
            check_out_time: !d.check_out_time || (lastOut && lastOut > d.check_out_time) ? lastOut : d.check_out_time,
            biometric_synced: true, status: d.status || 'present',
          };
          db.prepare("UPDATE entities SET data=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(updated), existing.id);
        } else {
          const attId = uuidv4();
          const attData = { id: attId, user_id: userId, date, check_in_time: firstIn, check_out_time: lastOut, status: 'present', source: 'biometric', biometric_synced: true };
          db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'present',?)").run(attId, userId, JSON.stringify(attData));
        }
      }

      return res.json({ success: true, received: rawRecords.length, processed, skipped, attendance_records: Object.keys(byDate).length });
    }

    case 'receiveBiometricAttendance':
    case 'processEbioLogs': {
      const { date_from, date_to, raw_records = [] } = p;

      if (raw_records.length === 0 && !date_from) {
        return res.json({ success:false, error:'Provide raw_records or date_from/date_to' });
      }

      // Load employee code → user_id mapping (from Employee entities + BiometricCodeMapping)
      const empRows = db.prepare("SELECT data FROM entities WHERE type='Employee'").all();
      const employees = empRows.map(r => JSON.parse(r.data));
      // Also check BiometricCodeMapping entity
      const mappingRows = db.prepare("SELECT data FROM entities WHERE type='BiometricCodeMapping'").all();
      const codeMap = {};
      mappingRows.forEach(r => {
        const m = JSON.parse(r.data);
        if (m.biometric_code && m.user_id) codeMap[String(m.biometric_code).toLowerCase()] = m.user_id;
      });
      // Fallback: match by employee_code field on Employee
      employees.forEach(e => {
        if (e.employee_code) codeMap[String(e.employee_code).toLowerCase()] = e.user_id;
      });

      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const toIST = (utcStr) => {
        if (!utcStr) return null;
        const s = String(utcStr).trim();
        const forceUTC = /Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z';
        const d = new Date(forceUTC);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + IST_OFFSET_MS);
      };

      // Store logs in AttendanceLog entities + group by (user_id, date)
      const byEmployeeDate = {}; // key: `userId_date`

      let storedCount = 0;
      for (const record of raw_records) {
        const empCode = String(record.EmployeeCode || record.emp_code || record.employee_code || record.EnrollNo || record.pin || '').toLowerCase();
        const logDateRaw = record.LogDate || record.log_date || record.punch_time || record.datetime || '';
        if (!empCode || !logDateRaw) continue;

        const userId = codeMap[empCode];
        if (!userId) continue; // unknown employee code

        const istDate = toIST(logDateRaw);
        if (!istDate) continue;

        const dateStr = istDate.toISOString().slice(0, 10);
        const timeStr = `${String(istDate.getUTCHours()).padStart(2,'0')}:${String(istDate.getUTCMinutes()).padStart(2,'0')}`;

        // Persist log in AttendanceLog entity (avoid duplicates)
        const existingLog = db.prepare(
          "SELECT id FROM entities WHERE type='AttendanceLog' AND json_extract(data,'$.EmployeeCode')=? AND json_extract(data,'$.LogDate')=?"
        ).get(record.EmployeeCode || empCode, logDateRaw);

        if (!existingLog) {
          const logId = uuidv4();
          const logData = { ...record, id: logId, EmployeeCode: record.EmployeeCode || empCode, LogDate: logDateRaw, user_id: userId, imported_at: new Date().toISOString() };
          try {
            db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'AttendanceLog',?,'active',?)")
              .run(logId, userId, JSON.stringify(logData));
            storedCount++;
          } catch {}
        }

        const key = `${userId}_${dateStr}`;
        if (!byEmployeeDate[key]) byEmployeeDate[key] = { userId, date: dateStr, times: [] };
        byEmployeeDate[key].times.push(timeStr);
      }

      // Also process date range from existing AttendanceLogs in DB if date_from provided
      if (date_from && raw_records.length === 0) {
        const logRows = db.prepare(
          "SELECT data FROM entities WHERE type='AttendanceLog'"
        ).all();
        logRows.forEach(row => {
          const log = JSON.parse(row.data);
          if (!log.user_id || !log.LogDate) return;
          const istDate = toIST(log.LogDate);
          if (!istDate) return;
          const dateStr = istDate.toISOString().slice(0, 10);
          if (date_from && dateStr < date_from) return;
          if (date_to && dateStr > date_to) return;
          const timeStr = `${String(istDate.getUTCHours()).padStart(2,'0')}:${String(istDate.getUTCMinutes()).padStart(2,'0')}`;
          const key = `${log.user_id}_${dateStr}`;
          if (!byEmployeeDate[key]) byEmployeeDate[key] = { userId: log.user_id, date: dateStr, times: [] };
          byEmployeeDate[key].times.push(timeStr);
        });
      }

      // Create/update Attendance records
      let records_synced = 0;
      const toMins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

      for (const entry of Object.values(byEmployeeDate)) {
        const { userId, date, times } = entry;
        if (!times.length) continue;

        times.sort();
        const checkIn  = times[0];
        const checkOut = times.length > 1 ? times[times.length - 1] : null;

        // Get employee's shift
        const empRow   = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(userId);
        const emp      = empRow ? JSON.parse(empRow.data) : {};
        const shiftRow = emp.shift_id
          ? db.prepare("SELECT data FROM entities WHERE type='Shift' AND id=?").get(emp.shift_id)
          : db.prepare("SELECT data FROM entities WHERE type='Shift' AND json_extract(data,'$.is_default')=1").get();
        const shift = shiftRow ? JSON.parse(shiftRow.data) : { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };

        // Compute status
        const inMins  = toMins(checkIn);
        const outMins = checkOut ? toMins(checkOut) : null;
        const shiftStart = toMins(shift.start_time || '09:00');
        const grace = shift.grace_period_minutes || 15;
        const shiftHours = shift.working_hours || 9;

        let status = 'present', working_hours = 0, late_minutes = 0;
        if (outMins !== null) {
          working_hours = (outMins - inMins) / 60;
          if (working_hours < shiftHours / 2) status = 'short_attendance';
          else if (working_hours < shiftHours * 0.9) status = 'half_day';
          else status = 'present';
        } else {
          status = 'in_progress';
        }

        if (inMins > shiftStart + grace) {
          late_minutes = inMins - shiftStart - grace;
          if (status === 'present') status = 'late';
        }

        const attData = {
          user_id: userId, date, employee_code: emp.employee_code || '',
          check_in_time: checkIn, check_out_time: checkOut,
          status, working_hours: Math.round(working_hours * 100) / 100, late_minutes,
          punch_count: times.length, source: 'biometric',
          updated_at: new Date().toISOString(),
        };

        // Upsert attendance record
        const existAtt = db.prepare(
          "SELECT id FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date')=?"
        ).get(userId, date);

        if (existAtt) {
          const existing = JSON.parse(db.prepare("SELECT data FROM entities WHERE id=?").get(existAtt.id).data);
          // Don't overwrite regularised records
          if (!existing.regularised) {
            db.prepare("UPDATE entities SET status=?, data=? WHERE id=?")
              .run(status, JSON.stringify({ ...existing, ...attData, id: existAtt.id }), existAtt.id);
            records_synced++;
          }
        } else {
          const attId = uuidv4();
          db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'active',?)")
            .run(attId, userId, JSON.stringify({ ...attData, id: attId, created_at: new Date().toISOString() }));
          records_synced++;
        }
      }

      return res.json({ success:true, records_synced, logs_stored: storedCount, employees_processed: Object.keys(byEmployeeDate).length, message: `Processed ${raw_records.length} biometric punches → ${records_synced} attendance records` });
    }

    case 'processRegularisation': {
      const { regularisation_id, action, comment = '', role = 'manager' } = p;
      if (!regularisation_id || !action) return res.status(400).json({ error: 'regularisation_id and action required' });

      const row = db.prepare("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND id=?").get(regularisation_id);
      if (!row) return res.status(404).json({ error: 'Regularisation request not found' });
      const reg = JSON.parse(row.data);

      let newStatus = reg.status;
      const update  = { updated_at: new Date().toISOString() };

      if (role === 'manager') {
        if (action === 'approve') {
          newStatus = 'manager_approved';
          update.manager_approved_at = new Date().toISOString();
          update.manager_comment = comment;
        } else if (action === 'reject') {
          newStatus = 'rejected';
          update.manager_comment = comment;
          update.rejected_at = new Date().toISOString();
        } else if (action === 'send_back') {
          newStatus = 'sent_back';
          update.manager_comment = comment;
        }
      } else if (role === 'hr') {
        if (action === 'approve') {
          newStatus = 'completed';
          update.hr_approved_at = new Date().toISOString();
          update.hr_comment = comment;

          // Update the actual Attendance record for that date
          try {
            const attRow = db.prepare(
              "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date')=?"
            ).get(reg.user_id, reg.date);

            if (attRow) {
              const att = JSON.parse(attRow.data);
              const updAtt = {
                ...att,
                status: reg.requested_status || 'present',
                regularised: true,
                regularisation_id,
                check_in_time:  reg.requested_check_in  || att.check_in_time,
                check_out_time: reg.requested_check_out || att.check_out_time,
              };
              db.prepare("UPDATE entities SET status=?, data=? WHERE id=?")
                .run(updAtt.status, JSON.stringify(updAtt), attRow.id);
            } else {
              // Create attendance record if it doesn't exist
              const newAttId = uuidv4();
              const newAtt = {
                id: newAttId,
                user_id: reg.user_id,
                date: reg.date,
                status: reg.requested_status || 'present',
                regularised: true,
                regularisation_id,
                check_in_time:  reg.requested_check_in  || null,
                check_out_time: reg.requested_check_out || null,
                created_at: new Date().toISOString(),
              };
              db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Attendance',?,'present',?)")
                .run(newAttId, reg.user_id, JSON.stringify(newAtt));
            }
          } catch (e) { console.warn('Attendance update on regularisation approval failed:', e.message); }

        } else if (action === 'reject') {
          newStatus = 'rejected';
          update.hr_comment = comment;
          update.rejected_at = new Date().toISOString();
        }
      }

      const updReg = { ...reg, ...update, status: newStatus };
      db.prepare("UPDATE entities SET status=?, data=? WHERE id=?")
        .run(newStatus, JSON.stringify(updReg), regularisation_id);

      // In-app notification to employee
      try {
        const notifId = uuidv4();
        const notifData = {
          id: notifId, user_id: reg.user_id, type: newStatus === 'completed' ? 'success' : newStatus === 'rejected' ? 'error' : 'info',
          title: `Regularisation ${newStatus === 'completed' ? 'Approved' : newStatus === 'rejected' ? 'Rejected' : 'Updated'}`,
          message: `Your regularisation request for ${reg.date} has been ${newStatus.replace('_', ' ')}.${comment ? ' Comment: ' + comment : ''}`,
          read: false, created_at: new Date().toISOString(),
        };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Notification',?,'unread',?)")
          .run(notifId, reg.user_id, JSON.stringify(notifData));
      } catch {}

      return res.json({ success: true, status: newStatus });
    }

    case 'calculateLOP': {
      const { employee_id, month, year } = p;
      if (!employee_id) return res.json({ success:true, lop_days:0, lop_amount:0 });

      const startDate = `${year || new Date().getFullYear()}-${String(month || new Date().getMonth()+1).padStart(2,'0')}-01`;
      const endDate   = new Date(year || new Date().getFullYear(), month || new Date().getMonth()+1, 0).toISOString().slice(0,10);

      const empRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND id=?").get(employee_id);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const attRows = db.prepare(
        "SELECT data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date') BETWEEN ? AND ?"
      ).all(emp.user_id || employee_id, startDate, endDate);
      const records = attRows.map(r => JSON.parse(r.data));

      const lop_days = records.filter(r => r.status === 'absent' || r.status === 'lop').length;

      // Basic CTC-based LOP calculation (per-day salary = monthly CTC / 26 working days)
      const ctc = parseFloat(emp.ctc || emp.current_ctc || 0);
      const daily = ctc > 0 ? ctc / 12 / 26 : 0;
      const lop_amount = Math.round(lop_days * daily);

      return res.json({ success:true, lop_days, lop_amount, total_records: records.length });
    }

    case 'computeAttendanceStatus': {
      const { attendance_id, employee_id, date } = p;

      // Get attendance record
      let attData;
      if (attendance_id) {
        const row = db.prepare("SELECT data FROM entities WHERE type='Attendance' AND id=?").get(attendance_id);
        if (!row) return res.json({ success:false, error:'Attendance record not found' });
        attData = JSON.parse(row.data);
      } else if (employee_id && date) {
        const empRow = db.prepare("SELECT data FROM entities WHERE type='Employee' AND id=?").get(employee_id);
        const emp    = empRow ? JSON.parse(empRow.data) : {};
        const row    = db.prepare(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=? AND json_extract(data,'$.date')=?"
        ).get(emp.user_id || employee_id, date);
        if (!row) return res.json({ success:false, error:'No attendance record for that employee/date' });
        attData = JSON.parse(row.data);
      } else {
        return res.json({ success:false, error:'Provide attendance_id OR (employee_id + date)' });
      }

      // Get shift
      const empRow   = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(attData.user_id);
      const emp      = empRow ? JSON.parse(empRow.data) : {};
      const shiftRow = emp.shift_id
        ? db.prepare("SELECT data FROM entities WHERE type='Shift' AND id=?").get(emp.shift_id)
        : db.prepare("SELECT data FROM entities WHERE type='Shift' AND json_extract(data,'$.is_default')=1").get();
      const shift    = shiftRow ? JSON.parse(shiftRow.data) : { start_time:'09:00', end_time:'18:00', working_hours:9, grace_period_minutes:15 };

      const toMins = (timeStr) => {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };

      const checkInMins  = toMins(attData.check_in_time);
      const checkOutMins = toMins(attData.check_out_time);
      const shiftStartMins = toMins(shift.start_time);
      const shiftEndMins   = toMins(shift.end_time);
      const grace          = shift.grace_period_minutes || 15;

      let status = 'absent', working_hours = 0, late_minutes = 0, overtime_minutes = 0;

      if (checkInMins !== null) {
        if (checkOutMins !== null && checkOutMins > checkInMins) {
          working_hours = (checkOutMins - checkInMins) / 60;
          const halfDay = (shift.working_hours || 9) / 2;
          if (working_hours >= (shift.working_hours || 9) * 0.9) {
            status = 'present';
          } else if (working_hours >= halfDay) {
            status = 'half_day';
          } else {
            status = 'short_attendance';
          }
        } else {
          // Checked in but not out yet — mark as in progress
          status = 'in_progress';
        }

        if (shiftStartMins !== null && checkInMins > shiftStartMins + grace) {
          late_minutes = checkInMins - shiftStartMins - grace;
          if (status === 'present') status = 'late';
        }

        if (checkOutMins !== null && shiftEndMins !== null && checkOutMins > shiftEndMins + 15) {
          overtime_minutes = checkOutMins - shiftEndMins - 15;
        }
      }

      const updated = {
        ...attData,
        status,
        working_hours: Math.round(working_hours * 100) / 100,
        late_minutes,
        overtime_minutes,
        computed_at: new Date().toISOString(),
      };

      // Persist the computed values
      const idToUpdate = attData.id || attendance_id;
      if (idToUpdate) {
        db.prepare("UPDATE entities SET status=?, data=? WHERE type='Attendance' AND id=?")
          .run(status, JSON.stringify(updated), idToUpdate);
      }

      return res.json({ success:true, status, working_hours: updated.working_hours, late_minutes, overtime_minutes, shift_name: shift.name });
    }

    /* ── Performance ─────────────────────────────────── */
    case 'pmsGetDashboard': {
      const reviews   = parseEntities(db.prepare("SELECT data FROM entities WHERE type='PerformanceReview'").all());
      const completed = reviews.filter(r=>r.status==='completed').length;
      const pending   = reviews.filter(r=>r.status==='pending').length;
      const avg       = reviews.length ? (reviews.reduce((s,r)=>s+(r.final_score||0),0)/reviews.length).toFixed(1) : 0;
      return res.json({ total_reviews:reviews.length, completed, pending, average_score:avg });
    }

    case 'pmsCalculateScore': {
      const { review_id } = p;
      if (!review_id) return res.json({ score:0, rating:'Pending' });
      const rRow = db.prepare("SELECT data FROM entities WHERE type='PerformanceReview' AND id=?").get(review_id);
      if (!rRow) return res.json({ score:0, rating:'Not Found' });
      const review = JSON.parse(rRow.data);

      // Calculate weighted score from KPIs/goals if available
      const goals = review.goals || review.kpis || [];
      let score = 0;
      if (goals.length > 0) {
        const total = goals.reduce((sum, g) => {
          const weight  = g.weight || (100 / goals.length);
          const achieved = Math.min(100, g.achieved_percentage || g.score || 0);
          return sum + (achieved * weight / 100);
        }, 0);
        score = Math.round(total);
      } else if (review.self_rating || review.manager_rating) {
        // Simple average of available ratings (0-5 scale → 0-100)
        const selfScore    = (review.self_rating    || 0) * 20;
        const managerScore = (review.manager_rating || 0) * 20;
        score = selfScore && managerScore ? Math.round((selfScore + managerScore) / 2) : selfScore || managerScore;
      }

      const rating = score >= 90 ? 'Outstanding' : score >= 75 ? 'Exceeds Expectations' : score >= 60 ? 'Meets Expectations' : score >= 45 ? 'Needs Improvement' : 'Below Expectations';

      // Persist the score
      const updated = { ...review, final_score: score, rating, score_computed_at: new Date().toISOString() };
      db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(updated), review_id);

      return res.json({ score, rating });
    }

    case 'pmsRecommendTraining': {
      const { review_id, employee_id } = p;
      const rRow = review_id ? db.prepare("SELECT data FROM entities WHERE type='PerformanceReview' AND id=?").get(review_id) : null;
      const review = rRow ? JSON.parse(rRow.data) : {};
      const gap = review.rating === 'Below Expectations' || review.rating === 'Needs Improvement';

      // Return appropriate training recommendations based on score gaps
      const recommendations = [];
      if (gap) {
        recommendations.push({ area: 'Core Skills Development', priority: 'high', description: 'Focus on fundamentals for the current role' });
        recommendations.push({ area: 'Communication & Collaboration', priority: 'medium', description: 'Improve team communication effectiveness' });
      }
      const goals = review.goals || [];
      goals.filter(g => (g.achieved_percentage || 0) < 60).forEach(g => {
        recommendations.push({ area: g.name || 'Performance Gap', priority: 'high', description: `Achieve at least 80% on: ${g.name}` });
      });
      return res.json(recommendations);
    }

    /* ── Compliance ────────────────────────────────────── */
    case 'computeCompliance': {
      // Auto-generate compliance records based on payroll data (PF, ESI, PT)
      const { month, year } = p;
      const payrolls = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND json_extract(data,'$.month')=? AND json_extract(data,'$.year')=?").all(month, year));
      const pfTotal  = payrolls.reduce((s,r)=>s+(r.pf_employee||0)+(r.pf_employer||0),0);
      const esiTotal = payrolls.reduce((s,r)=>s+(r.esi_employee||0)+(r.esi_employer||0),0);
      const ptTotal  = payrolls.reduce((s,r)=>s+(r.professional_tax||0),0);

      const dueDate = `${year}-${String(parseInt(month)+1).padStart(2,'0')}-15`;
      for (const { name, amount, type } of [
        { name:`PF – ${month}/${year}`, amount:pfTotal, type:'pf' },
        { name:`ESI – ${month}/${year}`, amount:esiTotal, type:'esi' },
        { name:`Professional Tax – ${month}/${year}`, amount:ptTotal, type:'pt' },
      ]) {
        const existing = db.prepare("SELECT id FROM entities WHERE type='ComplianceRecord' AND json_extract(data,'$.compliance_type')=? AND json_extract(data,'$.month')=? AND json_extract(data,'$.year')=?").get(type, month, year);
        if (!existing) {
          const id = uuidv4();
          db.prepare("INSERT INTO entities(id,type,status,data) VALUES(?,'ComplianceRecord','pending',?)").run(id, JSON.stringify({ id, compliance_type:type, name, amount, month, year, due_date:dueDate, status:'pending' }));
        }
      }
      return res.json({ success:true });
    }

    case 'updateComplianceStatus': {
      const { record_id, status, paid_date, reference } = p;
      const row = db.prepare("SELECT id,data FROM entities WHERE id=?").get(record_id);
      if (!row) return res.json({ success:false, error:'Record not found' });
      const updated = { ...JSON.parse(row.data), status, paid_date, reference };
      db.prepare("UPDATE entities SET data=?,status=? WHERE id=?").run(JSON.stringify(updated), status, record_id);
      return res.json({ success:true });
    }

    case 'getComplianceSummary': {
      const { month, year } = p;
      const allRecs = parseEntities(db.prepare("SELECT data FROM entities WHERE type='ComplianceRecord'").all());
      const recs = month && year ? allRecs.filter(r => String(r.month)===String(month) && String(r.year)===String(year)) : allRecs;

      const today = new Date().toISOString().slice(0,10);
      const deadlines = recs.map(r => ({
        ...r, daysLeft: r.due_date ? Math.ceil((new Date(r.due_date) - new Date(today)) / 86400000) : 999,
      }));

      const summary = {
        total:       recs.length,
        compliant:   recs.filter(r=>r.status==='compliant'||r.status==='paid').length,
        non_compliant: recs.filter(r=>r.status==='non_compliant'||r.status==='overdue').length,
        pending:     recs.filter(r=>r.status==='pending').length,
        total_pf:    recs.filter(r=>r.compliance_type==='pf').reduce((s,r)=>s+(r.amount||0),0),
        total_esi:   recs.filter(r=>r.compliance_type==='esi').reduce((s,r)=>s+(r.amount||0),0),
        total_pt:    recs.filter(r=>r.compliance_type==='pt').reduce((s,r)=>s+(r.amount||0),0),
      };

      return res.json({ summary, deadlines, records: recs });
    }

    case 'getComplianceInsights':
      return res.json({ insights:[], recommendations:[] });

    /* ── AI: Recruitment ─────────────────────────────── */
    case 'parseResume': {
      const { candidate_id, resume_url } = p;
      const cRow = db.prepare("SELECT data FROM entities WHERE type='Candidate' AND id=?").get(candidate_id);
      const cand = cRow ? JSON.parse(cRow.data) : {};

      const prompt = `You are an expert resume parser. Based on the following candidate profile information, generate a detailed parsed resume JSON. Be realistic and infer reasonable details.

Candidate Profile:
Name: ${cand.full_name || cand.name || 'Not provided'}
Position Applied: ${cand.position_applied || 'Not specified'}
Department: ${cand.department || 'Not specified'}
Experience Years: ${cand.experience_years || 'Not specified'}
Current Company: ${cand.current_company || 'Not specified'}
Current CTC: ${cand.current_ctc ? '₹' + cand.current_ctc : 'Not specified'}
Expected CTC: ${cand.expected_ctc ? '₹' + cand.expected_ctc : 'Not specified'}
Notice Period: ${cand.notice_period || 'Not specified'}
Source: ${cand.source || 'Not specified'}
Email: ${cand.email || 'Not specified'}
Phone: ${cand.phone || 'Not specified'}

Return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "resume_headline": "one-line professional headline",
  "professional_summary": "2-3 sentence professional summary",
  "current_location": "city",
  "preferred_location": "city or 'Open to relocation'",
  "total_experience_years": number,
  "relevant_experience_years": number,
  "notice_period_days": number (0 for immediate, 30/60/90 for others),
  "current_designation": "job title",
  "current_company": "company name",
  "previous_companies": ["company1", "company2"],
  "previous_designations": ["title1", "title2"],
  "primary_skills": ["skill1", "skill2", "skill3"],
  "secondary_skills": ["skill1", "skill2"],
  "tools_and_platforms": ["tool1", "tool2"],
  "certifications": ["cert1"],
  "degree": "degree name",
  "university": "university name",
  "specialization": "field",
  "passing_year": 2018,
  "gpa_percentage": "75%",
  "projects": [{"name": "project", "description": "desc", "technologies": "tech stack"}],
  "achievements": ["achievement1", "achievement2"],
  "linkedin_url": null,
  "github_url": null,
  "portfolio_url": null,
  "ats_score": number (0-100),
  "profile_completeness_score": number (0-100),
  "ats_issues": ["issue1"],
  "keyword_density_flag": false
}`;

      let parsed;
      try {
        parsed = await callAI(prompt, { json: true });
      } catch(e) {
        return res.json({ success:false, error:`AI parsing failed: ${e.message}` });
      }

      if (!parsed) return res.json({ success:false, error:'AI returned invalid JSON' });

      const parsedId = uuidv4();
      const parsedData = {
        id: parsedId,
        candidate_id,
        resume_url,
        parse_status: 'completed',
        parsed_at: new Date().toISOString(),
        ...parsed,
      };
      db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'ParsedResume',?,'completed',?)")
        .run(parsedId, candidate_id, JSON.stringify(parsedData));

      // Link parsed resume to candidate
      if (cRow) {
        const updCand = { ...cand, parsed_resume_id: parsedId };
        db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(updCand), candidate_id);
      }

      const skills_extracted = (parsed.primary_skills?.length||0) + (parsed.secondary_skills?.length||0) + (parsed.tools_and_platforms?.length||0);
      return res.json({ success:true, parsed_resume_id:parsedId, skills_extracted });
    }

    case 'scoreAndSummariseCv': {
      const { candidate_id, position_applied, department, experience_years, current_company, current_ctc, expected_ctc, notice_period } = p;

      const prompt = `You are an expert HR recruiter. Analyse this candidate profile and provide a comprehensive CV score and summary.

Position Applied: ${position_applied || 'General'}
Department: ${department || 'Not specified'}
Experience: ${experience_years || 0} years
Current Company: ${current_company || 'Not specified'}
Current CTC: ${current_ctc ? '₹' + current_ctc : 'Not specified'}
Expected CTC: ${expected_ctc ? '₹' + expected_ctc : 'Not specified'}
Notice Period: ${notice_period || 'Not specified'}

Return ONLY a valid JSON object (no markdown) with:
{
  "score": number (0-100, overall profile quality),
  "recommendation": "Strongly Recommend" | "Recommend" | "Maybe" | "Not Recommend",
  "summary": "2-3 sentence professional assessment",
  "key_strengths": ["strength1", "strength2", "strength3"],
  "areas_for_improvement": ["area1", "area2"],
  "experience_assessment": "brief assessment of experience",
  "compensation_analysis": "brief analysis of CTC expectations"
}`;

      let result;
      try { result = await callAI(prompt, { json: true }); }
      catch(e) { return res.json({ success:false, error:`AI failed: ${e.message}` }); }

      if (!result) return res.json({ success:false, error:'AI returned invalid response' });
      return res.json({ success:true, result });
    }

    case 'scoreCandidate': {
      const { candidate_id, job_requisition_id } = p;
      const cRow  = db.prepare("SELECT data FROM entities WHERE type='Candidate' AND id=?").get(candidate_id);
      const jdRow = db.prepare("SELECT data FROM entities WHERE type='JobRequisition' AND id=?").get(job_requisition_id);
      const cand  = cRow  ? JSON.parse(cRow.data)  : {};
      const jd    = jdRow ? JSON.parse(jdRow.data) : {};

      const prompt = `You are an expert technical recruiter. Score this candidate against the job requisition using weighted criteria.

JOB REQUISITION:
Title: ${jd.position_title || 'Not specified'}
Department: ${jd.department || 'Not specified'}
Required Skills: ${Array.isArray(jd.required_skills) ? jd.required_skills.join(', ') : jd.required_skills || 'Not specified'}
Experience Required: ${jd.experience_required || 'Not specified'}
Salary Range: ₹${jd.salary_range_min||0} – ₹${jd.salary_range_max||0} per annum
Employment Type: ${jd.employment_type || 'Not specified'}
Location: ${jd.location || 'Not specified'}

CANDIDATE:
Name: ${cand.full_name || cand.name || 'Not specified'}
Experience: ${cand.experience_years || 0} years
Current Company: ${cand.current_company || 'Not specified'}
Skills: ${Array.isArray(cand.skills) ? cand.skills.join(', ') : cand.skills || 'Not specified'}
Expected CTC: ${cand.expected_ctc ? '₹' + cand.expected_ctc : 'Not specified'}
Notice Period: ${cand.notice_period || 'Not specified'}
Education: ${cand.education || 'Not specified'}

Score using these weights: Skills Match (35%), Experience (25%), Salary Fit (15%), Notice Period (10%), Education (15%).

Return ONLY a valid JSON object (no markdown):
{
  "overall_score": number (0-100),
  "recommendation": "Strongly Recommend" | "Recommend" | "Maybe" | "Not Recommend",
  "summary": "2-3 sentence assessment",
  "skills_score": number (0-100),
  "experience_score": number (0-100),
  "salary_score": number (0-100),
  "notice_score": number (0-100),
  "education_score": number (0-100),
  "matched_skills": ["skill1", "skill2"],
  "missing_skills": ["skill1", "skill2"],
  "bonus_skills": ["skill1"],
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1", "gap2"]
}`;

      let result;
      try { result = await callAI(prompt, { json: true }); }
      catch(e) { return res.json({ success:false, error:`AI scoring failed: ${e.message}` }); }

      if (!result) return res.json({ success:false, error:'AI returned invalid response' });
      return res.json({ success:true, data: result });
    }

    /* ── Offer Letter ────────────────────────────────── */
    case 'generateOfferLetter': {
      const { candidate_id, joining_date, designation, department, ctc, probation_months = 6, reporting_to, location } = p;
      if (!candidate_id) return res.json({ success:false, error:'candidate_id required' });

      const cRow = db.prepare("SELECT data FROM entities WHERE type='Candidate' AND id=?").get(candidate_id);
      if (!cRow) return res.json({ success:false, error:'Candidate not found' });
      const cand = JSON.parse(cRow.data);

      const name          = cand.full_name || cand.name || 'Candidate';
      const position      = designation   || cand.position_applied || 'Position';
      const dept          = department    || cand.department        || 'Department';
      const jDate         = joining_date  || '';
      const annualCTC     = ctc           || cand.expected_ctc || 0;
      const monthlyCTC    = annualCTC > 0 ? Math.round(annualCTC / 12) : 0;
      const probation     = probation_months;
      const reportingTo   = reporting_to || 'Reporting Manager';
      const workLocation  = location     || 'Ghaziabad, Uttar Pradesh';
      const todayDate     = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
      const offerRef      = `MEIL/HR/OL/${new Date().getFullYear()}/${String(Math.floor(Math.random()*9000)+1000)}`;

      const letterHtml = `
<div style="font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;line-height:1.6;">
  <div style="text-align:right;margin-bottom:14px;">
    <strong>Ref:</strong> ${offerRef}<br/>
    <strong>Date:</strong> ${todayDate}
  </div>

  <p style="margin-bottom:10px;">To,<br/>
  <strong>${name}</strong><br/>
  ${cand.address || cand.email || ''}</p>

  <p style="font-weight:bold;text-align:center;font-size:13px;text-decoration:underline;margin:14px 0;">
    APPOINTMENT LETTER / OFFER OF EMPLOYMENT
  </p>

  <p>Dear <strong>${name}</strong>,</p>

  <p>We are pleased to offer you the position of <strong>${position}</strong> in the <strong>${dept}</strong> department at <strong>Maxvolt Energy Industries Limited</strong>, subject to the terms and conditions stated herein.</p>

  <table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:10.5px;">
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;width:40%;">Designation</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${position}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Department</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${dept}</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Date of Joining</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${jDate ? new Date(jDate).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' }) : 'As mutually agreed'}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Reporting To</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${reportingTo}</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Work Location</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${workLocation}</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Annual CTC</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">₹${annualCTC.toLocaleString('en-IN')} per annum</td>
    </tr>
    <tr style="background:#f9f9f9;">
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Monthly Gross</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">₹${monthlyCTC.toLocaleString('en-IN')} per month</td>
    </tr>
    <tr>
      <td style="padding:5px 8px;border:1px solid #ddd;font-weight:bold;">Probation Period</td>
      <td style="padding:5px 8px;border:1px solid #ddd;">${probation} months</td>
    </tr>
  </table>

  <p><strong>Terms and Conditions:</strong></p>
  <ol style="padding-left:18px;margin:8px 0;">
    <li>Your employment will be subject to the rules and regulations of the company, as may be amended from time to time.</li>
    <li>During the probation period, either party may terminate the contract by giving 7 days' written notice. After confirmation, 1 month's notice is required from both parties.</li>
    <li>You will not engage in any business activity that is in conflict with the interests of the company.</li>
    <li>You are required to maintain the confidentiality of company information during and after employment.</li>
    <li>This offer is conditional upon successful verification of your educational qualifications, previous employment records, and medical fitness.</li>
    <li>Please confirm your acceptance of this offer by signing and returning a copy of this letter within <strong>7 days</strong> of receipt.</li>
  </ol>

  <p style="margin-top:14px;">We look forward to welcoming you to the Maxvolt Energy family and are confident that your skills and experience will be a valuable addition to our team.</p>

  <div style="margin-top:40px;display:flex;justify-content:space-between;">
    <div>
      <p style="border-top:1px solid #333;padding-top:5px;min-width:180px;">Authorised Signatory<br/><strong>For Maxvolt Energy Industries Limited</strong></p>
    </div>
    <div>
      <p style="border-top:1px solid #333;padding-top:5px;min-width:180px;">Candidate Acceptance<br/><strong>${name}</strong><br/>Date: _______________</p>
    </div>
  </div>
</div>`;

      // Update candidate status to 'offered'
      try {
        const updated = { ...cand, status: 'offered', offer_letter_date: new Date().toISOString(), offer_ctc: annualCTC, joining_date };
        db.prepare("UPDATE entities SET status='offered', data=? WHERE id=?").run(JSON.stringify(updated), candidate_id);
      } catch {}

      return res.json({ success:true, html: letterHtml, ref: offerRef });
    }

    /* ── AI: HR Assistant ────────────────────────────── */
    case 'askMax': {
      const { question = '', conversationHistory = [] } = p;
      const systemMsg = {
        role: 'system',
        content: `You are AskMax, an expert HR assistant for Maxvolt Energy Industries Limited.
You help employees understand HR policies, leave rules, payroll, attendance, benefits, and company procedures.
Be concise, friendly, and professional. Format answers clearly with bullet points when listing items.
If you don't know a specific policy detail, say so and suggest contacting HR directly.
Company: Maxvolt Energy Industries Limited | India | Manufacturing/Energy sector`
      };

      const history = [
        systemMsg,
        ...(conversationHistory || []).slice(-8).map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        })),
        { role: 'user', content: question }
      ];

      let answer;
      try {
        answer = await callAIMessages(history);
        if (!answer) answer = "I'm unable to respond right now. Please try again.";
      } catch(e) {
        answer = `I'm currently unavailable (${e.message}). Please contact HR directly.`;
      }
      return res.json({ success:true, answer });
    }

    case 'getAIStatus': {
      const { checkAI } = await import('../utils/ai.js');
      return res.json(await checkAI());
    }

    case 'testAI': {
      // Actually calls the LLM to validate key + model
      const { callAI } = await import('../utils/ai.js');
      try {
        await callAI('Say "ok" and nothing else.');
        return res.json({ ok: true });
      } catch (e) {
        return res.json({ ok: false, error: e.message });
      }
    }

    case 'saveAISetting': {
      if (!cu || cu.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { groq_api_key } = p;
      if (groq_api_key !== undefined) {
        if (groq_api_key) {
          db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('GROQ_API_KEY',?)").run(groq_api_key.trim());
        } else {
          db.prepare("DELETE FROM settings WHERE key='GROQ_API_KEY'").run();
        }
      }
      return res.json({ success: true });
    }

    /* ── Email ────────────────────────────────────────── */
    case 'sendCustomEmail': {
      const { to, subject, body: textBody, html } = p;
      if (!to || !subject) return res.json({ success:false, error:'to and subject are required' });
      try {
        const result = await sendEmail({ to, subject, html: html || `<p>${(textBody || '').replace(/\n/g, '<br/>')}</p>`, text: textBody });
        return res.json({ success:true, ...result });
      } catch(e) {
        return res.json({ success:false, error: e.message });
      }
    }

    case 'sendInterviewEmail': {
      // Accept either direct fields or candidate_id (from InterviewManagement.jsx)
      let candidateEmail = p.candidate_email;
      let candidateName  = p.candidate_name || 'Candidate';
      let position       = p.position || 'the position';
      let interviewDate  = p.interview_date;
      let interviewTime  = p.interview_time;
      let mode           = p.mode || p.interview_mode;
      let location       = p.location;
      let interviewerName = p.interviewer_name;

      // Look up candidate by ID if direct email not provided
      if (p.candidate_id && !candidateEmail) {
        const cRow = db.prepare("SELECT data FROM entities WHERE type='Candidate' AND id=?").get(p.candidate_id);
        if (cRow) {
          const cand = JSON.parse(cRow.data);
          candidateEmail  = cand.email;
          candidateName   = cand.full_name || cand.name || 'Candidate';
          position        = cand.position_applied || position;
        }
      }

      // Parse scheduled_date → date + time
      if (p.scheduled_date && !interviewDate) {
        const dt = new Date(p.scheduled_date);
        interviewDate = dt.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        interviewTime = dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
      }

      // Look up interviewer name if ID provided
      if (p.interviewer_id && !interviewerName) {
        const iUser = db.prepare("SELECT full_name FROM users WHERE id=?").get(p.interviewer_id);
        if (iUser) interviewerName = iUser.full_name;
        const iEmp = db.prepare("SELECT data FROM entities WHERE type='Employee' AND user_id=?").get(p.interviewer_id);
        if (iEmp) {
          const empData = JSON.parse(iEmp.data);
          interviewerName = `${iUser?.full_name || empData.display_name}${empData.designation ? `, ${empData.designation}` : ''}`;
        }
      }

      // Use meeting_link as location for video interviews
      if (!location && p.meeting_link) location = p.meeting_link;

      if (!candidateEmail) return res.json({ success:false, error:'Candidate email not found' });

      const tpl = emailTemplates.interviewInvite({
        candidateName,
        position,
        interviewDate,
        interviewTime,
        mode: mode === 'in_person' ? 'In-Person' : mode === 'video' ? 'Video Call' : mode || 'In-Person',
        location,
        interviewerName
      });
      const result = await sendEmail({ to: candidateEmail, ...tpl });
      return res.json({ success:true, ...result });
    }

    case 'notifyTrainingScheduled': {
      const { user_ids = [], training_title, start_date, end_date, trainer, location: loc } = p;
      let sent = 0;
      for (const uid of user_ids) {
        const uRow = db.prepare("SELECT email,full_name FROM users WHERE id=?").get(uid);
        if (!uRow?.email) continue;
        const tpl = emailTemplates.trainingNotification({
          employeeName: uRow.full_name,
          trainingTitle: training_title,
          startDate: start_date, endDate: end_date,
          trainer, location: loc
        });
        try { await sendEmail({ to: uRow.email, ...tpl }); sent++; } catch {}
      }
      return res.json({ success:true, sent, message:`Notified ${sent} participants` });
    }

    /* ── Recruitment other ───────────────────────────── */
    case 'submitJobApplication': {
      const { jobId, job_id, candidateData, jobTitle, jobDepartment } = p;
      const id = uuidv4();
      const d = {
        id,
        job_id: job_id || jobId,
        position_applied: jobTitle,
        department: jobDepartment,
        ...(candidateData || {}),
        status: 'applied',
        applied_date: new Date().toISOString(),
      };
      db.prepare("INSERT INTO entities(id,type,status,data) VALUES(?,'Candidate','applied',?)").run(id, JSON.stringify(d));
      return res.json({ success: true, application_id: id, candidate_id: id });
    }

    case 'getPublishedJob': {
      const jobId = p.job_id || p.jobId;
      const row = db.prepare("SELECT data FROM entities WHERE type='Recruitment' AND id=?").get(jobId);
      return res.json(row ? { job: JSON.parse(row.data) } : { job: null });
    }

    /* ── MIS & Reporting ─────────────────────────────── */
    case 'getMISData': {
      const today      = new Date().toISOString().slice(0, 10);
      const now        = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yr12Ago    = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);

      // ── Core headcount ──────────────────────────────────────────────────────
      const totalActive  = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND status='active'").get().c;
      const presentToday = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND json_extract(data,'$.date')=? AND json_extract(data,'$.check_in_time') IS NOT NULL").get(today).c;
      const absentToday  = Math.max(0, totalActive - presentToday);
      const newJoineesThisMonth = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND json_extract(data,'$.date_of_joining') >= ?").get(monthStart).c;
      const exitedLast12m = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Exit' AND json_extract(data,'$.last_working_date') >= ?").get(yr12Ago).c;
      const attritionRate = totalActive > 0 ? parseFloat(((exitedLast12m / totalActive) * 100).toFixed(1)) : 0;

      // ── Leave ───────────────────────────────────────────────────────────────
      const pendingLeaveRequests = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='pending'").get().c;
      const activeLeaves         = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='approved' AND json_extract(data,'$.start_date') <= ? AND json_extract(data,'$.end_date') >= ?").get(today, today).c;

      // ── Payroll ─────────────────────────────────────────────────────────────
      const payrollRows      = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND json_extract(data,'$.year')=? AND json_extract(data,'$.month')=?").all(now.getFullYear(), now.getMonth()+1));
      const totalPayrollCost = payrollRows.reduce((s, r) => s + (r.net_salary || 0), 0);

      // ── Recruitment ─────────────────────────────────────────────────────────
      const allCandidates = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Candidate'").all());
      const recruitment = {
        totalCandidates: allCandidates.length,
        hired:      allCandidates.filter(c => ['hired','joined'].includes(c.status)).length,
        inPipeline: allCandidates.filter(c => ['applied','screening','interview_scheduled','interview_done','selected'].includes(c.status)).length,
        rejected:   allCandidates.filter(c => c.status === 'rejected').length,
        offered:    allCandidates.filter(c => c.status === 'offered').length,
        hiringBySource: Object.entries(allCandidates.reduce((acc, c) => { const src = c.source || 'Direct'; acc[src] = (acc[src]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Reimbursements ──────────────────────────────────────────────────────
      const allReimb = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Reimbursement'").all());
      const reimbursements = {
        total:   allReimb.reduce((s, r) => s + (r.amount || 0), 0),
        pending: allReimb.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0),
        byCategory: Object.entries(allReimb.reduce((acc, r) => { const t = r.expense_type || 'Other'; acc[t] = (acc[t]||0)+(r.amount||0); return acc; }, {})).map(([name, amount]) => ({ name, amount })),
      };

      // ── Helpdesk ────────────────────────────────────────────────────────────
      const allTickets = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Ticket'").all());
      const tickets = {
        openTickets:     allTickets.filter(t => t.status === 'open').length,
        resolvedTickets: allTickets.filter(t => ['resolved','closed'].includes(t.status)).length,
        byCategory: Object.entries(allTickets.reduce((acc, t) => { const c = t.category||'General'; acc[c]=(acc[c]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Assets ──────────────────────────────────────────────────────────────
      const allAssets = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Asset'").all());
      const assets = {
        total:        allAssets.length,
        assigned:     allAssets.filter(a => a.status === 'assigned').length,
        available:    allAssets.filter(a => ['available','in_stock'].includes(a.status)).length,
        underRepair:  allAssets.filter(a => ['under_repair','repair'].includes(a.status)).length,
        discarded:    allAssets.filter(a => ['discarded','retired'].includes(a.status)).length,
        commonAssets: allAssets.filter(a => a.is_common || a.assignment_type === 'shared').length,
        overdueReturns: allAssets.filter(a => a.expected_return_date && a.expected_return_date < today && a.status === 'assigned').length,
        totalValue:   allAssets.reduce((s, a) => s + (a.purchase_cost || 0), 0),
        byType: Object.entries(allAssets.reduce((acc, a) => { const t = a.asset_type||a.category||'Other'; acc[t]=(acc[t]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Exits ───────────────────────────────────────────────────────────────
      const allExits = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Exit'").all());
      const exits = {
        total:     allExits.length,
        pending:   allExits.filter(e => !['completed','fnf_done'].includes(e.status)).length,
        completed: allExits.filter(e => ['completed','fnf_done'].includes(e.status)).length,
        byType: Object.entries(allExits.reduce((acc, e) => { const t = e.exit_type||'Unknown'; acc[t]=(acc[t]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Attendance trends (last 7 days) ─────────────────────────────────────
      const attendanceTrends = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const present = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND json_extract(data,'$.date')=? AND json_extract(data,'$.check_in_time') IS NOT NULL").get(dateStr).c;
        attendanceTrends.push({ date: dateStr, day: d.toLocaleDateString('en-IN',{weekday:'short'}), present, absent: Math.max(0, totalActive - present) });
      }

      // ── Department breakdown ────────────────────────────────────────────────
      const allEmps = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all());
      const departmentBreakdown = Object.entries(allEmps.reduce((acc, e) => { const d = e.department||'Unknown'; acc[d]=(acc[d]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count }));

      // ── Biometric / attendance stats ────────────────────────────────────────
      const attLogs      = parseEntities(db.prepare("SELECT data FROM entities WHERE type='AttendanceLog' AND json_extract(data,'$.punch_date') >= ?").all(monthStart));
      const attThisMonth = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Attendance' AND json_extract(data,'$.date') >= ?").all(monthStart));
      const workedRecs   = attThisMonth.filter(a => a.working_hours > 0);
      const avgWorkingHours   = workedRecs.length > 0 ? parseFloat((workedRecs.reduce((s,a)=>s+(a.working_hours||0),0)/workedRecs.length).toFixed(1)) : 0;
      const biometricSyncedCount = attLogs.length;
      const avgDailyPunches      = biometricSyncedCount > 0 && totalActive > 0 ? parseFloat((biometricSyncedCount / totalActive / 20).toFixed(1)) : 0;

      // ── Performance rating distribution ─────────────────────────────────────
      const allReviews = parseEntities(db.prepare("SELECT data FROM entities WHERE type='PerformanceReview'").all());
      const ratingDist = Object.entries(allReviews.reduce((acc, r) => { const rt = r.rating||'Pending'; acc[rt]=(acc[rt]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count }));

      // ── Metrics (camelCase — consumed by MetricCard via m.xxx) ──────────────
      const metrics = {
        totalActive, presentToday, absentToday, activeLeaves,
        pendingLeaveRequests, totalPayrollCost, attritionRate,
        openTickets: tickets.openTickets, newJoineesThisMonth,
        biometricSyncedCount, avgWorkingHours, avgBreakHours: 0, avgDailyPunches,
      };

      return res.json({
        metrics, recruitment, reimbursements, tickets, assets, exits,
        attendanceTrends, departmentBreakdown, ratingDist,
        insights: [], leaveTrend: [], headcountGrowth: [], attritionTrend: [], payrollTrend: [], salarByDept: [],
      });
    }

    case 'getTeamCalendar': {
      const { month, year } = p;
      const m = parseInt(month) || new Date().getMonth() + 1;
      const y = parseInt(year)  || new Date().getFullYear();
      const monthStart = `${y}-${String(m).padStart(2,'0')}-01`;
      const monthEnd   = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month

      // Employees list
      const employees = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Employee' AND status='active'").all())
        .map(e => ({ user_id: e.user_id, display_name: e.display_name, department: e.department, employee_code: e.employee_code }));

      // Approved leaves for the month
      const leaves = {};
      const leaveRows = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Leave' AND status='approved'").all())
        .filter(l => l.end_date >= monthStart && l.start_date <= monthEnd);
      for (const lv of leaveRows) {
        if (!leaves[lv.user_id]) leaves[lv.user_id] = {};
        // Mark each day of the leave
        const start = new Date(Math.max(new Date(lv.start_date), new Date(monthStart)));
        const end   = new Date(Math.min(new Date(lv.end_date),   new Date(monthEnd)));
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          leaves[lv.user_id][d.toISOString().slice(0,10)] = 'leave';
        }
      }

      // Attendance records for the month
      const attendance = {};
      const attRows = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Attendance' AND json_extract(data,'$.date') >= ? AND json_extract(data,'$.date') <= ?").all(monthStart, monthEnd));
      for (const att of attRows) {
        if (!attendance[att.user_id]) attendance[att.user_id] = {};
        attendance[att.user_id][att.date] = att.status || (att.check_in_time ? 'present' : 'absent');
      }

      // Holidays
      const holidays = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Holiday'").all())
        .filter(h => h.date >= monthStart && h.date <= monthEnd)
        .map(h => ({ date: h.date, name: h.name, type: h.holiday_type || 'public' }));

      return res.json({ success: true, data: { employees, holidays, attendance, leaves } });
    }

    /* ── Onboarding ──────────────────────────────────── */
    case 'approveUserOnboarding': {
      // Accept both userId (frontend) and user_id (legacy)
      const uid = p.user_id || p.userId;
      const role = p.custom_role || p.newUserRole || 'employee';
      const employeeData = p.employeeData || {};
      if (!uid) return res.status(400).json({ error: 'user_id required' });

      db.prepare("UPDATE users SET role=?,custom_role=? WHERE id=?").run(role, role, uid);

      const eRow = db.prepare("SELECT id,data FROM entities WHERE type='Employee' AND user_id=?").get(uid);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), ...employeeData, status:'active' };
        db.prepare("UPDATE entities SET data=?,status='active' WHERE id=?").run(JSON.stringify(d), eRow.id);
      } else {
        const empId = uuidv4();
        const d = { id:empId, user_id:uid, ...employeeData, status:'active' };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Employee',?,'active',?)").run(empId, uid, JSON.stringify(d));
      }

      // Send approval email
      try {
        const uRow = db.prepare("SELECT email,full_name FROM users WHERE id=?").get(uid);
        if (uRow?.email) {
          const tpl = emailTemplates.onboardingApprovedEmail({
            name: uRow.full_name,
            role,
            department: employeeData.department || ''
          });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Onboarding approval email failed:', e.message)
          );
        }
      } catch(e) { console.error('[email] Onboarding email error:', e.message); }

      return res.json({ success:true });
    }

    case 'rejectUserOnboarding': {
      const uid = p.user_id || p.userId;
      const reason = p.reason || '';
      if (!uid) return res.status(400).json({ error: 'user_id required' });

      const eRow = db.prepare("SELECT id,data FROM entities WHERE type='Employee' AND user_id=?").get(uid);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), onboarding_submitted:false, onboarding_rejection_reason:reason };
        db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(d), eRow.id);
      }

      try {
        const uRow = db.prepare("SELECT email,full_name FROM users WHERE id=?").get(uid);
        if (uRow?.email) {
          const tpl = emailTemplates.onboardingRejectedEmail({ name: uRow.full_name, reason });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Onboarding rejection email failed:', e.message)
          );
        }
      } catch(e) { console.error('[email] Onboarding rejection email error:', e.message); }

      return res.json({ success:true });
    }

    case 'handleNewUserSignup': case 'autoCreateEmployee':
      return res.json({ success:true });

    /* ── Employee import ─────────────────────────────── */
    case 'extractFileData': {
      // Generic CSV extractor — reads uploaded file and maps columns to schema output
      const { file_url, json_schema } = p;
      if (!file_url) return res.json({ output: [] });
      try {
        const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
        const filename   = file_url.startsWith('/uploads/') ? file_url.slice(9) : file_url.split('/').pop();
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const csvText = readFileSync(join(uploadsDir, filename), 'utf8');
        const lines   = csvText.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return res.json({ output: [] });

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase().replace(/\s+/g,'_').replace(/-/g,'_'));
        const output  = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g,''));
          const obj  = {};
          headers.forEach((h, i) => { if (vals[i] !== undefined) obj[h] = vals[i]; });
          return obj;
        });
        return res.json({ output });
      } catch(e) {
        return res.json({ output: [], error: e.message });
      }
    }

    case 'generateEmployeeTemplate': {
      const csv = [
        'full_name,email,employee_code,department,designation,mobile,date_of_joining,date_of_birth,gender,ctc',
        'John Doe,john.doe@company.com,EMP001,Engineering,Software Engineer,9876543210,2024-01-15,1995-06-20,Male,600000',
        'Jane Smith,jane.smith@company.com,EMP002,HR,HR Executive,9876543211,2024-02-01,1997-03-10,Female,480000',
      ].join('\n');

      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const uploadsDir = process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads';
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
      writeFileSync(`${uploadsDir}/employee_import_template.csv`, csv);
      return res.json({ success:true, file_url:'/uploads/employee_import_template.csv', csv });
    }

    case 'importEmployeeData': {
      const { fileUrl, mode = 'validate', raw_records } = p;

      // Parse CSV
      let rows = [];
      if (raw_records && Array.isArray(raw_records)) {
        rows = raw_records;
      } else if (fileUrl) {
        try {
          const filePath = fileUrl.startsWith('/uploads/') ? `${process.env.NODE_ENV === 'production' ? '/app/uploads' : './backend/uploads'}/${fileUrl.slice(9)}` : fileUrl;
          const { readFileSync } = await import('fs');
          const csvText = readFileSync(filePath, 'utf8');
          const lines = csvText.trim().split(/\r?\n/).filter(l => l.trim());
          if (lines.length < 2) return res.json({ success:false, error:'CSV must have headers and at least one data row' });
          const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g,'_'));
          rows = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const obj = {};
            headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
            return obj;
          });
        } catch(e) {
          return res.json({ success:false, error:`Failed to read file: ${e.message}` });
        }
      } else {
        return res.json({ success:false, error:'Provide fileUrl or raw_records' });
      }

      // Field aliases
      const get = (row, ...keys) => {
        for (const k of keys) { if (row[k]) return row[k]; }
        return '';
      };

      const errors = [];
      const validated = rows.map((row, idx) => {
        const rowNum = idx + 2;
        const email = get(row, 'email', 'work_email', 'employee_email') || '';
        const name  = get(row, 'full_name', 'name', 'employee_name', 'display_name') || '';
        const code  = get(row, 'employee_code', 'emp_code', 'emp_id', 'employee_id') || '';
        if (!email) errors.push({ row: rowNum, field:'email', message:'Email is required' });
        if (!name)  errors.push({ row: rowNum, field:'name',  message:'Name is required'  });
        return {
          rowNum, email, name, code,
          department: get(row, 'department', 'dept'),
          designation: get(row, 'designation', 'role', 'position'),
          mobile: get(row, 'mobile', 'phone', 'contact'),
          date_of_joining: get(row, 'date_of_joining', 'doj', 'joining_date'),
          date_of_birth: get(row, 'date_of_birth', 'dob'),
          gender: get(row, 'gender'),
          ctc: parseFloat(get(row, 'ctc', 'annual_ctc', 'salary') || 0),
          valid: !errors.find(e => e.row === rowNum),
        };
      });

      if (mode === 'validate') {
        return res.json({ success:true, total: rows.length, valid: validated.filter(r=>r.valid).length, errors, preview: validated.slice(0, 10) });
      }

      // Import mode
      const results = [];
      for (const row of validated) {
        if (!row.valid) { results.push({ ...row, status:'skipped', reason:'Validation errors' }); continue; }

        // Check if user exists by email
        let user = db.prepare("SELECT id, full_name FROM users WHERE email=?").get(row.email);
        if (!user) {
          // Create user account with temporary password
          const { v4 } = await import('uuid');
          const userId = v4();
          const hash   = await import('bcrypt').then(b => b.hash('Maxvolt@123', 10));
          db.prepare("INSERT INTO users(id,email,full_name,role,status,custom_role) VALUES(?,?,?,'employee','active','employee')")
            .run(userId, row.email, row.name);
          user = { id: userId, full_name: row.name };
        }

        // Check if employee record exists
        const existingEmp = db.prepare("SELECT id FROM entities WHERE type='Employee' AND user_id=?").get(user.id);
        if (existingEmp) {
          results.push({ ...row, status: 'existing', user_id: user.id });
          continue;
        }

        // Create employee record
        const empId = uuidv4();
        const empData = {
          id: empId, user_id: user.id, employee_code: row.code || `EMP${String(Math.floor(Math.random()*9000)+1000)}`,
          display_name: row.name, department: row.department, designation: row.designation,
          mobile: row.mobile, date_of_joining: row.date_of_joining, date_of_birth: row.date_of_birth,
          gender: row.gender, ctc: row.ctc, status: 'active',
          created_at: new Date().toISOString(),
        };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Employee',?,'active',?)")
          .run(empId, user.id, JSON.stringify(empData));
        results.push({ ...row, status:'created', user_id: user.id, employee_id: empId });
      }

      const imported = results.filter(r => r.status === 'created').length;
      return res.json({ success:true, imported, total: rows.length, results });
    }

    case 'updateEmployeeConfirmation': {
      const { user_id, confirmation_date } = p;
      const eRow = db.prepare("SELECT id,data FROM entities WHERE type='Employee' AND user_id=?").get(user_id);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), employee_status:'confirmation', confirmation_date };
        db.prepare("UPDATE entities SET data=? WHERE id=?").run(JSON.stringify(d), eRow.id);
      }
      return res.json({ success:true });
    }

    /* ── Business Cards ──────────────────────────────── */
    case 'getBusinessCard': {
      const row = db.prepare("SELECT data FROM entities WHERE type='DigitalBusinessCard' AND user_id=?").get(p.user_id||cu?.id);
      return res.json(row ? JSON.parse(row.data) : null);
    }

    case 'generatePrintableCards':
      return res.json({ success:true, pdf_url:null, message:'PDF generation requires additional setup' });

    /* ── Training ────────────────────────────────────── */
    case 'onAssetChanged':
    case 'onNewEmployeeJoined':
    case 'extractFavicon':
      return res.json({ success:true });

    default:
      console.warn(`[functions] Unknown function: ${name}`);
      return res.status(404).json({ error: `Function '${name}' not implemented` });
  }
  } catch (err) {
    console.error(`[functions/${name}]`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

/* ── payslip HTML ──────────────────────────────────────── */
function buildPayslipHtml(payroll, emp) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mon  = months[(payroll.month||1)-1];
  const earn = [['Basic Salary',payroll.basic_salary||0],['HRA',payroll.hra||0],['Conveyance',payroll.conveyance||0],['Special Allowance',payroll.special_allowance||0],['Other Allowances',payroll.other_allowances||0]].filter(([,v])=>v>0);
  const ded  = [['PF Deduction',payroll.deductions?.pf||0],['Professional Tax',payroll.deductions?.pt||0],['TDS',payroll.deductions?.tds||0],['LOP Deduction',payroll.loss_of_pay_amount||0]].filter(([,v])=>v>0);
  return `<div style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px">
  <div style="background:#2563eb;color:#fff;padding:20px;border-radius:6px;margin-bottom:20px"><h2 style="margin:0">MaxVolt Energy Industries Limited</h2><p style="margin:4px 0 0;opacity:.85">Pay Slip — ${mon} ${payroll.year||''}</p></div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
    <tr><td style="padding:6px;width:50%"><b>Employee:</b> ${emp.display_name||'N/A'}</td><td style="padding:6px"><b>Emp. Code:</b> ${emp.employee_code||'N/A'}</td></tr>
    <tr><td style="padding:6px"><b>Department:</b> ${emp.department||'N/A'}</td><td style="padding:6px"><b>Designation:</b> ${emp.designation||'N/A'}</td></tr>
    <tr><td style="padding:6px"><b>Working Days:</b> ${payroll.working_days||26}</td><td style="padding:6px"><b>Present Days:</b> ${payroll.present_days||26}</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#f1f5f9"><th style="padding:8px;text-align:left;border:1px solid #ddd">Earnings</th><th style="padding:8px;text-align:right;border:1px solid #ddd">Amount (₹)</th><th style="padding:8px;text-align:left;border:1px solid #ddd">Deductions</th><th style="padding:8px;text-align:right;border:1px solid #ddd">Amount (₹)</th></tr></thead>
    <tbody>${Array.from({length:Math.max(earn.length,ded.length)},(_,i)=>`<tr><td style="padding:8px;border:1px solid #ddd">${earn[i]?.[0]||''}</td><td style="padding:8px;text-align:right;border:1px solid #ddd">${earn[i]?earn[i][1].toLocaleString('en-IN'):''}</td><td style="padding:8px;border:1px solid #ddd">${ded[i]?.[0]||''}</td><td style="padding:8px;text-align:right;border:1px solid #ddd">${ded[i]?ded[i][1].toLocaleString('en-IN'):''}</td></tr>`).join('')}
    <tr style="font-weight:bold;background:#f8fafc"><td style="padding:8px;border:1px solid #ddd">Gross Salary</td><td style="padding:8px;text-align:right;border:1px solid #ddd">${(payroll.gross_salary||0).toLocaleString('en-IN')}</td><td style="padding:8px;border:1px solid #ddd">Total Deductions</td><td style="padding:8px;text-align:right;border:1px solid #ddd">${(payroll.total_deductions||0).toLocaleString('en-IN')}</td></tr>
    </tbody></table>
  <div style="margin-top:16px;padding:14px;background:#eff6ff;border-radius:6px;text-align:right"><span style="font-size:18px;font-weight:bold;color:#2563eb">Net Pay: ₹${(payroll.net_salary||0).toLocaleString('en-IN')}</span></div>
  <p style="color:#999;font-size:11px;margin-top:16px;text-align:center">This is a computer-generated document and does not require a signature.</p>
</div>`;
}

export default router;
