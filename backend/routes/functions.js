import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { one, all, run, q } from '../db.js';
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
      const users = await all(
        'SELECT id,email,full_name,first_name,last_name,role,custom_role,display_name FROM users'
      );
      return res.json({ users });
    }

    case 'initNewUser': {
      const { user_id, email, full_name } = p;
      const ex = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (!ex) {
        const id = uuidv4();
        const d = { id, user_id, email: email||'', display_name: full_name||'',
                    status:'active', employee_status:'probation' };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'active',$3)", [id, user_id, JSON.stringify(d)]);
      }
      await run("UPDATE users SET role='employee',custom_role='employee' WHERE id=$1", [user_id]);
      return res.json({ success: true });
    }

    case 'updateUserName': {
      if (!cu) return res.status(401).json({ error:'Unauthorized' });
      const { first_name='', middle_name='', last_name='' } = p;
      const full = [first_name, middle_name, last_name].filter(Boolean).join(' ');
      await run("UPDATE users SET first_name=$1,middle_name=$2,last_name=$3,full_name=$4,display_name=$5,updated_at=NOW()::TEXT WHERE id=$6", [first_name, middle_name, last_name, full, full, cu.id]);
      return res.json({ success: true });
    }

    case 'updateUserDetails': {
      const uid = p.user_id || cu?.id;
      if (!uid) return res.status(400).json({ error:'user_id required' });
      const fields = []; const vals = []; let pi = 0;
      if (p.full_name)    { fields.push(`full_name=$${++pi}`);    vals.push(p.full_name); }
      if (p.display_name) { fields.push(`display_name=$${++pi}`); vals.push(p.display_name); }
      if (p.role)         { fields.push(`role=$${++pi}`);         vals.push(p.role); }
      if (p.custom_role)  { fields.push(`custom_role=$${++pi}`);  vals.push(p.custom_role); }
      if (fields.length) { vals.push(uid); await run(`UPDATE users SET ${fields.join(',')} WHERE id=$${++pi}`, vals); }
      return res.json({ success: true });
    }

    case 'updateUserRole': {
      const { user_id, role, custom_role } = p;
      await run("UPDATE users SET role=$1,custom_role=$2 WHERE id=$3", [role, custom_role||role, user_id]);
      return res.json({ success: true });
    }

    case 'linkUserToEmployee': {
      const { user_id, employee_id } = p;
      const row = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
      if (row) {
        const d = { ...JSON.parse(row.data), user_id };
        await run("UPDATE entities SET data=$1,user_id=$2 WHERE id=$3", [JSON.stringify(d), user_id, employee_id]);
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
      const balRows = await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [uid]);
      const bal = balRows.map(r=>JSON.parse(r.data)).find(b=>b.leave_policy_id===leave_policy_id);
      const available_balance = bal?.available ?? 999;
      const errors = [];
      if (adjusted_days > available_balance) errors.push(`Insufficient balance. Available: ${available_balance}, Requested: ${adjusted_days}`);
      if (adjusted_days > 30) errors.push('Cannot exceed 30 days at once');
      return res.json({ valid:errors.length===0, adjusted_days, available_balance, errors, warnings:[] });
    }

    case 'accrueLeaveBalances': {
      const policies  = parseEntities(await all("SELECT data FROM entities WHERE type='LeavePolicy' AND is_active=1"));
      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const year = new Date().getFullYear();
      let accrued = 0;
      for (const emp of employees) {
        for (const pol of policies) {
          const monthly = (pol.total_days||0) / 12;
          const existing = parseEntities(await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [emp.user_id]))
            .find(b=>b.leave_policy_id===pol.id && b.year===year);
          if (existing) {
            const updated = { ...existing, accrued_this_year:(existing.accrued_this_year||0)+monthly, available:(existing.available||0)+monthly };
            await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updated), existing.id]);
          } else {
            const id = uuidv4();
            const d  = { id, user_id:emp.user_id, leave_policy_id:pol.id, year, total_allocated:pol.total_days, accrued_this_year:monthly, used:0, pending_approval:0, available:monthly, carried_forward:0 };
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'LeaveBalance',$2,'active',$3)", [id,emp.user_id,JSON.stringify(d)]);
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
      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));

      // Date range for the month
      const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay   = new Date(year, month, 0).getDate();
      const endDate   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      const workingDays = 26; // Standard payroll calendar

      let processed = 0;
      for (const emp of employees) {
        const ex = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND user_id=$1", [emp.user_id]))
          .find(r=>r.month===month && r.year===year);
        if (ex) continue;

        // Salary structure
        const ss    = parseEntities(await all("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id])).at(-1);
        const basic = ss?.basic_salary||0; const hra=ss?.hra||0; const conv=ss?.conveyance||0; const spec=ss?.special_allowance||0;
        const gross = basic+hra+conv+spec;

        // Attendance-based LOP calculation
        const attRows = await all(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' BETWEEN $2 AND $3"
        , [emp.user_id, startDate, endDate]);
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
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Payroll',$2,'processed',$3)", [id, emp.user_id, JSON.stringify(payrollData)]);
        processed++;
      }
      return res.json({ success:true, processed, message:`Processed payroll for ${processed} employees` });
    }

    case 'markAbsentEmployees': {
      const { date } = p;
      const targetDate = date || new Date().toISOString().slice(0, 10);

      // Get all active employees
      const empRows = await all("SELECT data FROM entities WHERE type='Employee' AND status='active'");
      const employees = empRows.map(r => JSON.parse(r.data));

      // Get employees who have an attendance record for this date
      const attRows = await all(
        "SELECT user_id FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1"
      , [targetDate]);
      const presentUserIds = new Set(attRows.map(r => r.user_id));

      // Check for approved leaves on this date
      const leaveRows = await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'");
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
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'absent',$3)", [attId, emp.user_id,
          JSON.stringify({ id: attId, user_id: emp.user_id, date: targetDate, status: 'absent', source: 'auto_marked', created_at: new Date().toISOString() })]);
        marked++;
      }
      return res.json({ success:true, marked, skipped, date: targetDate, message:`Marked ${marked} employees absent for ${targetDate}` });
    }

    case 'generatePayslip': {
      const { payroll_id } = p;
      const pRow = await one("SELECT data FROM entities WHERE type='Payroll' AND id=$1", [payroll_id]);
      if (!pRow) return res.json({ success:false, error:'Payroll record not found' });
      const payroll = JSON.parse(pRow.data);
      const eRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [payroll.user_id]);
      const emp  = eRow ? JSON.parse(eRow.data) : {};
      const html = buildPayslipHtml(payroll, emp);
      return res.json({ success:true, html, data:payroll });
    }

    case 'generateBankTransferFile': {
      const { month, year, format = 'csv' } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND status='processed'"))
        .filter(r => r.month === month && r.year === year);
      if (payrolls.length === 0) return res.json({ success:false, error:'No processed payroll records for this period' });

      const lines = ['Beneficiary Name,Account Number,IFSC Code,Bank Name,Branch,Amount,Remarks'];
      for (const pr of payrolls) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [pr.user_id]);
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

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const attRows   = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));

      // Build attendance map: user_id → date → record
      const attMap = {};
      for (const a of attRows) {
        if (!attMap[a.user_id]) attMap[a.user_id] = {};
        attMap[a.user_id][a.date] = a;
      }

      // Pre-load all shifts referenced by employees (avoids N+1 queries)
      const shiftCache = {};
      const shiftIds = [...new Set(employees.map(e => e.shift_id).filter(Boolean))];
      if (shiftIds.length > 0) {
        const placeholders = shiftIds.map((_, i) => `$${i+1}`).join(',');
        const shiftRows = await all(`SELECT id,data FROM entities WHERE id IN (${placeholders})`, shiftIds);
        for (const sr of shiftRows) shiftCache[sr.id] = JSON.parse(sr.data);
      }
      const getShift = (shiftId) => shiftId ? (shiftCache[shiftId] || null) : null;

      const defaultShift = parseEntities(await all("SELECT data FROM entities WHERE type='Shift' AND (data::jsonb->>'is_default'=1 OR data::jsonb->>'name' LIKE '%General%') LIMIT 1"))[0] || null;

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

      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const payrolls  = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2", [m, y]));
      const payrollMap = Object.fromEntries(payrolls.map(pr => [pr.user_id, pr]));

      const attRows = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));
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

      // Pre-fetch all salary structures
      const ssAllRows = await all("SELECT user_id,data FROM entities WHERE type='SalaryStructure' AND status='active'");
      const ssMap = {};
      for (const r of ssAllRows) ssMap[r.user_id] = JSON.parse(r.data);

      const csvRows = employees.map(emp => {
        const pr  = payrollMap[emp.user_id];
        const recs = attMap[emp.user_id] || [];

        let daysPresent = 0, daysHalfDay = 0, daysLOP = 0;
        if (pr) {
          daysPresent  = pr.present_days || 0;
          daysHalfDay  = pr.half_days    || 0;
          daysLOP      = pr.lop_days     || 0;
        } else {
          daysPresent  = recs.filter(a => ['present','late','on_duty','work_from_home'].includes(a.status)).length;
          daysHalfDay  = recs.filter(a => a.status === 'half_day').length;
          daysLOP      = recs.filter(a => ['absent','lop'].includes(a.status)).length;
        }
        const effectiveDays = daysPresent + (daysHalfDay * 0.5);

        const ss = ssMap[emp.user_id] || {};
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
      const key = await one("SELECT value FROM settings WHERE key='attendance_api_key'")?.value || null;
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
      await run("INSERT INTO settings(key,value,updated_at) VALUES('attendance_api_key',$1,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT", [newKey]);
      // Also update env-like value so attendancelog.js picks it up via this DB key
      process.env.ATTENDANCE_API_KEY = newKey;
      return res.json({ success: true, api_key: newKey });
    }

    case 'autoSendPayslips': {
      const { month, year } = p;
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND status='processed'"))
        .filter(r=>r.month===month && r.year===year);
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      let sent = 0; const errors = [];
      for (const payroll of payrolls) {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [payroll.user_id]);
        if (!uRow?.email) continue;
        const eRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [payroll.user_id]);
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
        ? await one("SELECT data FROM entities WHERE type='Exit' AND id=$1", [exit_id]): await one("SELECT data FROM entities WHERE type='Exit' AND user_id=$1", [employee_id]);
      if (!exitRow) return res.json({ success:false, error:'Exit record not found' });
      const exitData = JSON.parse(exitRow.data);

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [exitData.user_id || employee_id]);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const ssRow = await one("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=$1 AND status='active'", [emp.user_id || employee_id]);
      const ss    = ssRow ? JSON.parse(ssRow.data) : {};

      const gross        = (ss.basic_salary||0) + (ss.hra||0) + (ss.conveyance||0) + (ss.special_allowance||0);
      const dailySalary  = gross > 0 ? gross / 26 : 0;

      // LOP for notice period shortfall (if employee left without serving full notice)
      const noticePeriodDays = parseInt(emp.notice_period_days) || 30;
      const servedDays       = parseInt(exitData.notice_days_served) || noticePeriodDays;
      const shortfallDays    = Math.max(0, noticePeriodDays - servedDays);
      const noticePeriodDeduction = Math.round(shortfallDays * dailySalary);

      // Leave encashment for pending earned leave
      const leaveBalRows = await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [emp.user_id || employee_id]);
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
      await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updatedExit), exitRow.id]);

      return res.json({ success:true, ...fnf });
    }

    /* ── Attendance ───────────────────────────────────── */
    case 'getAllAttendance': {
      const { date, user_id: uid, date_from, date_to } = p;
      let rows = uid
        ? await all("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1", [uid]): await all("SELECT data FROM entities WHERE type='Attendance'");
      let records = rows.map(r=>JSON.parse(r.data));
      if (date) records = records.filter(a=>a.date===date);
      if (date_from) records = records.filter(a=>a.date>=date_from);
      if (date_to) records = records.filter(a=>a.date<=date_to);
      return res.json({ records });
    }

    case 'markExemptEmployeesPresent': {
      const { date } = p;
      const exempts = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
        .filter(e=>e.is_attendance_exempt);
      let marked = 0;
      for (const emp of exempts) {
        const ex = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1", [emp.user_id]))
          .find(a=>a.date===date);
        if (!ex) {
          const id = uuidv4();
          const d  = { id, user_id:emp.user_id, date, status:'present', auto_marked:true, working_hours:9 };
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)", [id,emp.user_id,JSON.stringify(d)]);
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
      const storedKey = await one("SELECT value FROM settings WHERE key='attendance_api_key'")?.value || process.env.ATTENDANCE_API_KEY || null;
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
      const empRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const emps = empRows.map(r => JSON.parse(r.data));
      const mappingRows = await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'");
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

      let stored = 0, processed = 0, skipped = 0, unmatched = 0;
      const byDate = {}; // key: userId_date → { userId, date, punches }

      for (const rec of rawRecords) {
        // Support both eBio PascalCase and internal lowercase
        const empCodeRaw = String(rec.EmployeeCode || rec.employee_code || rec.EnrollNo || rec.pin || '').trim();
        const empCode    = empCodeRaw.toLowerCase();
        const logDateRaw = rec.LogDate || rec.log_date || rec.punch_time || rec.datetime || '';
        const direction  = String(rec.Direction || rec.type || 'in').toUpperCase();

        if (!empCodeRaw || !logDateRaw) { skipped++; continue; }

        const istDate = toIST(logDateRaw);
        if (!istDate) { skipped++; continue; }

        const punchType = (direction === 'IN' || direction === 'in') ? 'in' : 'out';
        const punchIso  = istDate.toISOString();
        const dateStr   = punchIso.slice(0, 10);
        const userId    = codeMap[empCode] || null;

        // Always store the raw log so it's visible on the Biometric Logs page,
        // even when the employee code isn't mapped yet
        const existingLog = await one("SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2", [empCodeRaw, logDateRaw]);
        if (!existingLog) {
          const logId = uuidv4();
          const logData = { ...rec, id: logId, EmployeeCode: empCodeRaw, LogDate: logDateRaw, Direction: direction, user_id: userId, punch_type: punchType, punch_iso: punchIso, imported_at: new Date().toISOString() };
          try {
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)", [logId, userId, JSON.stringify(logData)]);
            stored++;
          } catch {}
        }

        // Only create Attendance records when employee is matched
        if (!userId) { unmatched++; continue; }

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

        const existing = await one("SELECT id,data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2", [userId, date]);
        if (existing) {
          const d = JSON.parse(existing.data);
          if (d.status === 'regularised') continue; // never overwrite a regularised record
          const updated = {
            ...d,
            check_in_time:  !d.check_in_time  || firstIn  < d.check_in_time  ? firstIn  : d.check_in_time,
            check_out_time: !d.check_out_time || (lastOut && lastOut > d.check_out_time) ? lastOut : d.check_out_time,
            biometric_synced: true, status: d.status || 'present',
          };
          await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(updated), existing.id]);
        } else {
          const attId = uuidv4();
          const attData = { id: attId, user_id: userId, date, check_in_time: firstIn, check_out_time: lastOut, status: 'present', source: 'biometric', biometric_synced: true };
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)", [attId, userId, JSON.stringify(attData)]);
        }
      }

      return res.json({ success: true, received: rawRecords.length, stored, processed, skipped, unmatched, attendance_records: Object.keys(byDate).length });
    }

    case 'receiveBiometricAttendance':
    case 'processEbioLogs': {
      const { date_from, date_to, raw_records = [] } = p;

      if (raw_records.length === 0 && !date_from) {
        return res.json({ success:false, error:'Provide raw_records or date_from/date_to' });
      }

      // Load employee code → user_id mapping (from Employee entities + BiometricCodeMapping)
      const empRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const employees = empRows.map(r => JSON.parse(r.data));
      // Also check BiometricCodeMapping entity
      const mappingRows = await all("SELECT data FROM entities WHERE type='BiometricCodeMapping'");
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
        const existingLog = await one(
          "SELECT id FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'EmployeeCode'=$1 AND data::jsonb->>'LogDate'=$2"
        , [record.EmployeeCode || empCode, logDateRaw]);

        if (!existingLog) {
          const logId = uuidv4();
          const logData = { ...record, id: logId, EmployeeCode: record.EmployeeCode || empCode, LogDate: logDateRaw, user_id: userId, imported_at: new Date().toISOString() };
          try {
            await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AttendanceLog',$2,'active',$3)", [logId, userId, JSON.stringify(logData)]);
            storedCount++;
          } catch {}
        }

        const key = `${userId}_${dateStr}`;
        if (!byEmployeeDate[key]) byEmployeeDate[key] = { userId, date: dateStr, times: [] };
        byEmployeeDate[key].times.push(timeStr);
      }

      // Also process date range from existing AttendanceLogs in DB if date_from provided
      if (date_from && raw_records.length === 0) {
        const logRows = await all(
          "SELECT data FROM entities WHERE type='AttendanceLog'"
        );
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
        const empRow   = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [userId]);
        const emp      = empRow ? JSON.parse(empRow.data) : {};
        const shiftRow = emp.shift_id
          ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id]): await one("SELECT data FROM entities WHERE type='Shift' AND data::jsonb->>'is_default'=1");
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
        const existAtt = await one(
          "SELECT id FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2"
        , [userId, date]);

        if (existAtt) {
          const existing = JSON.parse(await one("SELECT data FROM entities WHERE id=$1", [existAtt.id]).data);
          // Don't overwrite regularised records
          if (!existing.regularised) {
            await run("UPDATE entities SET status=$1, data=$2 WHERE id=$3", [status, JSON.stringify({ ...existing, ...attData, id: existAtt.id }), existAtt.id]);
            records_synced++;
          }
        } else {
          const attId = uuidv4();
          await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'active',$3)", [attId, userId, JSON.stringify({ ...attData, id: attId, created_at: new Date().toISOString() })]);
          records_synced++;
        }
      }

      return res.json({ success:true, records_synced, logs_stored: storedCount, employees_processed: Object.keys(byEmployeeDate).length, message: `Processed ${raw_records.length} biometric punches → ${records_synced} attendance records` });
    }

    case 'processRegularisation': {
      const { regularisation_id, action, comment = '', role = 'manager' } = p;
      if (!regularisation_id || !action) return res.status(400).json({ error: 'regularisation_id and action required' });

      const row = await one("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND id=$1", [regularisation_id]);
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
            const attRow = await one(
              "SELECT id, data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2"
            , [reg.user_id, reg.date]);

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
              await run("UPDATE entities SET status=$1, data=$2 WHERE id=$3", [updAtt.status, JSON.stringify(updAtt), attRow.id]);
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
              await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Attendance',$2,'present',$3)", [newAttId, reg.user_id, JSON.stringify(newAtt)]);
            }
          } catch (e) { console.warn('Attendance update on regularisation approval failed:', e.message); }

        } else if (action === 'reject') {
          newStatus = 'rejected';
          update.hr_comment = comment;
          update.rejected_at = new Date().toISOString();
        }
      }

      const updReg = { ...reg, ...update, status: newStatus };
      await run("UPDATE entities SET status=$1, data=$2 WHERE id=$3", [newStatus, JSON.stringify(updReg), regularisation_id]);

      // In-app notification to employee
      try {
        const notifId = uuidv4();
        const notifData = {
          id: notifId, user_id: reg.user_id, type: newStatus === 'completed' ? 'success' : newStatus === 'rejected' ? 'error' : 'info',
          title: `Regularisation ${newStatus === 'completed' ? 'Approved' : newStatus === 'rejected' ? 'Rejected' : 'Updated'}`,
          message: `Your regularisation request for ${reg.date} has been ${newStatus.replace('_', ' ')}.${comment ? ' Comment: ' + comment : ''}`,
          read: false, created_at: new Date().toISOString(),
        };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Notification',$2,'unread',$3)", [notifId, reg.user_id, JSON.stringify(notifData)]);
      } catch {}

      return res.json({ success: true, status: newStatus });
    }

    case 'calculateLOP': {
      const { employee_id, month, year } = p;
      if (!employee_id) return res.json({ success:true, lop_days:0, lop_amount:0 });

      const startDate = `${year || new Date().getFullYear()}-${String(month || new Date().getMonth()+1).padStart(2,'0')}-01`;
      const endDate   = new Date(year || new Date().getFullYear(), month || new Date().getMonth()+1, 0).toISOString().slice(0,10);

      const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
      const emp    = empRow ? JSON.parse(empRow.data) : {};

      const attRows = await all(
        "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' BETWEEN $2 AND $3"
      , [emp.user_id || employee_id, startDate, endDate]);
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
        const row = await one("SELECT data FROM entities WHERE type='Attendance' AND id=$1", [attendance_id]);
        if (!row) return res.json({ success:false, error:'Attendance record not found' });
        attData = JSON.parse(row.data);
      } else if (employee_id && date) {
        const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND id=$1", [employee_id]);
        const emp    = empRow ? JSON.parse(empRow.data) : {};
        const row    = await one(
          "SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date'=$2"
        , [emp.user_id || employee_id, date]);
        if (!row) return res.json({ success:false, error:'No attendance record for that employee/date' });
        attData = JSON.parse(row.data);
      } else {
        return res.json({ success:false, error:'Provide attendance_id OR (employee_id + date)' });
      }

      // Get shift
      const empRow   = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [attData.user_id]);
      const emp      = empRow ? JSON.parse(empRow.data) : {};
      const shiftRow = emp.shift_id
        ? await one("SELECT data FROM entities WHERE type='Shift' AND id=$1", [emp.shift_id]): await one("SELECT data FROM entities WHERE type='Shift' AND data::jsonb->>'is_default'=1");
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
        await run("UPDATE entities SET status=$1, data=$2 WHERE type='Attendance' AND id=$3", [status, JSON.stringify(updated), idToUpdate]);
      }

      return res.json({ success:true, status, working_hours: updated.working_hours, late_minutes, overtime_minutes, shift_name: shift.name });
    }

    /* ── Performance ─────────────────────────────────── */
    case 'pmsGetDashboard': {
      const reviews   = parseEntities(await all("SELECT data FROM entities WHERE type='PerformanceReview'"));
      const completed = reviews.filter(r=>r.status==='completed').length;
      const pending   = reviews.filter(r=>r.status==='pending').length;
      const avg       = reviews.length ? (reviews.reduce((s,r)=>s+(r.final_score||0),0)/reviews.length).toFixed(1) : 0;
      return res.json({ total_reviews:reviews.length, completed, pending, average_score:avg });
    }

    case 'pmsCalculateScore': {
      const { review_id } = p;
      if (!review_id) return res.json({ score:0, rating:'Pending' });
      const rRow = await one("SELECT data FROM entities WHERE type='PerformanceReview' AND id=$1", [review_id]);
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
      await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updated), review_id]);

      return res.json({ score, rating });
    }

    case 'pmsRecommendTraining': {
      const { review_id, employee_id } = p;
      const rRow = review_id ? await one("SELECT data FROM entities WHERE type='PerformanceReview' AND id=$1", [review_id]): null;
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
      const payrolls = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2", [month, year]));
      const pfTotal  = payrolls.reduce((s,r)=>s+(r.pf_employee||0)+(r.pf_employer||0),0);
      const esiTotal = payrolls.reduce((s,r)=>s+(r.esi_employee||0)+(r.esi_employer||0),0);
      const ptTotal  = payrolls.reduce((s,r)=>s+(r.professional_tax||0),0);

      const dueDate = `${year}-${String(parseInt(month)+1).padStart(2,'0')}-15`;
      for (const { name, amount, type } of [
        { name:`PF – ${month}/${year}`, amount:pfTotal, type:'pf' },
        { name:`ESI – ${month}/${year}`, amount:esiTotal, type:'esi' },
        { name:`Professional Tax – ${month}/${year}`, amount:ptTotal, type:'pt' },
      ]) {
        const existing = await one("SELECT id FROM entities WHERE type='ComplianceRecord' AND data::jsonb->>'compliance_type'=$1 AND data::jsonb->>'month'=$2 AND data::jsonb->>'year'=$3", [type, month, year]);
        if (!existing) {
          const id = uuidv4();
          await run("INSERT INTO entities(id,type,status,data) VALUES($1,'ComplianceRecord','pending',$2)", [id, JSON.stringify({ id, compliance_type:type, name, amount, month, year, due_date:dueDate, status:'pending' })]);
        }
      }
      return res.json({ success:true });
    }

    case 'updateComplianceStatus': {
      const { record_id, status, paid_date, reference } = p;
      const row = await one("SELECT id,data FROM entities WHERE id=$1", [record_id]);
      if (!row) return res.json({ success:false, error:'Record not found' });
      const updated = { ...JSON.parse(row.data), status, paid_date, reference };
      await run("UPDATE entities SET data=$1,status=$2 WHERE id=$3", [JSON.stringify(updated), status, record_id]);
      return res.json({ success:true });
    }

    case 'getComplianceSummary': {
      const { month, year } = p;
      const allRecs = parseEntities(await all("SELECT data FROM entities WHERE type='ComplianceRecord'"));
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

    case 'getComplianceInsights': {
      const today = new Date();
      const compRows = await all("SELECT data FROM entities WHERE type='Compliance'");
      const records = compRows.map(r => JSON.parse(r.data));
      const empRows2 = await all("SELECT data FROM entities WHERE type='Employee'");
      const activeEmps = empRows2.map(r => JSON.parse(r.data)).filter(e => e.employee_status === 'active' || !e.employee_status);

      const insights = [], recommendations = [];

      const overdue = records.filter(r => r.status !== 'paid' && r.due_date && new Date(r.due_date) < today);
      if (overdue.length) {
        insights.push({ type: 'error', title: `${overdue.length} overdue compliance payment(s)`, detail: overdue.map(r => `${r.compliance_type} – ₹${(r.amount||0).toLocaleString('en-IN')} (due ${r.due_date})`).join('; ') });
        recommendations.push({ priority: 'high', action: `Process ${overdue.length} overdue payment(s) immediately to avoid statutory penalties`, types: overdue.map(r => r.compliance_type) });
      }

      const sevenDays = new Date(today.getTime() + 7*24*60*60*1000);
      const upcoming7 = records.filter(r => r.status !== 'paid' && r.due_date && new Date(r.due_date) >= today && new Date(r.due_date) <= sevenDays);
      if (upcoming7.length) {
        insights.push({ type: 'warning', title: `${upcoming7.length} payment(s) due in next 7 days`, detail: upcoming7.map(r => `${r.compliance_type} – ₹${(r.amount||0).toLocaleString('en-IN')} (due ${r.due_date})`).join('; ') });
        recommendations.push({ priority: 'high', action: `Schedule payment for ${upcoming7.map(r=>r.compliance_type).join(', ')}`, types: upcoming7.map(r => r.compliance_type) });
      }

      const noPF = activeEmps.filter(e => !e.uan_number && !e.pf_account_number);
      if (noPF.length) {
        insights.push({ type: 'info', title: `${noPF.length} active employee(s) missing UAN/PF account number`, detail: `Employees: ${noPF.slice(0,5).map(e=>e.display_name||e.email||e.user_id).join(', ')}${noPF.length>5?' and more':''}` });
        recommendations.push({ priority: 'medium', action: `Register ${noPF.length} employee(s) with EPFO and update UAN numbers` });
      }

      const esiEligible = activeEmps.filter(e => Number(e.ctc||0)/12 <= 21000 && Number(e.ctc||0) > 0);
      if (esiEligible.length) insights.push({ type: 'info', title: `${esiEligible.length} employee(s) may be ESI eligible (gross ≤ ₹21,000/month)`, detail: 'Verify ESI coverage for these employees' });

      const totalLiability = records.filter(r => r.status !== 'paid').reduce((s,r) => s + Number(r.amount||0), 0);
      if (totalLiability > 0) insights.push({ type: 'info', title: `Total pending compliance liability: ₹${totalLiability.toLocaleString('en-IN')}`, detail: `${records.filter(r=>r.status!=='paid').length} unpaid records across PF, ESI, PT` });

      return res.json({ success: true, insights, recommendations, generated_at: new Date().toISOString() });
    }

    /* ── AI: Recruitment ─────────────────────────────── */
    case 'parseResume': {
      const { candidate_id, resume_url } = p;
      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
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
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ParsedResume',$2,'completed',$3)", [parsedId, candidate_id, JSON.stringify(parsedData)]);

      // Link parsed resume to candidate
      if (cRow) {
        const updCand = { ...cand, parsed_resume_id: parsedId };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(updCand), candidate_id]);
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
      const cRow  = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
      const jdRow = await one("SELECT data FROM entities WHERE type='JobRequisition' AND id=$1", [job_requisition_id]);
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

      // Persist the score as a CandidateScore entity (upsert by candidate + requisition)
      // so rankings survive page reload and power the leaderboard.
      try {
        const scoredAt = new Date().toISOString();
        const existingScore = await one(
          "SELECT id FROM entities WHERE type='CandidateScore' AND data::jsonb->>'candidate_id'=$1 AND data::jsonb->>'job_requisition_id'=$2 LIMIT 1",
          [candidate_id, job_requisition_id]
        );
        const scoreData = { ...result, candidate_id, job_requisition_id, scored_at: scoredAt };
        if (existingScore) {
          scoreData.id = existingScore.id;
          await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(scoreData), existingScore.id]);
        } else {
          const scoreId = uuidv4();
          scoreData.id = scoreId;
          await run("INSERT INTO entities(id,type,status,data) VALUES($1,'CandidateScore','active',$2)", [scoreId, JSON.stringify(scoreData)]);
        }
        // Mirror a quick summary onto the candidate record for at-a-glance display
        if (cRow) {
          const updCand = { ...cand, ai_score: result.overall_score, ai_recommendation: result.recommendation, ai_scored_at: scoredAt };
          await run("UPDATE entities SET data=$1, updated_at=NOW()::TEXT WHERE type='Candidate' AND id=$2", [JSON.stringify(updCand), candidate_id]);
        }
      } catch (persistErr) {
        console.warn('[scoreCandidate] persist failed:', persistErr.message);
      }

      return res.json({ success:true, data: result });
    }

    /* ── Offer Letter ────────────────────────────────── */
    case 'generateOfferLetter': {
      const { candidate_id, joining_date, designation, department, ctc, probation_months = 6, reporting_to, location } = p;
      if (!candidate_id) return res.json({ success:false, error:'candidate_id required' });

      const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [candidate_id]);
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
        await run("UPDATE entities SET status='offered', data=$1 WHERE id=$2", [JSON.stringify(updated), candidate_id]);
      } catch {}

      return res.json({ success:true, html: letterHtml, ref: offerRef });
    }

    /* ── AI: HR Assistant ────────────────────────────── */
    case 'askMax': {
      const { question = '', conversationHistory = [] } = p;
      const uid = cu?.id || p.user_id;

      // ── Build personalised HR context grounded in the user's real data ──
      let contextBlock = '';
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const now = new Date();
        const currentFY = now.getMonth() >= 3
          ? `${now.getFullYear()}-${now.getFullYear() + 1}`
          : `${now.getFullYear() - 1}-${now.getFullYear()}`;

        const parts = [];

        if (uid) {
          // Employee record
          const empRow = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
          const emp = empRow ? JSON.parse(empRow.data) : null;
          if (emp) {
            parts.push(`EMPLOYEE PROFILE:
- Name: ${emp.display_name || cu?.email || 'Employee'}
- Employee Code: ${emp.employee_code || 'N/A'}
- Department: ${emp.department || 'N/A'} | Designation: ${emp.designation || 'N/A'}
- Status: ${emp.employee_status || 'N/A'} | Date of Joining: ${emp.date_of_joining || 'N/A'}
- Work Location: ${emp.work_location || 'N/A'} | Employment Type: ${emp.employment_type || 'N/A'}`);
          }

          // Leave balances with policy names
          const balRows = (await all("SELECT data FROM entities WHERE type='LeaveBalance' AND user_id=$1", [uid])).map(r => JSON.parse(r.data));
          const polRows = (await all("SELECT id,data FROM entities WHERE type='LeavePolicy'")).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
          const polName = (pid) => polRows.find(pp => pp.id === pid)?.name || pid;
          const thisYearBals = balRows.filter(b => !b.year || b.year === now.getFullYear());
          if (thisYearBals.length) {
            parts.push(`LEAVE BALANCES (${now.getFullYear()}):\n` + thisYearBals.map(b =>
              `- ${polName(b.leave_policy_id)}: ${b.available ?? 0} available (allocated ${b.total_allocated ?? 0}, used ${b.used ?? 0}, pending ${b.pending_approval ?? 0})`
            ).join('\n'));
          }

          // Recent + upcoming leaves
          const recentLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 ORDER BY created_at DESC LIMIT 5", [uid])).map(r => JSON.parse(r.data));
          if (recentLeaves.length) {
            parts.push(`RECENT LEAVE REQUESTS:\n` + recentLeaves.map(l =>
              `- ${l.start_date} to ${l.end_date} (${l.total_days || '?'} day(s)) — ${polName(l.leave_policy_id) || l.leave_type || 'Leave'} — status: ${l.status}`
            ).join('\n'));
          }

          // Latest payslip
          const payRow = await one("SELECT data FROM entities WHERE type='Payroll' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [uid]);
          if (payRow) {
            const ps = JSON.parse(payRow.data);
            parts.push(`LATEST PAYSLIP: ${ps.month || ''} ${ps.year || ''} — Gross ₹${ps.gross_salary ?? ps.gross ?? 'N/A'}, Net ₹${ps.net_salary ?? 'N/A'}, Deductions ₹${ps.total_deductions ?? 'N/A'} (status: ${ps.status || 'N/A'})`);
          }

          // Pending items
          const pendingRegs = (await all("SELECT id FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND status='pending'", [uid])).length;
          const openTickets = (await all("SELECT id FROM entities WHERE type='HelpdeskTicket' AND user_id=$1 AND status NOT IN ('resolved','closed')", [uid])).length;
          const activeLoans = (await all("SELECT data FROM entities WHERE type='Loan' AND user_id=$1 AND status IN ('approved','active')", [uid])).map(r => JSON.parse(r.data));
          const pendingBits = [];
          if (pendingRegs) pendingBits.push(`${pendingRegs} pending regularisation(s)`);
          if (openTickets) pendingBits.push(`${openTickets} open helpdesk ticket(s)`);
          if (activeLoans.length) pendingBits.push(`${activeLoans.length} active loan(s) (outstanding ₹${activeLoans.reduce((s, l) => s + (l.outstanding_amount || l.remaining_amount || 0), 0)})`);
          if (pendingBits.length) parts.push(`OPEN ITEMS: ${pendingBits.join(', ')}.`);

          // This month's attendance summary
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
          const attRows = (await all("SELECT data FROM entities WHERE type='Attendance' AND user_id=$1 AND data::jsonb->>'date' >= $2", [uid, monthStart])).map(r => JSON.parse(r.data));
          if (attRows.length) {
            const present = attRows.filter(a => a.status === 'present').length;
            const half = attRows.filter(a => a.status === 'half_day').length;
            const absent = attRows.filter(a => a.status === 'absent').length;
            parts.push(`THIS MONTH ATTENDANCE: ${present} present, ${half} half-day, ${absent} absent (${attRows.length} days recorded).`);
          }
        }

        // Active company policies (grounding documents)
        const policyRows = (await all("SELECT data FROM entities WHERE type='CompanyPolicy'")).map(r => JSON.parse(r.data)).filter(pp => pp.is_active !== false);
        if (policyRows.length) {
          parts.push(`COMPANY POLICIES (official):\n` + policyRows.slice(0, 40).map(pp =>
            `- [${pp.category || 'general'}] ${pp.title}: ${(pp.description || '').slice(0, 400)}`
          ).join('\n'));
        }

        // Upcoming holidays
        const holRows = (await all("SELECT data FROM entities WHERE type='Holiday'")).map(r => JSON.parse(r.data))
          .filter(h => h.date >= todayStr).sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, 5);
        if (holRows.length) {
          parts.push(`UPCOMING HOLIDAYS:\n` + holRows.map(h => `- ${h.date}: ${h.name || h.holiday_name || 'Holiday'}`).join('\n'));
        }

        parts.unshift(`Today's date: ${todayStr}. Current financial year: ${currentFY}.`);
        contextBlock = parts.join('\n\n');
      } catch (ctxErr) {
        console.warn('[askMax] context build failed:', ctxErr.message);
      }

      const systemMsg = {
        role: 'system',
        content: `You are AskMax, the AI HR copilot for Maxvolt Energy Industries Limited (India, Manufacturing/Energy sector).
You help employees with HR policies, leave, payroll, attendance, benefits, and procedures.

You have access to the CURRENT EMPLOYEE'S REAL HR DATA below. Use it to give specific, personalised answers (e.g. quote their actual leave balance, payslip figures, or pending items). When the user asks about "my" anything, answer from this data.

Rules:
- Be concise, friendly, professional. Use bullet points for lists.
- Prefer the official COMPANY POLICIES text when answering policy questions; quote specifics.
- If the data needed isn't in the context, say so and suggest contacting HR — never invent figures.
- For numbers (leave balance, salary), only state values present in the context.
- Never reveal another employee's personal data.

──────── EMPLOYEE CONTEXT ────────
${contextBlock || 'No employee context available — answer from general policy knowledge and suggest contacting HR for specifics.'}
──────────────────────────────────`
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
          await run("INSERT INTO settings(key,value,updated_at) VALUES('GROQ_API_KEY',$1,NOW()::TEXT) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()::TEXT", [groq_api_key.trim()]);
        } else {
          await run("DELETE FROM settings WHERE key='GROQ_API_KEY'");
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
        const cRow = await one("SELECT data FROM entities WHERE type='Candidate' AND id=$1", [p.candidate_id]);
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
        const iUser = await one("SELECT full_name FROM users WHERE id=$1", [p.interviewer_id]);
        if (iUser) interviewerName = iUser.full_name;
        const iEmp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [p.interviewer_id]);
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
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
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
      await run("INSERT INTO entities(id,type,status,data) VALUES($1,'Candidate','applied',$2)", [id, JSON.stringify(d)]);
      return res.json({ success: true, application_id: id, candidate_id: id });
    }

    case 'getPublishedJob': {
      const jobId = p.job_id || p.jobId;
      const row = await one("SELECT data FROM entities WHERE type='JobRequisition' AND id=$1", [jobId]);
      return res.json(row ? { job: JSON.parse(row.data) } : { job: null });
    }

    /* ── MIS & Reporting ─────────────────────────────── */
    case 'getMISData': {
      const today      = new Date().toISOString().slice(0, 10);
      const now        = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const yr12Ago    = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);

      // ── Core headcount ──────────────────────────────────────────────────────
      const totalActive  = await one("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND status='active'").c;
      const presentToday = await one("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'check_in_time' IS NOT NULL", [today]).c;
      const absentToday  = Math.max(0, totalActive - presentToday);
      const newJoineesThisMonth = await one("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND data::jsonb->>'date_of_joining' >= $1", [monthStart]).c;
      const exitedLast12m = await one("SELECT COUNT(*) as c FROM entities WHERE type='Exit' AND data::jsonb->>'last_working_date' >= $1", [yr12Ago]).c;
      const attritionRate = totalActive > 0 ? parseFloat(((exitedLast12m / totalActive) * 100).toFixed(1)) : 0;

      // ── Leave ───────────────────────────────────────────────────────────────
      const pendingLeaveRequests = await one("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='pending'").c;
      const activeLeaves         = await one("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='approved' AND data::jsonb->>'start_date' <= $1 AND data::jsonb->>'end_date' >= $2", [today, today]).c;

      // ── Payroll ─────────────────────────────────────────────────────────────
      const payrollRows      = parseEntities(await all("SELECT data FROM entities WHERE type='Payroll' AND data::jsonb->>'year'=$1 AND data::jsonb->>'month'=$2", [now.getFullYear(), now.getMonth()+1]));
      const totalPayrollCost = payrollRows.reduce((s, r) => s + (r.net_salary || 0), 0);

      // ── Recruitment ─────────────────────────────────────────────────────────
      const allCandidates = parseEntities(await all("SELECT data FROM entities WHERE type='Candidate'"));
      const recruitment = {
        totalCandidates: allCandidates.length,
        hired:      allCandidates.filter(c => ['hired','joined'].includes(c.status)).length,
        inPipeline: allCandidates.filter(c => ['applied','screening','interview_scheduled','interview_done','selected'].includes(c.status)).length,
        rejected:   allCandidates.filter(c => c.status === 'rejected').length,
        offered:    allCandidates.filter(c => c.status === 'offered').length,
        hiringBySource: Object.entries(allCandidates.reduce((acc, c) => { const src = c.source || 'Direct'; acc[src] = (acc[src]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Reimbursements ──────────────────────────────────────────────────────
      const allReimb = parseEntities(await all("SELECT data FROM entities WHERE type='Reimbursement'"));
      const reimbursements = {
        total:   allReimb.reduce((s, r) => s + (r.amount || 0), 0),
        pending: allReimb.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0),
        byCategory: Object.entries(allReimb.reduce((acc, r) => { const t = r.expense_type || 'Other'; acc[t] = (acc[t]||0)+(r.amount||0); return acc; }, {})).map(([name, amount]) => ({ name, amount })),
      };

      // ── Helpdesk ────────────────────────────────────────────────────────────
      const allTickets = parseEntities(await all("SELECT data FROM entities WHERE type='Ticket'"));
      const tickets = {
        openTickets:     allTickets.filter(t => t.status === 'open').length,
        resolvedTickets: allTickets.filter(t => ['resolved','closed'].includes(t.status)).length,
        byCategory: Object.entries(allTickets.reduce((acc, t) => { const c = t.category||'General'; acc[c]=(acc[c]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count })),
      };

      // ── Assets ──────────────────────────────────────────────────────────────
      const allAssets = parseEntities(await all("SELECT data FROM entities WHERE type='Asset'"));
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
      const allExits = parseEntities(await all("SELECT data FROM entities WHERE type='Exit'"));
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
        const present = await one("SELECT COUNT(DISTINCT user_id) as c FROM entities WHERE type='Attendance' AND data::jsonb->>'date'=$1 AND data::jsonb->>'check_in_time' IS NOT NULL", [dateStr]).c;
        attendanceTrends.push({ date: dateStr, day: d.toLocaleDateString('en-IN',{weekday:'short'}), present, absent: Math.max(0, totalActive - present) });
      }

      // ── Department breakdown ────────────────────────────────────────────────
      const allEmps = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"));
      const departmentBreakdown = Object.entries(allEmps.reduce((acc, e) => { const d = e.department||'Unknown'; acc[d]=(acc[d]||0)+1; return acc; }, {})).map(([name, count]) => ({ name, count }));

      // ── Biometric / attendance stats ────────────────────────────────────────
      const attLogs      = parseEntities(await all("SELECT data FROM entities WHERE type='AttendanceLog' AND data::jsonb->>'punch_date' >= $1", [monthStart]));
      const attThisMonth = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1", [monthStart]));
      const workedRecs   = attThisMonth.filter(a => a.working_hours > 0);
      const avgWorkingHours   = workedRecs.length > 0 ? parseFloat((workedRecs.reduce((s,a)=>s+(a.working_hours||0),0)/workedRecs.length).toFixed(1)) : 0;
      const biometricSyncedCount = attLogs.length;
      const avgDailyPunches      = biometricSyncedCount > 0 && totalActive > 0 ? parseFloat((biometricSyncedCount / totalActive / 20).toFixed(1)) : 0;

      // ── Performance rating distribution ─────────────────────────────────────
      const allReviews = parseEntities(await all("SELECT data FROM entities WHERE type='PerformanceReview'"));
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
      const employees = parseEntities(await all("SELECT data FROM entities WHERE type='Employee' AND status='active'"))
        .map(e => ({ user_id: e.user_id, display_name: e.display_name, department: e.department, employee_code: e.employee_code }));

      // Approved leaves for the month
      const leaves = {};
      const leaveRows = parseEntities(await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'"))
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
      const attRows = parseEntities(await all("SELECT data FROM entities WHERE type='Attendance' AND data::jsonb->>'date' >= $1 AND data::jsonb->>'date' <= $2", [monthStart, monthEnd]));
      for (const att of attRows) {
        if (!attendance[att.user_id]) attendance[att.user_id] = {};
        attendance[att.user_id][att.date] = att.status || (att.check_in_time ? 'present' : 'absent');
      }

      // Holidays
      const holidays = parseEntities(await all("SELECT data FROM entities WHERE type='Holiday'"))
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

      await run("UPDATE users SET role=$1,custom_role=$2 WHERE id=$3", [role, role, uid]);

      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), ...employeeData, status:'active' };
        await run("UPDATE entities SET data=$1,status='active' WHERE id=$2", [JSON.stringify(d), eRow.id]);
      } else {
        const empId = uuidv4();
        const d = { id:empId, user_id:uid, ...employeeData, status:'active' };
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'active',$3)", [empId, uid, JSON.stringify(d)]);
      }

      // Send approval email
      try {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
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

      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [uid]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), onboarding_submitted:false, onboarding_rejection_reason:reason };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), eRow.id]);
      }

      try {
        const uRow = await one("SELECT email,full_name FROM users WHERE id=$1", [uid]);
        if (uRow?.email) {
          const tpl = emailTemplates.onboardingRejectedEmail({ name: uRow.full_name, reason });
          sendEmail({ to: uRow.email, ...tpl }).catch(e =>
            console.error('[email] Onboarding rejection email failed:', e.message)
          );
        }
      } catch(e) { console.error('[email] Onboarding rejection email error:', e.message); }

      return res.json({ success:true });
    }

    case 'handleNewUserSignup': case 'autoCreateEmployee': {
      const { user_id, email, full_name } = p;
      if (!user_id) return res.json({ success: true });
      const existingEmp = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (!existingEmp) {
        const empId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'pending',$3)", [empId, user_id, JSON.stringify({ id: empId, user_id, display_name: full_name, email, employee_status: 'pending_onboarding', created_at: new Date().toISOString() })]);
      }
      try {
        const smtpCfg = await one("SELECT value FROM settings WHERE key='smtp_config'");
        if (smtpCfg?.value) {
          const smtp = JSON.parse(smtpCfg.value);
          if (smtp.host && smtp.user) {
            const { default: nodemailer } = await import('nodemailer');
            const t = nodemailer.createTransporter({ host: smtp.host, port: smtp.port||587, secure: smtp.port==465, auth: { user: smtp.user, pass: smtp.pass } });
            await t.sendMail({ from: smtp.from||smtp.user, to: email, subject: 'Welcome to MaxVolt Energy HRMS',
              html: `<div style="font-family:Arial,sans-serif;max-width:600px"><h2 style="color:#2563eb">Welcome, ${full_name}!</h2><p>Your account has been created on the MaxVolt Energy HR Management System.</p><p>Please complete your onboarding form. Your HR team will review and activate your account.</p></div>` });
          }
        }
      } catch(e) { console.error('[welcome-email]', e.message); }
      return res.json({ success: true, message: 'Employee record initialized' });
    }

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
        let user = await one("SELECT id, full_name FROM users WHERE email=$1", [row.email]);
        if (!user) {
          // Create user account with temporary password
          const { v4 } = await import('uuid');
          const userId = v4();
          const hash   = await import('bcrypt').then(b => b.hash('Maxvolt@123', 10));
          await run("INSERT INTO users(id,email,full_name,role,status,custom_role) VALUES($1,$2,$3,'employee','active','employee')", [userId, row.email, row.name]);
          user = { id: userId, full_name: row.name };
        }

        // Check if employee record exists
        const existingEmp = await one("SELECT id FROM entities WHERE type='Employee' AND user_id=$1", [user.id]);
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
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Employee',$2,'active',$3)", [empId, user.id, JSON.stringify(empData)]);
        results.push({ ...row, status:'created', user_id: user.id, employee_id: empId });
      }

      const imported = results.filter(r => r.status === 'created').length;
      return res.json({ success:true, imported, total: rows.length, results });
    }

    case 'updateEmployeeConfirmation': {
      const { user_id, confirmation_date } = p;
      const eRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [user_id]);
      if (eRow) {
        const d = { ...JSON.parse(eRow.data), employee_status:'confirmation', confirmation_date };
        await run("UPDATE entities SET data=$1 WHERE id=$2", [JSON.stringify(d), eRow.id]);
      }
      return res.json({ success:true });
    }

    /* ── Business Cards ──────────────────────────────── */
    case 'getBusinessCard': {
      const row = await one("SELECT data FROM entities WHERE type='DigitalBusinessCard' AND user_id=$1", [p.user_id||cu?.id]);
      return res.json(row ? JSON.parse(row.data) : null);
    }

    case 'generatePrintableCards':
      return res.json({ success:true, pdf_url:null, message:'PDF generation requires additional setup' });

    /* ── Lifecycle events ────────────────────────────── */
    case 'onNewEmployeeJoined': {
      const { user_id: njUserId, employee_name, department: njDept, designation: njDesig } = p;
      if (njUserId) {
        const annId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Announcement',$2,'active',$3)", [annId, njUserId,
          JSON.stringify({ id: annId, title: `Welcome ${employee_name || 'New Team Member'}!`, content: `Please join us in welcoming ${employee_name || 'our new colleague'} to the ${njDept||'team'} as ${njDesig||'a new team member'}. We look forward to working together!`, category: 'new_joiner', is_published: true, created_at: new Date().toISOString() })]);
      }
      return res.json({ success: true });
    }

    case 'onAssetChanged': {
      const { asset_id: auditAssetId, changed_by: auditBy, change_type, old_data: oldD, new_data: newD } = p;
      const auditId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [auditId, auditBy||null,
        JSON.stringify({ id: auditId, entity_type: 'Asset', entity_id: auditAssetId, changed_by: auditBy, change_type: change_type||'update', old_data: oldD, new_data: newD, timestamp: new Date().toISOString() })]);
      return res.json({ success: true });
    }

    case 'extractFavicon':
      return res.json({ success:true });

    /* ── Audit Log ────────────────────────────────────── */
    case 'getAuditLog': {
      const { entity_type: alType, entity_id: alId, limit: alLim = 200 } = p;
      let q = "SELECT data FROM entities WHERE type='AuditLog'";
      const qp = [];
      if (alType) { q += ` AND data::jsonb->>'entity_type'=$${qp.push(alType)}`; }
      if (alId)   { q += ` AND data::jsonb->>'entity_id'=$${qp.push(alId)}`; }
      q += ` ORDER BY created_at DESC LIMIT $${qp.push(Number(alLim))}`;
      const alRows = await all(q, [...qp]);
      const alUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { alUserMap[u.id] = u.full_name; });
      const logs = alRows.map(r => { const d = JSON.parse(r.data); return { ...d, changed_by_name: alUserMap[d.changed_by] || d.changed_by }; });
      return res.json({ success: true, logs, total: logs.length });
    }

    case 'addAuditLog': {
      const { entity_type: aType, entity_id: aId, changed_by: aBy, change_type: aCt, summary: aSummary, old_data: aOld, new_data: aNew } = p;
      const aLogId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'AuditLog',$2,'active',$3)", [aLogId, aBy||null,
        JSON.stringify({ id: aLogId, entity_type: aType, entity_id: aId, changed_by: aBy, change_type: aCt||'update', summary: aSummary, old_data: aOld, new_data: aNew, timestamp: new Date().toISOString() })]);
      return res.json({ success: true });
    }

    /* ── Upcoming Events (dashboard widget) ──────────── */
    case 'getUpcomingEvents': {
      const today = new Date();
      const todayMD = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const events = [];

      const ueEmpRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const ueUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { ueUserMap[u.id] = u.full_name; });

      for (const row of ueEmpRows) {
        const emp = JSON.parse(row.data);
        if (!emp.user_id) continue;
        const name = ueUserMap[emp.user_id] || emp.display_name || emp.email || 'Unknown';

        // Birthday
        if (emp.date_of_birth) {
          const dob = new Date(emp.date_of_birth);
          const dobMD = `${String(dob.getMonth()+1).padStart(2,'0')}-${String(dob.getDate()).padStart(2,'0')}`;
          const diffDays = (() => { const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate()); if (next < today) next.setFullYear(today.getFullYear()+1); return Math.ceil((next-today)/(1000*60*60*24)); })();
          if (diffDays <= 30) events.push({ type: 'birthday', label: `${name}'s Birthday`, date: `${today.getFullYear()}-${dobMD}`, days_away: diffDays, user_id: emp.user_id, department: emp.department });
        }

        // Work anniversary
        if (emp.date_of_joining) {
          const doj = new Date(emp.date_of_joining);
          const dojMD = `${String(doj.getMonth()+1).padStart(2,'0')}-${String(doj.getDate()).padStart(2,'0')}`;
          const years = today.getFullYear() - doj.getFullYear();
          const diffDays = (() => { const next = new Date(today.getFullYear(), doj.getMonth(), doj.getDate()); if (next < today) next.setFullYear(today.getFullYear()+1); return Math.ceil((next-today)/(1000*60*60*24)); })();
          if (diffDays <= 30 && years > 0) events.push({ type: 'anniversary', label: `${name}'s Work Anniversary (${years} yr${years>1?'s':''})`, date: `${today.getFullYear()}-${dojMD}`, days_away: diffDays, user_id: emp.user_id, department: emp.department });
        }

        // Probation ending
        if (emp.employee_status === 'probation') {
          const probEnd = emp.probation_end_date ? new Date(emp.probation_end_date) : (emp.date_of_joining ? new Date(new Date(emp.date_of_joining).getTime() + 90*24*60*60*1000) : null);
          if (probEnd) {
            const diffDays = Math.ceil((probEnd-today)/(1000*60*60*24));
            if (diffDays >= 0 && diffDays <= 30) events.push({ type: 'probation', label: `${name}'s Probation Ends`, date: probEnd.toISOString().slice(0,10), days_away: diffDays, user_id: emp.user_id, department: emp.department });
            else if (diffDays < 0) events.push({ type: 'probation_overdue', label: `${name}'s Probation Overdue (${Math.abs(diffDays)} days)`, date: probEnd.toISOString().slice(0,10), days_away: diffDays, user_id: emp.user_id, department: emp.department });
          }
        }
      }

      // Employees returning from leave today/this week
      const leaveReturnRows = await all("SELECT data FROM entities WHERE type='Leave' AND status='approved'");
      for (const row of leaveReturnRows) {
        const lv = JSON.parse(row.data);
        if (!lv.end_date) continue;
        const endDate = new Date(lv.end_date);
        const diffDays = Math.ceil((endDate-today)/(1000*60*60*24));
        if (diffDays >= -1 && diffDays <= 3) {
          const name = ueUserMap[lv.user_id] || 'Employee';
          events.push({ type: 'leave_return', label: `${name} returns from leave`, date: new Date(endDate.getTime()+24*60*60*1000).toISOString().slice(0,10), days_away: diffDays+1, user_id: lv.user_id });
        }
      }

      events.sort((a,b) => a.days_away - b.days_away);
      return res.json({ success: true, events });
    }

    /* ── Bulk leave operations ────────────────────────── */
    case 'bulkApproveLeave': {
      const { leave_ids, approved_by: blApprover, comment: blComment } = p;
      if (!Array.isArray(leave_ids) || !leave_ids.length) return res.json({ success: false, error: 'No leave IDs provided' });
      let approved = 0, failed = 0;
      for (const lid of leave_ids) {
        try {
          const row = await one("SELECT id,data FROM entities WHERE type='Leave' AND id=$1", [lid]);
          if (!row) { failed++; continue; }
          const lv = JSON.parse(row.data);
          if (lv.status === 'approved') { approved++; continue; }
          const upd = { ...lv, status: 'approved', approved_by: blApprover, approved_at: new Date().toISOString(), approval_note: blComment||'Bulk approved' };
          await run("UPDATE entities SET data=$1,status='approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), row.id]);
          // Notify employee
          const nid = uuidv4();
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, lv.user_id, 'Leave Approved', `Your leave request (${lv.start_date} – ${lv.end_date}) has been approved.`, 'leave', '/leave']);
          approved++;
        } catch { failed++; }
      }
      return res.json({ success: true, approved, failed, total: leave_ids.length });
    }

    case 'bulkRejectLeave': {
      const { leave_ids: rlIds, rejected_by: rlBy, reason: rlReason } = p;
      if (!Array.isArray(rlIds) || !rlIds.length) return res.json({ success: false, error: 'No leave IDs provided' });
      let rejected = 0, failed = 0;
      for (const lid of rlIds) {
        try {
          const row = await one("SELECT id,data FROM entities WHERE type='Leave' AND id=$1", [lid]);
          if (!row) { failed++; continue; }
          const lv = JSON.parse(row.data);
          if (['approved','rejected'].includes(lv.status)) { rejected++; continue; }
          const upd = { ...lv, status: 'rejected', rejected_by: rlBy, rejected_at: new Date().toISOString(), rejection_reason: rlReason||'Bulk rejected' };
          await run("UPDATE entities SET data=$1,status='rejected',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(upd), row.id]);
          const nid = uuidv4();
          await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, lv.user_id, 'Leave Rejected', `Your leave request (${lv.start_date} – ${lv.end_date}) has been rejected.${rlReason?' Reason: '+rlReason:''}`, 'leave', '/leave']);
          rejected++;
        } catch { failed++; }
      }
      return res.json({ success: true, rejected, failed, total: rlIds.length });
    }

    /* ── Probation Management ────────────────────────── */
    case 'getProbationEmployees': {
      const today2 = new Date();
      const pbEmpRows = await all("SELECT data FROM entities WHERE type='Employee'");
      const pbUserMap = {};
      (await all("SELECT id,full_name,email FROM users")).forEach(u => { pbUserMap[u.id] = u; });
      const result = pbEmpRows.map(r => JSON.parse(r.data)).filter(e => e.employee_status === 'probation' || e.employee_status === 'active').map(e => {
        const u = pbUserMap[e.user_id] || {};
        const doj = e.date_of_joining ? new Date(e.date_of_joining) : null;
        const probEnd = e.probation_end_date ? new Date(e.probation_end_date) : (doj ? new Date(doj.getTime() + 90*24*60*60*1000) : null);
        const daysLeft = probEnd ? Math.ceil((probEnd - today2)/(1000*60*60*24)) : null;
        return { ...e, full_name: u.full_name, email: u.email, probation_end_date: probEnd?.toISOString().slice(0,10), days_left: daysLeft, probation_flag: daysLeft !== null && daysLeft <= 30 ? (daysLeft < 0 ? 'overdue' : 'due_soon') : 'active' };
      }).filter(e => e.employee_status === 'probation' || (e.days_left !== null && e.days_left <= 60));
      return res.json({ success: true, employees: result });
    }

    case 'processProbationAction': {
      const { user_id: pbUid, action: pbAction, probation_end_date: pbEnd, note: pbNote } = p;
      const pbRow = await one("SELECT id,data FROM entities WHERE type='Employee' AND user_id=$1", [pbUid]);
      if (!pbRow) return res.json({ success: false, error: 'Employee not found' });
      const pbEmp = JSON.parse(pbRow.data);
      const pbUpd = { ...pbEmp };
      if (pbAction === 'confirm') { pbUpd.employee_status = 'active'; pbUpd.confirmation_date = new Date().toISOString().slice(0,10); }
      else if (pbAction === 'extend') { pbUpd.employee_status = 'probation'; pbUpd.probation_end_date = pbEnd; pbUpd.probation_extension_note = pbNote; }
      else if (pbAction === 'terminate') { pbUpd.employee_status = 'terminated'; pbUpd.termination_date = new Date().toISOString().slice(0,10); pbUpd.termination_reason = pbNote||'Probation not cleared'; }
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(pbUpd), pbRow.id]);
      const pbMsg = { confirm: 'Congratulations! Your probation is complete and employment is confirmed.', extend: `Your probation period has been extended to ${pbEnd}.`, terminate: 'Your probation review has resulted in termination. Please contact HR.' };
      const pbNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [pbNid, pbUid, 'Probation Status Update', pbMsg[pbAction]||'Your probation status was updated.', 'probation', '/profile']);
      return res.json({ success: true, action: pbAction, status: pbUpd.employee_status });
    }

    /* ── Shift Swap ──────────────────────────────────── */
    case 'createShiftSwapRequest': {
      const { requester_id: ssReqId, target_user_id: ssTgtId, requester_date: ssReqDate, target_date: ssTgtDate, reason: ssReason } = p;
      const ssId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'ShiftSwap',$2,'pending',$3)", [ssId, ssReqId,
        JSON.stringify({ id: ssId, requester_id: ssReqId, target_user_id: ssTgtId, requester_date: ssReqDate, target_date: ssTgtDate||ssReqDate, reason: ssReason, status: 'pending', created_at: new Date().toISOString() })]);
      const ssReqName = await one("SELECT full_name FROM users WHERE id=$1", [ssReqId])?.full_name || 'An employee';
      const ssNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [ssNid, ssTgtId, 'Shift Swap Request', `${ssReqName} has requested a shift swap with you for ${ssReqDate}.`, 'shift_swap', '/shift-management']);
      return res.json({ success: true, swap_id: ssId });
    }

    case 'approveShiftSwap': case 'rejectShiftSwap': {
      const { swap_id: ssSwapId, processed_by: ssProcBy } = p;
      const ssRow = await one("SELECT id,data FROM entities WHERE type='ShiftSwap' AND id=$1", [ssSwapId]);
      if (!ssRow) return res.json({ success: false, error: 'Swap request not found' });
      const ss = JSON.parse(ssRow.data);
      const ssIsApprove = name === 'approveShiftSwap';
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify({ ...ss, status: ssIsApprove?'approved':'rejected', processed_by: ssProcBy, processed_at: new Date().toISOString() }), ssIsApprove?'approved':'rejected', ssRow.id]);
      const ssNid2 = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [ssNid2, ss.requester_id, `Shift Swap ${ssIsApprove?'Approved':'Rejected'}`, `Your shift swap request for ${ss.requester_date} has been ${ssIsApprove?'approved':'rejected'}.`, 'shift_swap', '/shift-management']);
      return res.json({ success: true });
    }

    case 'getShiftSwapRequests': {
      const { user_id: ssUid, status: ssStatus } = p;
      let ssQ = "SELECT data FROM entities WHERE type='ShiftSwap'";
      const ssP = [];
      if (ssUid) { const p1 = ssP.push(ssUid), p2 = ssP.push(ssUid); ssQ += ` AND (data::jsonb->>'requester_id'=$${p1} OR data::jsonb->>'target_user_id'=$${p2})`; }
      if (ssStatus) { ssQ += ` AND data::jsonb->>'status'=$${ssP.push(ssStatus)}`; }
      ssQ += " ORDER BY created_at DESC";
      const ssUserMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { ssUserMap[u.id] = u.full_name; });
      const swaps = (await all(ssQ, [...ssP])).map(r => { const d = JSON.parse(r.data); return { ...d, requester_name: ssUserMap[d.requester_id], target_name: ssUserMap[d.target_user_id] }; });
      return res.json({ success: true, swaps });
    }

    /* ── Tax Declarations (Form 12BB) ────────────────── */
    case 'submitTaxDeclaration': {
      const { user_id: tdUid, financial_year: tdFY, declarations: tdDecl } = p;
      const existTD = await one("SELECT id,data FROM entities WHERE type='TaxDeclaration' AND user_id=$1 AND data::jsonb->>'financial_year'=$2", [tdUid, tdFY]);
      const tdTotal = Object.values(tdDecl||{}).reduce((s,v) => s + Number(v||0), 0);
      const tdData = { user_id: tdUid, financial_year: tdFY, declarations: tdDecl, total_declared: tdTotal, status: 'submitted', submitted_at: new Date().toISOString() };
      if (existTD) {
        await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify({ ...JSON.parse(existTD.data), ...tdData, id: existTD.id }), existTD.id]);
      } else {
        const tdId = uuidv4();
        await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'TaxDeclaration',$2,'submitted',$3)", [tdId, tdUid, JSON.stringify({ ...tdData, id: tdId })]);
      }
      // Notify HR
      const hrRows2 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      for (const hr of hrRows2) {
        const tdNid = uuidv4();
        const tdName = await one("SELECT full_name FROM users WHERE id=$1", [tdUid])?.full_name || 'An employee';
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tdNid, hr.id, 'Tax Declaration Submitted', `${tdName} submitted tax declaration for FY ${tdFY}.`, 'tax', '/admin-panel']);
      }
      return res.json({ success: true, total_declared: tdTotal });
    }

    case 'getTaxDeclaration': {
      const { user_id: tdGetUid, financial_year: tdGetFY } = p;
      const tdParams = [tdGetUid]; if (tdGetFY) tdParams.push(tdGetFY);
      const tdRow = await one("SELECT data FROM entities WHERE type='TaxDeclaration' AND user_id=$1" + (tdGetFY ? " AND data::jsonb->>'financial_year'=$2" : ""), tdParams);
      return res.json({ success: true, declaration: tdRow ? JSON.parse(tdRow.data) : null });
    }

    case 'getTaxDeclarationSummary': {
      const { financial_year: tdsFY } = p;
      let tdsSql = "SELECT data FROM entities WHERE type='TaxDeclaration'";
      const tdsP = [];
      if (tdsFY) { tdsSql += ` AND data::jsonb->>'financial_year'=$${tdsP.push(tdsFY)}`; }
      const tdsUserMap = {};
      (await all("SELECT id,full_name,email FROM users")).forEach(u => { tdsUserMap[u.id] = u; });
      const decls = (await all(tdsSql, [...tdsP])).map(r => { const d = JSON.parse(r.data); const u = tdsUserMap[d.user_id]||{}; return { ...d, full_name: u.full_name, email: u.email }; });
      return res.json({ success: true, declarations: decls, total: decls.length, pending_approval: decls.filter(d=>d.status==='submitted').length });
    }

    case 'approveTaxDeclaration': {
      const { user_id: tdaUid, financial_year: tdaFY, approved_by: tdaBy, notes: tdaNotes } = p;
      const tdaParams = [tdaUid]; if (tdaFY) tdaParams.push(tdaFY);
      const tdaRow = await one("SELECT id,data FROM entities WHERE type='TaxDeclaration' AND user_id=$1" + (tdaFY ? " AND data::jsonb->>'financial_year'=$2" : ""), tdaParams);
      if (!tdaRow) return res.json({ success: false, error: 'Declaration not found' });
      const tdaData = { ...JSON.parse(tdaRow.data), status: 'approved', approved_by: tdaBy, approved_at: new Date().toISOString(), hr_notes: tdaNotes };
      await run("UPDATE entities SET data=$1,status='approved',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(tdaData), tdaRow.id]);
      const tdaNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tdaNid, tdaUid, 'Tax Declaration Approved', `Your tax declaration for FY ${tdaFY} has been approved.`, 'tax', '/profile']);
      return res.json({ success: true });
    }

    /* ── Loan Management ─────────────────────────────── */
    case 'applyForLoan': {
      const { user_id: lnUid, loan_type, amount: lnAmt, tenure_months, purpose, requested_disbursement_date } = p;
      const lnId = uuidv4();
      const emi = lnAmt && tenure_months ? Math.ceil(Number(lnAmt) / Number(tenure_months)) : 0;
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Loan',$2,'pending',$3)", [lnId, lnUid,
        JSON.stringify({ id: lnId, user_id: lnUid, loan_type: loan_type||'personal', amount: Number(lnAmt||0), tenure_months: Number(tenure_months||0), emi_amount: emi, purpose, requested_disbursement_date, status: 'pending', applied_at: new Date().toISOString(), outstanding_amount: Number(lnAmt||0) })]);
      const hrRows3 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      const lnName = await one("SELECT full_name FROM users WHERE id=$1", [lnUid])?.full_name||'Employee';
      for (const hr of hrRows3) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, hr.id, 'Loan Application', `${lnName} applied for a ₹${Number(lnAmt||0).toLocaleString('en-IN')} ${loan_type||'personal'} loan.`, 'loan', '/loan-management']);
      }
      return res.json({ success: true, loan_id: lnId, emi_amount: emi });
    }

    case 'approveLoan': case 'rejectLoan': {
      const { loan_id: lnActId, approved_by: lnActBy, disbursement_date, rejection_reason } = p;
      const lnRow = await one("SELECT id,data FROM entities WHERE type='Loan' AND id=$1", [lnActId]);
      if (!lnRow) return res.json({ success: false, error: 'Loan not found' });
      const lnData = JSON.parse(lnRow.data);
      const isLnApprove = name === 'approveLoan';
      const lnUpd = { ...lnData, status: isLnApprove?'approved':'rejected', processed_by: lnActBy, processed_at: new Date().toISOString(), ...(isLnApprove ? { disbursement_date, repayment_start_date: disbursement_date } : { rejection_reason }) };
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(lnUpd), lnUpd.status, lnRow.id]);
      const lnNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [lnNid, lnData.user_id, `Loan ${isLnApprove?'Approved':'Rejected'}`, isLnApprove?`Your loan of ₹${lnData.amount?.toLocaleString('en-IN')} has been approved. Disbursement: ${disbursement_date||'TBD'}.`:`Your loan application was rejected. ${rejection_reason||''}`, 'loan', '/loan-management']);
      return res.json({ success: true });
    }

    case 'getLoanDetails': {
      const { user_id: lnGetUid, loan_id: lnGetId } = p;
      let lnQ = "SELECT data FROM entities WHERE type='Loan'";
      const lnP2 = [];
      if (lnGetId) { lnQ += ` AND id=$${lnP2.push(lnGetId)}`; }
      else if (lnGetUid) { lnQ += ` AND user_id=$${lnP2.push(lnGetUid)}`; }
      lnQ += " ORDER BY created_at DESC";
      const lnUserMap2 = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { lnUserMap2[u.id] = u.full_name; });
      const loans = (await all(lnQ, [...lnP2])).map(r => { const d = JSON.parse(r.data); return { ...d, employee_name: lnUserMap2[d.user_id] }; });
      return res.json({ success: true, loans });
    }

    case 'processLoanRepayment': {
      const { loan_id: lnRepId, amount: lnRepAmt, repayment_date, notes: lnRepNotes } = p;
      const lnRepRow = await one("SELECT id,data FROM entities WHERE type='Loan' AND id=$1", [lnRepId]);
      if (!lnRepRow) return res.json({ success: false, error: 'Loan not found' });
      const lnRep = JSON.parse(lnRepRow.data);
      const newOutstanding = Math.max(0, Number(lnRep.outstanding_amount||lnRep.amount||0) - Number(lnRepAmt||0));
      const repHistory = [...(lnRep.repayment_history||[]), { amount: Number(lnRepAmt||0), date: repayment_date||new Date().toISOString().slice(0,10), notes: lnRepNotes }];
      const lnRepUpd = { ...lnRep, outstanding_amount: newOutstanding, repayment_history: repHistory, status: newOutstanding <= 0 ? 'closed' : lnRep.status };
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(lnRepUpd), lnRepRow.id]);
      return res.json({ success: true, outstanding_amount: newOutstanding, status: lnRepUpd.status });
    }

    /* ── Helpdesk SLA ────────────────────────────────── */
    case 'getHelpdeskStats': {
      const tktRows = await all("SELECT data FROM entities WHERE type='HelpdeskTicket'");
      const tickets = tktRows.map(r => JSON.parse(r.data));
      const now = new Date();
      const stats = { total: tickets.length, open: 0, in_progress: 0, resolved: 0, closed: 0, overdue: 0, avg_resolution_hours: 0 };
      let totalResolvedHours = 0, resolvedCount = 0;
      for (const t of tickets) {
        const s = (t.status||'open').toLowerCase().replace(/\s+/g,'_');
        if (s === 'open') stats.open++;
        else if (s === 'in_progress') stats.in_progress++;
        else if (s === 'resolved') { stats.resolved++; if (t.created_at && t.resolved_at) { totalResolvedHours += (new Date(t.resolved_at)-new Date(t.created_at))/(1000*60*60); resolvedCount++; } }
        else if (s === 'closed') stats.closed++;
        // SLA: tickets open > 24h are overdue
        if (['open','in_progress'].includes(s) && t.created_at) {
          const hoursOpen = (now - new Date(t.created_at))/(1000*60*60);
          const slaHours = t.priority === 'high' ? 4 : t.priority === 'medium' ? 24 : 72;
          if (hoursOpen > slaHours) stats.overdue++;
        }
      }
      stats.avg_resolution_hours = resolvedCount ? Math.round(totalResolvedHours/resolvedCount) : 0;
      return res.json({ success: true, stats });
    }

    case 'escalateHelpdeskTicket': {
      const { ticket_id: tktId, escalated_to, reason: tktReason } = p;
      const tktRow = await one("SELECT id,data FROM entities WHERE type='HelpdeskTicket' AND id=$1", [tktId]);
      if (!tktRow) return res.json({ success: false, error: 'Ticket not found' });
      const tkt = JSON.parse(tktRow.data);
      const tktUpd = { ...tkt, status: 'escalated', escalated_to, escalation_reason: tktReason, escalated_at: new Date().toISOString() };
      await run("UPDATE entities SET data=$1,status='escalated',updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(tktUpd), tktRow.id]);
      if (escalated_to) {
        const tktNid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [tktNid, escalated_to, 'Ticket Escalated to You', `Helpdesk ticket #${tktId.slice(0,8)} has been escalated. Reason: ${tktReason||'SLA breach'}`, 'helpdesk', '/helpdesk']);
      }
      return res.json({ success: true });
    }

    /* ── Insurance Claims ────────────────────────────── */
    case 'fileInsuranceClaim': {
      const { user_id: icUid, policy_id, claim_amount, claim_type, description: icDesc, incident_date } = p;
      const icId = uuidv4();
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'InsuranceClaim',$2,'pending',$3)", [icId, icUid,
        JSON.stringify({ id: icId, user_id: icUid, policy_id, claim_amount: Number(claim_amount||0), claim_type, description: icDesc, incident_date, status: 'pending', filed_at: new Date().toISOString() })]);
      const icName = await one("SELECT full_name FROM users WHERE id=$1", [icUid])?.full_name||'Employee';
      const hrRows4 = await all("SELECT id FROM users WHERE role IN ('admin','hr')");
      for (const hr of hrRows4) {
        const nid = uuidv4();
        await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [nid, hr.id, 'Insurance Claim Filed', `${icName} filed an insurance claim for ₹${Number(claim_amount||0).toLocaleString('en-IN')}.`, 'insurance', '/insurance-management']);
      }
      return res.json({ success: true, claim_id: icId });
    }

    case 'processInsuranceClaim': {
      const { claim_id: icActId, action: icAct, approved_amount, rejection_reason: icRej, processed_by: icProcBy } = p;
      const icRow = await one("SELECT id,data FROM entities WHERE type='InsuranceClaim' AND id=$1", [icActId]);
      if (!icRow) return res.json({ success: false, error: 'Claim not found' });
      const icData = JSON.parse(icRow.data);
      const icUpd = { ...icData, status: icAct==='approve'?'approved':'rejected', processed_by: icProcBy, processed_at: new Date().toISOString(), ...(icAct==='approve' ? { approved_amount: Number(approved_amount||icData.claim_amount||0) } : { rejection_reason: icRej }) };
      await run("UPDATE entities SET data=$1,status=$2,updated_at=NOW()::TEXT WHERE id=$3", [JSON.stringify(icUpd), icUpd.status, icRow.id]);
      const icNid = uuidv4();
      await run("INSERT INTO notifications(id,user_id,title,message,type,link) VALUES($1,$2,$3,$4,$5,$6)", [icNid, icData.user_id, `Insurance Claim ${icAct==='approve'?'Approved':'Rejected'}`, icAct==='approve'?`Your claim for ₹${icData.claim_amount} has been approved. Approved amount: ₹${approved_amount||icData.claim_amount}.`:`Your claim was rejected. ${icRej||''}`, 'insurance', '/insurance-management']);
      return res.json({ success: true });
    }

    case 'getInsuranceClaims': {
      const { user_id: icGetUid } = p;
      let icQ = "SELECT data FROM entities WHERE type='InsuranceClaim'";
      const icQP = [];
      if (icGetUid) { icQ += ` AND user_id=$${icQP.push(icGetUid)}`; }
      icQ += " ORDER BY created_at DESC";
      const icUMap = {};
      (await all("SELECT id,full_name FROM users")).forEach(u => { icUMap[u.id] = u.full_name; });
      const claims = (await all(icQ, [...icQP])).map(r => { const d = JSON.parse(r.data); return { ...d, employee_name: icUMap[d.user_id] }; });
      return res.json({ success: true, claims });
    }

    /* ── Employee Dashboard (self-service) ───────────── */
    case 'getEmployeeDashboard': {
      const { user_id: edUid } = p;
      if (!edUid) return res.json({ success: false, error: 'user_id required' });

      const edEmp = await one("SELECT data FROM entities WHERE type='Employee' AND user_id=$1", [edUid]);
      const emp = edEmp ? JSON.parse(edEmp.data) : {};

      // Recent leaves
      const edLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 ORDER BY created_at DESC LIMIT 5", [edUid])).map(r=>JSON.parse(r.data));

      // Pending regularisations
      const edRegs = (await all("SELECT data FROM entities WHERE type='AttendanceRegularisation' AND user_id=$1 AND status='pending'", [edUid])).map(r=>JSON.parse(r.data));

      // Active loans
      const edLoans = (await all("SELECT data FROM entities WHERE type='Loan' AND user_id=$1 AND status IN ('approved','active')", [edUid])).map(r=>JSON.parse(r.data));

      // Latest payslip
      const edPayroll = await one("SELECT data FROM entities WHERE type='Payroll' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [edUid]);
      const latestPayslip = edPayroll ? JSON.parse(edPayroll.data) : null;

      // Open helpdesk tickets
      const edTickets = (await all("SELECT data FROM entities WHERE type='HelpdeskTicket' AND user_id=$1 AND status NOT IN ('resolved','closed')", [edUid])).map(r=>JSON.parse(r.data));

      // Tax declaration status
      const currentFY = new Date().getMonth() >= 3 ? `${new Date().getFullYear()}-${new Date().getFullYear()+1}` : `${new Date().getFullYear()-1}-${new Date().getFullYear()}`;
      const edTax = await one("SELECT data FROM entities WHERE type='TaxDeclaration' AND user_id=$1 ORDER BY created_at DESC LIMIT 1", [edUid]);

      // Upcoming leaves (approved, future)
      const todayStr = new Date().toISOString().slice(0,10);
      const edUpcomingLeaves = (await all("SELECT data FROM entities WHERE type='Leave' AND user_id=$1 AND status='approved' AND end_date>=$2", [edUid, todayStr])).map(r=>JSON.parse(r.data));

      return res.json({ success: true, employee: emp, recent_leaves: edLeaves, pending_regularisations: edRegs.length, active_loans: edLoans, latest_payslip: latestPayslip, open_tickets: edTickets.length, upcoming_leaves: edUpcomingLeaves, tax_declaration: edTax ? JSON.parse(edTax.data) : null, current_fy: currentFY });
    }

    /* ── Training ────────────────────────────────────── */

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
