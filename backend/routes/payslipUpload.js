// Bulk payslip PDF upload — HR/Admin uploads a batch of password-protected
// PDFs (one per employee, filename = Employee Code, password = Employee
// Code) for a chosen payroll month/year. Each file is: matched to an
// Employee by filename, decrypted with pdf-parse (which supports encrypted
// PDFs natively — no separate decryption library needed), text-extracted,
// parsed into structured payroll fields via best-effort regex, and written
// into the SAME `Payroll` entity every other part of the app already reads
// (Payslips.jsx, PayrollAnalytics.jsx, loans, F&F, exit settlement) rather
// than a disconnected parallel store — per explicit product decision.
//
// A Payroll record created this way starts at status='processed' (same as
// the app's own payroll engine) — NOT 'paid' — so it stays invisible to the
// employee (Payslips.jsx only shows status='paid') until HR explicitly
// releases it via the releasePayslips case in functions.js. This gives HR a
// review window between "uploaded & extracted" and "visible to employee",
// which is also where the "flag discrepancies, don't silently insert
// questionable data" requirement is enforced.
import { Router } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { one, all, run } from '../db.js';
import { JWT_SECRET } from './auth.js';
import { isBucketConfigured, buildKey, putToBucket, presignGet } from '../utils/bucket.js';
import { extractPayslipFields, monthMismatch } from '../utils/payslipExtract.js';

const router = Router();

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 500 }, // 15MB/file — a text payslip PDF is tiny; guards against an accidental non-payslip upload
});

function getUser(req) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}

async function requireHR(req, res) {
  const cu = getUser(req);
  if (!cu) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const u = await one('SELECT role, custom_role FROM users WHERE id=$1', [cu.id]);
  const role = u?.custom_role || u?.role;
  if (!['hr', 'admin'].includes(role)) { res.status(403).json({ error: 'HR/Admin access required' }); return null; }
  return cu;
}

// ── One batch = one upload operation (a month's worth of files) ──────────
router.post('/', memUpload.array('files', 500), async (req, res) => {
  const cu = await requireHR(req, res);
  if (!cu) return;

  const month = parseInt(req.body.month, 10);
  const year = parseInt(req.body.year, 10);
  const replaceExisting = req.body.replace_existing === 'true';
  if (!month || month < 1 || month > 12 || !year) {
    return res.status(400).json({ error: 'Valid month (1-12) and year are required' });
  }
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const { PDFParse, PasswordException } = await import('pdf-parse');

  const empRows = await all("SELECT user_id,data FROM entities WHERE type='Employee'");
  const empByCode = new Map();
  for (const row of empRows) {
    const d = JSON.parse(row.data);
    if (d.employee_code) empByCode.set(String(d.employee_code).trim().toUpperCase(), { ...d, user_id: row.user_id });
  }
  const existingPayrollRows = await all(
    "SELECT user_id,id FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2",
    [String(month), String(year)]
  );
  const existingByUser = new Map(existingPayrollRows.map(r => [r.user_id, r.id]));

  // Previous month's net salary per employee, for the "unexpected salary
  // variance" check — a >40% swing either direction is unusual enough to be
  // worth a human glance (a genuine raise/LOP/exit can cause it, but so can
  // a mis-extracted figure) without being noisy for normal month-to-month drift.
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPayrollRows = await all(
    "SELECT user_id,data FROM entities WHERE type='Payroll' AND data::jsonb->>'month'=$1 AND data::jsonb->>'year'=$2",
    [String(prevMonth), String(prevYear)]
  );
  const prevNetByUser = new Map(prevPayrollRows.map(r => [r.user_id, JSON.parse(r.data).net_salary]));

  const batchId = uuidv4();
  const results = [];
  const counts = { total: files.length, mapped: 0, unmapped: 0, duplicate: 0, invalid: 0, password_failed: 0, extraction_failed: 0 };

  for (const file of files) {
    const codeGuess = String(file.originalname || '').replace(/\.pdf$/i, '').trim().toUpperCase();
    const fileResult = {
      id: uuidv4(), batch_id: batchId, filename: file.originalname, employee_code: codeGuess,
      status: null, error: null, warnings: [], user_id: null, employee_name: null,
      payroll_id: null, file_url: null,
    };

    const emp = empByCode.get(codeGuess);
    if (!emp) {
      fileResult.status = 'unmapped';
      fileResult.error = `No employee found with code "${codeGuess}"`;
      // Persist the bytes so HR can later manually resolve this file to a
      // chosen employee (resolvePayslipUploadFile in functions.js) without
      // needing to re-upload — otherwise this buffer is lost once the request ends.
      try {
        if (isBucketConfigured()) {
          const key = buildKey(`payslips/_unmapped/${batchId}/${fileResult.id}`, '.pdf');
          await putToBucket(key, file.buffer, 'application/pdf');
          fileResult.file_url = await presignGet(key, { expiresIn: 31536000, filename: file.originalname });
        } else {
          fileResult.file_base64 = file.buffer.toString('base64');
        }
      } catch (e) { console.warn('[payslip-upload] unmapped storage failed:', e.message); fileResult.file_base64 = file.buffer.toString('base64'); }
      counts.unmapped++;
      results.push(fileResult);
      continue;
    }
    fileResult.user_id = emp.user_id;
    fileResult.employee_name = emp.display_name || '';

    if (emp.status !== 'active') {
      fileResult.warnings.push(`Employee status is "${emp.status}", not active`);
    }

    // Duplicate check — a Payroll record already exists for this
    // employee+month+year. Skipped (not overwritten) unless HR explicitly
    // opted into replace_existing for this whole batch.
    const existingPayrollId = existingByUser.get(emp.user_id);
    if (existingPayrollId && !replaceExisting) {
      fileResult.status = 'duplicate';
      fileResult.error = 'A payroll record already exists for this employee/month/year — re-upload with "replace existing" to overwrite';
      fileResult.payroll_id = existingPayrollId;
      counts.duplicate++;
      results.push(fileResult);
      continue;
    }

    // Decrypt + extract text — pdf-parse natively supports password-protected
    // PDFs (LoadParameters.password), so no separate decryption step/library
    // is needed. The employee code IS the password; never surfaced to the
    // client (only success/failure is reported, and no password value is
    // ever included in the batch/file rows or API responses).
    let text = '';
    const parser = new PDFParse({ data: file.buffer, password: codeGuess });
    try {
      const result = await parser.getText();
      text = result.text || '';
    } catch (e) {
      if (e instanceof PasswordException) {
        fileResult.status = 'password_failed';
        fileResult.error = 'Could not unlock this PDF with the employee code — check the file is genuinely locked with that code';
        counts.password_failed++;
      } else {
        fileResult.status = 'invalid';
        fileResult.error = 'Could not read this PDF (corrupted or not a valid PDF): ' + e.message;
        counts.invalid++;
      }
      results.push(fileResult);
      try { await parser.destroy(); } catch {}
      continue;
    }
    try { await parser.destroy(); } catch {}

    if (!text.trim()) {
      fileResult.status = 'extraction_failed';
      fileResult.error = 'PDF unlocked but no readable text was found (likely a scanned image, not a text PDF)';
      counts.extraction_failed++;
      results.push(fileResult);
      continue;
    }

    const extracted = extractPayslipFields(text);

    // Validation — flag, don't silently trust. Cross-check whatever the
    // document itself claims against what we already know from the
    // filename/Employee record.
    if (extracted.employee_code_in_doc && extracted.employee_code_in_doc.toUpperCase().replace(/[^A-Z0-9]/g, '') !== codeGuess.replace(/[^A-Z0-9]/g, '')) {
      fileResult.warnings.push(`Employee code in document ("${extracted.employee_code_in_doc}") doesn't match the filename ("${codeGuess}")`);
    }
    if (extracted.employee_name && emp.display_name &&
        !extracted.employee_name.toLowerCase().includes(emp.display_name.toLowerCase().split(' ')[0])) {
      fileResult.warnings.push(`Employee name in document ("${extracted.employee_name}") doesn't obviously match the employee record ("${emp.display_name}")`);
    }
    if (extracted.net_salary == null) fileResult.warnings.push('Could not extract Net Salary — review the record before releasing it');
    if (extracted.gross_salary == null) fileResult.warnings.push('Could not extract Gross Salary — review the record before releasing it');

    const monthWarning = monthMismatch(extracted.payroll_month_in_doc, month, year);
    if (monthWarning) fileResult.warnings.push(monthWarning);

    const prevNet = prevNetByUser.get(emp.user_id);
    if (prevNet != null && prevNet > 0 && extracted.net_salary != null) {
      const variancePct = Math.abs(extracted.net_salary - prevNet) / prevNet * 100;
      if (variancePct > 40) {
        fileResult.warnings.push(`Net salary (₹${extracted.net_salary.toLocaleString('en-IN')}) differs by ${variancePct.toFixed(0)}% from last month (₹${prevNet.toLocaleString('en-IN')}) — verify before releasing`);
      }
    }

    fileResult.gross_salary = extracted.gross_salary ?? null;
    fileResult.net_salary = extracted.net_salary ?? null;

    // Store the (now-decrypted-in-memory) PDF securely — private bucket with
    // a long-lived presigned URL, same pattern used for offer letters/exit
    // documents elsewhere in this app; never a publicly-guessable path, and
    // the raw employee-code password is never written anywhere.
    let fileUrl = null, base64 = null;
    try {
      if (isBucketConfigured()) {
        const key = buildKey(`payslips/${emp.user_id}/${year}-${String(month).padStart(2, '0')}`, '.pdf');
        await putToBucket(key, file.buffer, 'application/pdf');
        fileUrl = await presignGet(key, { expiresIn: 31536000, filename: `Payslip_${codeGuess}_${year}-${month}.pdf` });
      } else {
        base64 = file.buffer.toString('base64');
      }
    } catch (e) { console.warn('[payslip-upload] storage failed:', e.message); base64 = file.buffer.toString('base64'); }
    fileResult.file_url = fileUrl;

    // Write into the actual Payroll entity — same shape processPayroll
    // produces (see functions.js), plus the source PDF reference. Overwrites
    // in place when replacing an existing record so history/ids stay stable.
    const now = new Date().toISOString();
    const payrollData = {
      id: existingPayrollId || uuidv4(), user_id: emp.user_id, month, year,
      basic_salary: extracted.basic_salary ?? 0, hra: extracted.hra ?? 0, conveyance: extracted.conveyance ?? 0,
      special_allowance: extracted.special_allowance ?? 0, gross_salary: extracted.gross_salary ?? 0,
      deductions: {
        pf: extracted.pf ?? 0, esi: extracted.esi ?? 0, lop: 0, tds: extracted.tds ?? 0, loan: extracted.loan_deduction ?? 0,
        professional_tax: extracted.professional_tax ?? 0, other: extracted.other_deductions ?? 0,
      },
      employer_contributions: { pf: extracted.employer_pf ?? 0, esi: extracted.employer_esi ?? 0 },
      total_deductions: extracted.total_deductions ?? 0, net_salary: extracted.net_salary ?? 0,
      working_days: extracted.payable_days ?? null, present_days: extracted.present_days ?? null,
      loss_of_pay_days: extracted.lop_days ?? 0, loss_of_pay_amount: 0,
      incentive: extracted.incentive ?? 0, overtime: extracted.overtime ?? 0, bonus: extracted.bonus ?? 0,
      status: 'processed', processed_by: cu.id, processed_at: now,
      employee_code: emp.employee_code, department: emp.department || null, designation: emp.designation || null,
      payslip_source: 'bulk_upload', payslip_file_url: fileUrl, payslip_file_base64: base64 || undefined,
      payslip_upload_batch_id: batchId, payslip_uploaded_by: cu.id, payslip_uploaded_at: now,
      payslip_extraction_warnings: fileResult.warnings,
    };
    if (existingPayrollId) {
      await run("UPDATE entities SET data=$1,updated_at=NOW()::TEXT WHERE id=$2", [JSON.stringify(payrollData), existingPayrollId]);
    } else {
      await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'Payroll',$2,'processed',$3)", [payrollData.id, emp.user_id, JSON.stringify(payrollData)]);
    }
    fileResult.payroll_id = payrollData.id;
    fileResult.status = fileResult.warnings.length ? 'mapped_needs_review' : 'mapped';
    counts.mapped++;
    results.push(fileResult);
  }

  const batch = {
    id: batchId, month, year, uploaded_by: cu.id, uploaded_at: new Date().toISOString(),
    counts, files: results,
  };
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'PayslipUploadBatch',$2,'completed',$3)", [batchId, cu.id, JSON.stringify(batch)]);

  return res.json({ success: true, batch_id: batchId, counts, files: results });
});

export default router;
