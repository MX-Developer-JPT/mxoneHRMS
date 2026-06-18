import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as XLSX from 'npm:xlsx@0.18.5';

// Retry helper for rate-limited calls
async function withRetry(fn, maxRetries = 4, baseDelayMs = 1000) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const is429 = e.status === 429 || e.message?.includes('Rate limit') || e.message?.includes('429');
      if (is429 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

function parseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function cleanKey(k) {
  return k.replace(/\*$/, '').trim();
}

function normalizeRow(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    out[cleanKey(k)] = row[k];
  }
  return out;
}

function toNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  return String(v).trim().toUpperCase() === 'TRUE';
}

// Accepts any common date format and returns YYYY-MM-DD, or '' if unparseable
function parseDate(v) {
  if (!v && v !== 0) return '';
  // Excel serial number (number or numeric string)
  const num = typeof v === 'number' ? v : (String(v).trim().match(/^\d{5}$/) ? parseInt(v) : NaN);
  if (!isNaN(num) && num > 1000) {
    // Excel epoch: Jan 0 1900 = serial 0 (with leap year bug)
    const d = new Date(Date.UTC(1900, 0, num - 1));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return '';
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const d = parseInt(mdy[2]), m = parseInt(mdy[1]);
    if (m <= 12 && d > 12) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  }
  // YYYY/MM/DD
  const ymd = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  // Try JS Date parse as last resort
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await withRetry(() => base44.auth.me());
  if (!user || (user.role !== 'admin' && user.custom_role !== 'hr' && user.role !== 'hr')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const mode = body.mode || 'validate';
  const fileUrl = body.fileUrl;
  if (!fileUrl) return Response.json({ error: 'No file provided' }, { status: 400 });

  // Fetch the uploaded file and read it as an array buffer
  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) return Response.json({ error: 'Failed to fetch uploaded file' }, { status: 400 });
  const arrayBuffer = await fileResponse.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(bytes, { type: 'array' });

  // Parse all sheets
  const rawEmp = parseSheet(wb, 'Employee_Profile').map(normalizeRow);
  const rawStat = parseSheet(wb, 'Statutory_Info').map(normalizeRow);
  const rawBank = parseSheet(wb, 'Bank_Details').map(normalizeRow);
  const rawPF = parseSheet(wb, 'PF_Nominee').map(normalizeRow);
  const rawIns = parseSheet(wb, 'Insurance_Policies').map(normalizeRow);
  const rawSal = parseSheet(wb, 'Salary_Structure').map(normalizeRow);
  const rawLv = parseSheet(wb, 'Leave_Balances').map(normalizeRow);

  // Load existing policies for code->id mapping
  const policies = await withRetry(() => base44.asServiceRole.entities.LeavePolicy.list());
  const policyByCode = {};
  for (const p of policies) { policyByCode[p.code] = p; }

  // ----- VALIDATION -----
  const errors = [];
  const warnings = [];
  const emailSet = new Set();

  const VALID_GENDER = ['male', 'female', 'other'];
  const VALID_TIER = ['executive', 'senior_executive', 'territory_manager', 'manager', 'general_manager', 'director'];
  const VALID_EMP_STATUS = ['probation', 'confirmation', 'trainee'];
  const VALID_EMP_TYPE = ['full_time', 'part_time', 'contract', 'intern'];
  const VALID_STATUS = ['active', 'on_leave', 'resigned', 'terminated'];
  const VALID_BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

  // Normalize all date fields in-place so downstream code gets YYYY-MM-DD
  const DATE_FIELDS_EMP = ['date_of_joining', 'date_of_birth', 'employee_confirmation_date'];
  rawEmp.forEach(row => { DATE_FIELDS_EMP.forEach(f => { if (row[f]) row[f] = parseDate(row[f]); }); });
  rawSal.forEach(row => { if (row.effective_from) row.effective_from = parseDate(row.effective_from); });

  rawEmp.forEach((row, i) => {
    const r = i + 2;
    if (!row.full_name && !row.display_name) errors.push({ sheet: 'Employee_Profile', row: r, field: 'full_name', msg: 'Required field missing — employee full name is required' });
    if (!row.employee_code) errors.push({ sheet: 'Employee_Profile', row: r, field: 'employee_code', msg: 'Required field missing' });
    if (!row.personal_email) errors.push({ sheet: 'Employee_Profile', row: r, field: 'personal_email', msg: 'Required field missing' });
    else if (emailSet.has(row.personal_email)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'personal_email', msg: 'Duplicate email' });
    else emailSet.add(row.personal_email);
    if (!row.department) errors.push({ sheet: 'Employee_Profile', row: r, field: 'department', msg: 'Required field missing' });
    if (!row.designation) errors.push({ sheet: 'Employee_Profile', row: r, field: 'designation', msg: 'Required field missing' });
    if (!row.date_of_joining) errors.push({ sheet: 'Employee_Profile', row: r, field: 'date_of_joining', msg: 'Required field missing' });
    else if (!row.date_of_joining) errors.push({ sheet: 'Employee_Profile', row: r, field: 'date_of_joining', msg: 'Could not parse date — try YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY' });
    if (row.gender && !VALID_GENDER.includes(row.gender)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'gender', msg: `Invalid value. Allowed: ${VALID_GENDER.join(', ')}` });
    if (row.designation_tier && !VALID_TIER.includes(row.designation_tier)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'designation_tier', msg: `Invalid value` });
    if (row.employee_status && !VALID_EMP_STATUS.includes(row.employee_status)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'employee_status', msg: `Invalid value. Allowed: ${VALID_EMP_STATUS.join(', ')}` });
    if (row.employment_type && !VALID_EMP_TYPE.includes(row.employment_type)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'employment_type', msg: `Invalid value` });
    if (row.status && !VALID_STATUS.includes(row.status)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'status', msg: `Invalid value` });
    if (row.blood_group && !VALID_BLOOD.includes(row.blood_group)) errors.push({ sheet: 'Employee_Profile', row: r, field: 'blood_group', msg: `Invalid value` });
  });

  rawSal.forEach((row, i) => {
    const r = i + 2;
    if (!row.personal_email) errors.push({ sheet: 'Salary_Structure', row: r, field: 'personal_email', msg: 'Required field missing' });
    if (!row.effective_from) errors.push({ sheet: 'Salary_Structure', row: r, field: 'effective_from', msg: 'Required field missing' });
    if (!row.ctc) errors.push({ sheet: 'Salary_Structure', row: r, field: 'ctc', msg: 'Required field missing' });
    if (row.personal_email && !emailSet.has(row.personal_email)) warnings.push({ sheet: 'Salary_Structure', row: r, msg: `Email ${row.personal_email} not found in Employee_Profile` });
  });

  rawLv.forEach((row, i) => {
    const r = i + 2;
    if (!row.personal_email) errors.push({ sheet: 'Leave_Balances', row: r, field: 'personal_email', msg: 'Required field missing' });
    if (!row.leave_policy_code) errors.push({ sheet: 'Leave_Balances', row: r, field: 'leave_policy_code', msg: 'Required field missing' });
    else if (!policyByCode[row.leave_policy_code]) errors.push({ sheet: 'Leave_Balances', row: r, field: 'leave_policy_code', msg: `Policy code "${row.leave_policy_code}" not found in system` });
    if (!row.year) errors.push({ sheet: 'Leave_Balances', row: r, field: 'year', msg: 'Required field missing' });
    if (row.personal_email && !emailSet.has(row.personal_email)) warnings.push({ sheet: 'Leave_Balances', row: r, msg: `Email ${row.personal_email} not found in Employee_Profile` });
  });

  const preview = {
    employee_profile: rawEmp,
    statutory_info: rawStat,
    bank_details: rawBank,
    pf_nominee: rawPF,
    insurance_policies: rawIns,
    salary_structure: rawSal,
    leave_balances: rawLv,
    errors,
    warnings,
    total_employees: rawEmp.length,
  };

  if (mode === 'validate') {
    return Response.json(preview);
  }

  // ----- IMPORT -----
  if (errors.length > 0) {
    return Response.json({ error: 'Cannot import with validation errors', errors }, { status: 400 });
  }

  // Index other sheets by email
  const statByEmail = {};
  rawStat.forEach(r => { if (r.personal_email) statByEmail[r.personal_email] = r; });
  const bankByEmail = {};
  rawBank.forEach(r => { if (r.personal_email) bankByEmail[r.personal_email] = r; });
  const pfByEmail = {};
  rawPF.forEach(r => { if (r.personal_email) pfByEmail[r.personal_email] = r; });
  const insByEmail = {};
  rawIns.forEach(r => {
    if (!r.personal_email) return;
    if (!insByEmail[r.personal_email]) insByEmail[r.personal_email] = [];
    insByEmail[r.personal_email].push(r);
  });
  const salByEmail = {};
  rawSal.forEach(r => { if (r.personal_email) salByEmail[r.personal_email] = r; });
  const lvByEmail = {};
  rawLv.forEach(r => {
    if (!r.personal_email) return;
    if (!lvByEmail[r.personal_email]) lvByEmail[r.personal_email] = [];
    lvByEmail[r.personal_email].push(r);
  });

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const importResults = [];

  for (const emp of rawEmp) {
    const email = emp.personal_email;
    const stat = statByEmail[email] || {};
    const bank = bankByEmail[email] || {};
    const pf = pfByEmail[email] || {};
    const ins = insByEmail[email] || [];
    const sal = salByEmail[email] || null;
    const lvs = lvByEmail[email] || [];

    // Capture name from Excel (full_name or display_name column)
    const displayName = (emp.full_name || emp.display_name || '').trim();
    // Capture role from Excel (default to 'employee' mapped to 'user' role)
    const empRole = (emp.role || 'employee').trim().toLowerCase();

    const employeeRecord = {
      user_id: 'pending',
      employee_code: emp.employee_code,
      personal_email: email,
      display_name: displayName || undefined,
      department: emp.department,
      designation: emp.designation,
      designation_tier: emp.designation_tier || undefined,
      employee_status: emp.employee_status || 'probation',
      date_of_joining: emp.date_of_joining,
      employee_confirmation_date: emp.employee_confirmation_date || undefined,
      work_location: emp.work_location || undefined,
      date_of_birth: emp.date_of_birth || undefined,
      gender: emp.gender || undefined,
      father_spouse_name: emp.father_spouse_name || undefined,
      phone: emp.phone ? String(emp.phone) : undefined,
      blood_group: emp.blood_group || undefined,
      employment_type: emp.employment_type || 'full_time',
      status: emp.status || 'active',
      is_attendance_exempt: toBool(emp.is_attendance_exempt),
      onboarding_submitted: false,
      _import_role: empRole,
      address: emp.address || undefined,
      emergency_contact: (emp.emergency_contact_name || emp.emergency_contact_phone) ? {
        name: emp.emergency_contact_name || undefined,
        relationship: emp.emergency_contact_relationship || undefined,
        phone: emp.emergency_contact_phone ? String(emp.emergency_contact_phone) : undefined,
        address: emp.emergency_contact_address || undefined,
      } : undefined,
      // Statutory — coerce to string to handle numeric Excel cells
      pan_number: stat.pan_number ? String(stat.pan_number).trim() : undefined,
      aadhar_number: stat.aadhar_number ? String(stat.aadhar_number).trim() : undefined,
      uan_number: stat.uan_number ? String(stat.uan_number).trim() : undefined,
      pf_account_number: stat.pf_account_number ? String(stat.pf_account_number).trim() : undefined,
      is_esi_applicable: stat.is_esi_applicable ? toBool(stat.is_esi_applicable) : false,
      esi_number: stat.esi_number ? String(stat.esi_number).trim() : undefined,
      // Bank — coerce to string
      bank_account: bank.account_number ? {
        account_number: String(bank.account_number).trim(),
        ifsc_code: bank.ifsc_code ? String(bank.ifsc_code).trim() : undefined,
        bank_name: bank.bank_name || undefined,
        branch: bank.branch || undefined,
      } : undefined,
      // PF Nominee
      pf_nominee: pf.nominee_name ? {
        name: pf.nominee_name,
        relationship: pf.nominee_relationship,
        date_of_birth: pf.nominee_date_of_birth || undefined,
        share_percentage: toNum(pf.share_percentage),
      } : undefined,
      // Insurance Policies
      insurance_policies: ins.length > 0 ? ins.map(ip => ({
        insurance_type: ip.insurance_type,
        insurer_name: ip.insurer_name,
        policy_number: ip.policy_number,
        sum_insured: toNum(ip.sum_insured),
        validity_date: ip.validity_date || undefined,
        nominee_name: ip.nominee_name,
        nominee_relationship: ip.nominee_relationship,
        nominee_date_of_birth: ip.nominee_date_of_birth || undefined,
      })) : undefined,
    };

    // Create employee record (without user_id — will be linked later via automation)
    let createdEmployee;
    try {
      createdEmployee = await withRetry(() => base44.asServiceRole.entities.Employee.create(employeeRecord));
    } catch (e) {
      importResults.push({ email, status: 'error', error: `Employee create failed: ${e.message}` });
      continue;
    }

    // Create salary structure if present
    if (sal) {
      try {
        const salData = {
          effective_from: sal.effective_from,
          ctc: toNum(sal.ctc),
          basic_salary: toNum(sal.basic_salary),
          hra: toNum(sal.hra),
          conveyance: toNum(sal.conveyance),
          medical: toNum(sal.medical),
          special_allowance: toNum(sal.special_allowance),
          lta: toNum(sal.lta),
          performance_bonus: toNum(sal.performance_bonus),
          pf_contribution: toNum(sal.pf_contribution),
          employer_pf_contribution: toNum(sal.employer_pf_contribution),
          esi_contribution: toNum(sal.esi_contribution),
          employer_esi_contribution: toNum(sal.employer_esi_contribution),
          professional_tax: toNum(sal.professional_tax),
          gratuity: toNum(sal.gratuity),
          gratuity_eligible: toBool(sal.gratuity_eligible !== '' ? sal.gratuity_eligible : 'TRUE'),
          insurance_premium: toNum(sal.insurance_premium),
          status: sal.status || 'active',
          _pending_email: email,
        };
        await withRetry(() => base44.asServiceRole.entities.SalaryStructure.create(salData));
      } catch (e) {
        importResults.push({ email, status: 'warning', msg: `Salary structure failed: ${e.message}` });
      }
    }

    // Create leave balances if present
    for (const lv of lvs) {
      const policy = policyByCode[lv.leave_policy_code];
      if (!policy) continue;
      const available = toNum(lv.total_allocated) + toNum(lv.carried_forward) - toNum(lv.used);
      try {
        const lvData = {
          leave_policy_id: policy.id,
          year: toNum(lv.year) || new Date().getFullYear(),
          total_allocated: toNum(lv.total_allocated),
          accrued_this_year: toNum(lv.accrued_this_year),
          used: toNum(lv.used),
          pending_approval: 0,
          available: available,
          carried_forward: toNum(lv.carried_forward),
          last_accrual_month: toNum(lv.last_accrual_month),
          last_accrual_year: toNum(lv.last_accrual_year),
          _pending_email: email,
        };
        await withRetry(() => base44.asServiceRole.entities.LeaveBalance.create(lvData));
      } catch (e) {
        // ignore individual leave balance errors
      }
    }

    // ----- CREATE USER ACCOUNT & LINK RECORDS IMMEDIATELY -----
    let userId = null;
    let accountStatus = 'created';
    let accountNote = '';

    // Step 1: Check if user account already exists
    try {
      const existingUsers = await withRetry(() => base44.asServiceRole.entities.User.filter({ email }));
      if (existingUsers.length > 0) {
        userId = existingUsers[0].id;
        accountStatus = 'already_exists';
        accountNote = 'Account already existed';
      }
    } catch (_) {}

    // Step 2: Create account via inviteUser if not found
    if (!userId) {
      try {
        await base44.users.inviteUser(email, 'user');
        // Small delay for the user record to be created
        await sleep(800);
        // Fetch the newly created user
        const newUsers = await withRetry(() => base44.asServiceRole.entities.User.filter({ email }));
        if (newUsers.length > 0) {
          userId = newUsers[0].id;
          accountStatus = 'created';
        } else {
          accountStatus = 'invite_failed';
          accountNote = 'Account created but could not fetch user ID';
        }
      } catch (e) {
        const msg = e.message || String(e) || '';
        const statusCode = e.status || e.statusCode || e.response?.status || '';
        console.log(`inviteUser error for ${email}: [${statusCode}] "${msg}"`);
        // Try one more time to find the user (race condition)
        try {
          const retryUsers = await withRetry(() => base44.asServiceRole.entities.User.filter({ email }));
          if (retryUsers.length > 0) {
            userId = retryUsers[0].id;
            accountStatus = 'created';
            accountNote = 'Account created (recovered from invite error)';
          } else {
            accountStatus = 'invite_failed';
            accountNote = `[${statusCode}] ${msg}`;
          }
        } catch (_) {
          accountStatus = 'invite_failed';
          accountNote = `[${statusCode}] ${msg}`;
        }
      }
    }

    // Step 3: Link all records immediately if we have a userId
    if (userId) {
      try {
        // Link employee record
        await withRetry(() => base44.asServiceRole.entities.Employee.update(createdEmployee.id, { user_id: userId }));

        // Set role from Excel sheet
        const systemRole = empRole === 'employee' ? 'user' : empRole;
        await withRetry(() => base44.asServiceRole.entities.User.update(userId, { role: systemRole, custom_role: empRole }));
      } catch (linkErr) {
        console.error(`Linking error for ${email}:`, linkErr.message);
        accountNote = accountNote ? accountNote + '; Link failed' : 'Link failed';
      }

      // Link salary structure
      try {
        const pendingSalary = await withRetry(() => base44.asServiceRole.entities.SalaryStructure.filter({ _pending_email: email }));
        for (const ss of pendingSalary) {
          await withRetry(() => base44.asServiceRole.entities.SalaryStructure.update(ss.id, { user_id: userId, _pending_email: null }));
        }
      } catch (_) {}

      // Link leave balances
      try {
        const pendingLeave = await withRetry(() => base44.asServiceRole.entities.LeaveBalance.filter({ _pending_email: email }));
        for (const lb of pendingLeave) {
          await withRetry(() => base44.asServiceRole.entities.LeaveBalance.update(lb.id, { user_id: userId, _pending_email: null }));
        }
      } catch (_) {}
    }

    importResults.push({
      email,
      employee_code: emp.employee_code,
      name: displayName || email,
      status: accountStatus,
      note: accountNote || undefined,
      employee_id: createdEmployee.id,
      user_id: userId || null,
    });

    // Throttle to avoid rate limiting (400ms between employees)
    await sleep(400);
  }

  return Response.json({ success: true, results: importResults, total: importResults.length });
});