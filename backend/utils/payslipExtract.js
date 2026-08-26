// Shared best-effort regex extraction of structured payroll fields from a
// decrypted payslip PDF's linearized text. Used by both routes/payslipUpload.js
// (bulk upload) and the resolvePayslipUploadFile case in routes/functions.js
// (manual single-file resolution) so the two paths never drift apart.
const NUMERIC_FIELDS = [
  ['gross_salary', ['gross salary', 'gross pay', 'gross earnings']],
  ['basic_salary', ['basic salary', 'basic pay', '\\bbasic\\b']],
  ['hra', ['house rent allowance', '\\bhra\\b']],
  ['conveyance', ['conveyance allowance', '\\bconveyance\\b', 'transport allowance']],
  ['special_allowance', ['special allowance', 'other allowance', 'allowances']],
  ['incentive', ['incentive', 'performance bonus']],
  ['overtime', ['overtime', '\\bot\\b amount', 'ot pay']],
  ['bonus', ['\\bbonus\\b(?! eligible)']],
  ['pf', ['provident fund', '\\bepf\\b', '\\bpf\\b(?! contribution)']],
  ['esi', ['\\besic?\\b']],
  ['professional_tax', ['professional tax', '\\bpt\\b']],
  ['tds', ['\\btds\\b', 'income tax', 'tax deducted']],
  ['loan_deduction', ['loan deduction', 'advance deduction', 'loan/advance']],
  ['other_deductions', ['other deduction']],
  ['total_deductions', ['total deduction']],
  ['net_salary', ['net salary', 'net pay', 'take home', 'net amount']],
  ['payable_days', ['payable days', 'pay days']],
  ['present_days', ['present days', 'days present', 'days worked']],
  ['lop_days', ['loss of pay days', '\\blop\\b days', 'lop\\b']],
  ['employer_pf', ['employer pf', 'employer.{0,3}s? contribution.{0,20}pf']],
  ['employer_esi', ['employer esi', 'employer.{0,3}s? contribution.{0,20}esi']],
];
const TEXT_FIELDS = [
  ['employee_code_in_doc', ['employee code', 'emp code', 'employee id', '\\bemp\\.? id\\b']],
  ['employee_name', ['employee name', '\\bname\\b']],
  ['department', ['\\bdepartment\\b', '\\bdept\\b']],
  ['designation', ['\\bdesignation\\b', '\\bdesignation/title\\b']],
  ['payroll_month_in_doc', ['pay(?:roll)? (?:period|month)', 'salary month', 'month of salary']],
];

export function extractPayslipFields(text) {
  const fields = {};
  const flat = text.replace(/\r/g, '');
  for (const [key, labels] of NUMERIC_FIELDS) {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:\\-]?\\s*(?:rs\\.?|inr|\u20b9)?\\s*([\\d,]+(?:\\.\\d+)?)`, 'i');
      const m = flat.match(re);
      if (m) { fields[key] = Number(m[1].replace(/,/g, '')); break; }
    }
  }
  for (const [key, labels] of TEXT_FIELDS) {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n\\r]{2,60})`, 'i');
      const m = flat.match(re);
      if (m) { fields[key] = m[1].trim(); break; }
    }
  }
  return fields;
}
