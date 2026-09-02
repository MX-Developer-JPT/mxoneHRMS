// Shared best-effort regex extraction of structured payroll fields from a
// decrypted payslip PDF's linearized text. Used by both routes/payslipUpload.js
// (bulk upload) and the resolvePayslipUploadFile case in routes/functions.js
// (manual single-file resolution) so the two paths never drift apart.
//
// Real payslip PDFs are usually tables (label and amount in separate cells).
// pdf-parse linearizes those into plain text, and depending on the PDF's
// internal content-stream order the amount can land on the SAME line as its
// label, on the NEXT line, or several cells away with other tokens
// in-between — there is no single layout to target. So label matching tries,
// in order: (1) same line as the label, (2) the very next line, (3) as a
// last resort for net/gross specifically, the largest number found on ANY
// line that mentions the right keywords. This is deliberately layered so a
// legitimate but unusually-formatted payslip still yields values instead of
// forcing every upload into manual review.
//
// Verified against real MaxVolt payslips (income-tax-software generated):
// the earnings table has header "EARNINGS ACTUAL EARNED ARREAR YTD" — a row
// like "BASIC SALARY 13,690 10,039 34,262" means Actual=13,690 (full
// contractual), Earned=10,039 (this month's LOP-adjusted actual), YTD=34,262
// — no Arrear this month. Storing "Actual" would overstate pay whenever LOP
// applies, so earnings rows deliberately take the 2nd number (Earned) when
// 2+ numbers are present, not the 1st. Deduction rows ("DEDUCTION YTD"
// header, e.g. "PROVIDENT FUND 1,800 5,400") take the 1st number (this
// month's deduction, not the YTD running total).
const NUMERIC_FIELDS = [
  ['gross_salary', ['gross salary', 'gross pay', 'gross earnings', 'total gross earnings', 'gross total', 'total earnings', 'earnings total'], 'first'],
  ['basic_salary', ['basic salary', 'basic pay', '\\bbasic\\b'], 'earnings'],
  ['hra', ['house rent allowance', '\\bhra\\b'], 'earnings'],
  ['conveyance', ['conveyance allowance', '\\bconveyance\\b', 'transport allowance'], 'earnings'],
  // Basic/HRA/conveyance are fixed contractual components: the payslip
  // prints [Actual, Earned, (Arrear), YTD] and we want Earned (mode
  // 'earnings' → 2nd number). Ad-hoc/variable pay items below have no
  // "Actual" baseline — the payslip prints only [ThisMonth, YTD], so mode
  // 'first' (1st number) is the correct one here, NOT 'earnings' — verified
  // against real payslips where using 'earnings' silently grabbed the YTD
  // total instead of this month's figure.
  ['special_allowance', ['special allowance', 'other allowance', 'allowances'], 'first'],
  ['incentive', ['\\bincentive\\b'], 'first'],
  ['overtime', ['overtime', '\\bot\\b amount', 'ot pay'], 'first'],
  // 'bonus' is summed across every matching line separately below (real
  // payslips can carry more than one bonus-type row, e.g. "REFERRAL BONUS"
  // + "PERFORMANCE BONUS" — a single first-match would silently drop one).
  ['pf', ['provident fund', '\\bepf\\b', '\\bpf\\b(?!\\s*(?:no\\.?|number|contribution))'], 'first'],
  ['esi', ['\\besic?\\b(?!\\s*(?:no\\.?|number))'], 'first'],
  ['professional_tax', ['professional tax', '\\bpt\\b'], 'first'],
  ['tds', ['\\bincome tax\\b(?!\\s*worksheet)', '\\btds\\b', 'tax deducted'], 'first'],
  ['loan_deduction', ['loan deduction', 'advance deduction', 'loan/advance', 'salary advance'], 'first'],
  ['other_deductions', ['other deduction'], 'first'],
  ['total_deductions', ['total deduction', 'total deductions'], 'first'],
  ['net_salary', ['net salary', 'net pay', 'take home', 'net amount', 'net amount payable', 'amount payable', 'total net payable', 'net salary payable', 'take home salary', 'net earnings', 'net payable'], 'first'],
  ['payable_days', ['payable days', 'pay\\s*days'], 'first'],
  ['present_days', ['present days', 'days present', 'days worked'], 'first'],
  ['lop_days', ['loss of pay days', 'lwp days', '\\blop\\b days', 'lop\\b'], 'first'],
  ['employer_pf', ['employer pf', 'employer.{0,3}s? contribution.{0,20}pf'], 'first'],
  ['employer_esi', ['employer esi', 'employer.{0,3}s? contribution.{0,20}esi'], 'first'],
];
const TEXT_FIELDS = [
  ['employee_code_in_doc', ['employee code', 'emp code', 'employee id', '\\bemp\\.? id\\b']],
  ['employee_name', ['employee name', '\\bname\\b']],
  ['department', ['\\bdepartment\\b', '\\bdept\\b']],
  ['designation', ['\\bdesignation\\b', '\\bdesignation/title\\b']],
  ['payroll_month_in_doc', ['for the month of', 'salary for the month', 'pay(?:roll)? period', 'salary month', 'month of salary']],
];

// Must start with a digit (not a bare comma) — but otherwise allow a single
// digit through (e.g. "0" for a zero deduction, "8" for LWP days). An
// earlier {2,}-char floor silently skipped exactly these values, which made
// the label/number pairing fall through to the WRONG number on a later line.
const NUM = '-?\\d[\\d,]*(?:\\.\\d{1,2})?';

// Numbers found on the label's own line (after the label) — or, if none,
// on the very next line — in left-to-right order as printed.
function numbersAfterLabel(flat, label) {
  const labelRe = new RegExp(`${label}[:\\-]?`, 'i');
  const m = flat.match(labelRe);
  if (!m) return null;
  const afterLabel = flat.slice(m.index + m[0].length);
  const restOfLine = afterLabel.split(/\r?\n/)[0];
  let nums = [...restOfLine.matchAll(new RegExp(NUM, 'g'))].map(x => x[0]);
  if (nums.length) return nums;
  const nextLine = afterLabel.split(/\r?\n/)[1];
  if (nextLine) {
    nums = [...nextLine.matchAll(new RegExp(NUM, 'g'))].map(x => x[0]);
    if (nums.length) return nums;
  }
  return null;
}

const toNum = (s) => Number(s.replace(/,/g, ''));

// Returns a NUMBER (not a string) since 'earnings' mode with an Arrear
// column has to add two of the matched tokens together.
function pickNumber(nums, mode) {
  if (!nums || !nums.length) return null;
  if (mode === 'earnings') {
    // [Actual, Earned, Arrear, YTD] — verified against real payslips that
    // TOTAL EARNINGS = sum(Earned + Arrear) per row, not sum(Earned) alone:
    // the Arrear is a signed adjustment actually reflected in this month's
    // payout (e.g. a correction from a prior month), not a separate/deferred
    // amount. Using Earned alone silently overstated gross whenever a
    // nonzero arrear was present.
    if (nums.length >= 4) return toNum(nums[1]) + toNum(nums[2]);
    if (nums.length === 3) return toNum(nums[1]); // [Actual, Earned, YTD] — no arrear this month
    // [Actual, Earned] — a payslip layout with no YTD column still prints
    // both figures; this previously fell through to nums[0] (Actual),
    // silently overstating this row exactly whenever LOP made Actual and
    // Earned differ. Earned (nums[1]) is still the 2nd number here.
    if (nums.length === 2) return toNum(nums[1]);
    // A single bare number really does mean the layout only prints one
    // figure for this row at all (no Actual/Earned split) — that number IS
    // the value, not a "Actual we should've ignored."
    return toNum(nums[0]);
  }
  return toNum(nums[0]);
}

// Sums the 'first' number across every line matching labelRe — used for
// fields that can legitimately appear as more than one row (bonus).
function sumMatchingLines(flat, labelRe) {
  let total = 0, found = false;
  for (const line of flat.split(/\r?\n/)) {
    if (!labelRe.test(line)) continue;
    const nums = [...line.matchAll(new RegExp(NUM, 'g'))].map(x => x[0]);
    const val = pickNumber(nums, 'first');
    if (val != null) { total += val; found = true; }
  }
  return found ? total : null;
}

// Last-resort scan for net/gross salary: find every line that plausibly
// talks about the right total and take the largest number on it (the
// total is virtually always the largest figure on its own line/cell run).
function fallbackAmount(flat, mustInclude) {
  const lines = flat.split(/\r?\n/);
  let best = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!mustInclude.every(kw => lower.includes(kw))) continue;
    const nums = [...line.matchAll(new RegExp(NUM, 'g'))].map(m => Number(m[0].replace(/,/g, '')));
    if (!nums.length) continue;
    const candidate = Math.max(...nums);
    if (best == null || candidate > best) best = candidate;
  }
  return best;
}

export function extractPayslipFields(text) {
  const fields = {};
  let flat = text.replace(/\r/g, '');
  // The generator used by this payroll system emits multiple documents in
  // one PDF — the payslip itself, then a Reimbursement Slip and/or an
  // Income Tax Worksheet on later pages, each restating EMPLOYEE ID/NAME
  // and containing their own unrelated "INCOME TAX ..." figures. Extracting
  // from the whole file risks pulling a number from the tax worksheet
  // instead of the payslip — restrict to the first page (up to the
  // "-- 1 of N --" page-break marker pdf-parse inserts) when present.
  const pageBreak = flat.match(/--\s*\d+\s*of\s*\d+\s*--/i);
  if (pageBreak) flat = flat.slice(0, pageBreak.index);
  for (const [key, labels, mode] of NUMERIC_FIELDS) {
    for (const label of labels) {
      const nums = numbersAfterLabel(flat, label);
      const val = pickNumber(nums, mode);
      if (val != null) { fields[key] = val; break; }
    }
  }
  const bonusTotal = sumMatchingLines(flat, /\bbonus\b(?!\s*eligible)/i);
  if (bonusTotal != null) fields.bonus = bonusTotal;
  if (fields.net_salary == null) {
    const v = fallbackAmount(flat, ['net']) ?? fallbackAmount(flat, ['take', 'home']);
    if (v != null) fields.net_salary = v;
  }
  if (fields.gross_salary == null) {
    const v = fallbackAmount(flat, ['gross']) ?? fallbackAmount(flat, ['total', 'earning']);
    if (v != null) fields.gross_salary = v;
  }
  // Real payslips from this generator can carry many more earnings rows
  // than NUMERIC_FIELDS enumerates by name — GWI, LTA Allowance, Books,
  // Gym, Car Maintenance, Hard Furnishing, Education Allowance, Personal
  // Pay, and others seen in practice, with more likely to appear as pay
  // structures change. Rather than chase every possible label (fragile,
  // and silently wrong again the next time HR adds a new allowance type),
  // fold whatever isn't individually itemized into special_allowance so
  // basic+hra+conveyance+special_allowance+incentive+overtime+bonus always
  // reconciles to the payslip's own printed Total Earnings — verified
  // against real payslips where the itemized components alone summed to
  // barely 60% of gross, silently dropping the rest.
  if (fields.gross_salary != null) {
    const itemizedSum = (fields.basic_salary || 0) + (fields.hra || 0) + (fields.conveyance || 0)
      + (fields.special_allowance || 0) + (fields.incentive || 0) + (fields.overtime || 0) + (fields.bonus || 0);
    const residual = fields.gross_salary - itemizedSum;
    if (residual !== 0) fields.special_allowance = (fields.special_allowance || 0) + residual;
  }
  // Same reconciliation on the deductions side — e.g. "LOAN AND ADVANCES"
  // (seen on real payslips) isn't one of loan_deduction's matched label
  // variants, silently dropping it from total_deductions' itemized
  // breakdown even though total_deductions itself (read straight off its
  // own printed line) was already correct.
  if (fields.total_deductions != null) {
    const itemizedDed = (fields.pf || 0) + (fields.esi || 0) + (fields.professional_tax || 0)
      + (fields.tds || 0) + (fields.loan_deduction || 0) + (fields.other_deductions || 0);
    const dedResidual = fields.total_deductions - itemizedDed;
    if (dedResidual !== 0) fields.other_deductions = (fields.other_deductions || 0) + dedResidual;
  }
  for (const [key, labels] of TEXT_FIELDS) {
    for (const label of labels) {
      // Real payslips (e.g. "EMPLOYEE ID MVE00002") often have no
      // colon/dash between label and value at all — space-separated only —
      // so the separator here is optional, matching the numeric side.
      const re = new RegExp(`${label}[:\\-]?\\s*([^\\n\\r]{2,60})`, 'i');
      const m = flat.match(re);
      if (m) { fields[key] = m[1].trim(); break; }
    }
  }
  return fields;
}

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

// Spec: "incorrect payroll month" — the document itself may print a
// different period than what HR selected for this batch (wrong file
// re-uploaded under the wrong month, generator mistake, etc.). Best-effort:
// the extracted text is free-form ("JUNE 2026", "06/2026", "Jun-26" are all
// plausible), so this only flags when it can positively identify a DIFFERENT
// month or year — it never flags when the text is ambiguous or unparsed,
// since a false positive here would train HR to ignore the warning.
export function monthMismatch(docText, expectedMonth, expectedYear) {
  if (!docText) return null;
  const lower = docText.toLowerCase();
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const docYear = yearMatch ? Number(yearMatch[1]) : null;
  let docMonth = null;
  const numericMatch = lower.match(/\b(0?[1-9]|1[0-2])[\/\-]\d{2,4}\b/);
  if (numericMatch) docMonth = Number(numericMatch[1]);
  else {
    const idx = MONTH_NAMES.findIndex(m => lower.includes(m) || lower.includes(m.slice(0, 3)));
    if (idx >= 0) docMonth = idx + 1;
  }
  if (docMonth == null && docYear == null) return null;
  if (docMonth != null && docMonth !== expectedMonth) return `Document appears to be for month ${docMonth}, not the selected ${expectedMonth}`;
  if (docYear != null && docYear !== expectedYear) return `Document appears to be for year ${docYear}, not the selected ${expectedYear}`;
  return null;
}
