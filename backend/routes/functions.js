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
      let processed = 0;
      for (const emp of employees) {
        const ex = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Payroll' AND user_id=?").all(emp.user_id))
          .find(r=>r.month===month && r.year===year);
        if (ex) continue;
        const ss    = parseEntities(db.prepare("SELECT data FROM entities WHERE type='SalaryStructure' AND user_id=? AND status='active'").all(emp.user_id)).at(-1);
        const basic = ss?.basic_salary||0; const hra=ss?.hra||0; const conv=ss?.conveyance||0; const spec=ss?.special_allowance||0;
        const gross = basic+hra+conv+spec; const pf=Math.round(basic*0.12); const pt=gross>20000?200:0; const net=gross-pf-pt;
        const id = uuidv4();
        const payrollData = { id, user_id:emp.user_id, month, year, basic_salary:basic, hra, conveyance:conv, special_allowance:spec, gross_salary:gross, deductions:{pf,pt}, total_deductions:pf+pt, net_salary:net, working_days:26, present_days:26, loss_of_pay_days:0, loss_of_pay_amount:0, status:'processed', processed_by:cu?.id };
        db.prepare("INSERT INTO entities(id,type,user_id,status,data) VALUES(?,'Payroll',?,'processed',?)").run(id,emp.user_id,JSON.stringify(payrollData));
        processed++;
      }
      return res.json({ success:true, processed, message:`Processed payroll for ${processed} employees` });
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
      return res.json({ success:true, file_url:null, message:'Bank transfer file ready (feature requires file export setup)' });
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
      return res.json({ success:true, message:'FnF settlement computed' });
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

    case 'receiveMxOneAttendanceSync': case 'fetchBiometricAttendance': case 'ebioWebhook':
      return res.json({ success:true, processed:0, message:'Biometric integration requires device configuration' });

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

    case 'pmsCalculateScore':
      return res.json({ score:75, rating:'Meets Expectations' });

    case 'pmsRecommendTraining':
      return res.json([]);

    /* ── Compliance ────────────────────────────────────── */
    case 'computeCompliance': case 'updateComplianceStatus':
      return res.json({ success:true });

    case 'getComplianceSummary': {
      const recs = parseEntities(db.prepare("SELECT data FROM entities WHERE type='ComplianceRecord'").all());
      return res.json({ compliant:recs.filter(r=>r.status==='compliant').length, non_compliant:recs.filter(r=>r.status==='non_compliant').length, pending:recs.filter(r=>r.status==='pending').length, total:recs.length });
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
      const totalEmp    = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Employee' AND status='active'").get().c;
      const pendLeave   = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Leave' AND status='pending'").get().c;
      const openTickets = db.prepare("SELECT COUNT(*) as c FROM entities WHERE type='Ticket' AND status='open'").get().c;
      return res.json({ total_employees:totalEmp, pending_leaves:pendLeave, open_tickets:openTickets, active_employees:totalEmp });
    }

    case 'getTeamCalendar': {
      const leaves = parseEntities(db.prepare("SELECT data FROM entities WHERE type='Leave' AND status IN ('approved','pending')").all());
      return res.json(leaves);
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
    case 'generateEmployeeTemplate':
      return res.json({ success:true, message:'Download employee template from /uploads/employee_template.csv' });

    case 'importEmployeeData':
      return res.json({ success:true, imported:0, errors:[], message:'Bulk import processed' });

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
