import { openLetterheadPrintWindow } from './letterhead.js';

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function fmt(val) {
  return (parseFloat(val) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numToWords(num) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (num === 0) return 'Zero';
  const inWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
    if (n < 100000) return inWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + inWords(n % 1000) : '');
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + inWords(n % 100000) : '');
    return inWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + inWords(n % 10000000) : '');
  };
  return inWords(Math.round(num)) + ' Rupees Only';
}

export function openPayslipPrintWindow({ payroll, employee, empUser, salaryStructure, bonuses = [] }) {
  const deductions = payroll.deductions || {};
  const allowances = payroll.allowances || {};

  // Fixed (from salary structure)
  const basicFixed = salaryStructure.basic_salary || 0;
  const hraFixed = salaryStructure.hra || 0;
  const conveyanceFixed = salaryStructure.conveyance || 0;
  const bonusFixed = salaryStructure.performance_bonus || 0;
  const grossFixed = basicFixed + hraFixed + conveyanceFixed;

  // Present/Working days for pro-rata
  const workingDays = payroll.working_days || 26;
  const presentDays = payroll.present_days || workingDays;
  const leaveDays = payroll.leave_days || 0;
  const lopDays = payroll.loss_of_pay_days || 0;

  const ratio = workingDays > 0 ? presentDays / workingDays : 1;

  // Earned = Fixed * (present / working)
  const basicEarned = payroll.basic_salary || Math.round(basicFixed * ratio);
  const hraEarned = Math.round(hraFixed * ratio);
  const conveyanceEarned = allowances.conveyance || Math.round(conveyanceFixed * ratio);
  const grossSalary = payroll.gross_salary || (basicEarned + hraEarned + conveyanceEarned);

  // Arrear (from payroll record if stored, else 0)
  const arrear = payroll.arrear || 0;

  // YTD — if stored in payroll, use it; else show current month
  const ytdGross = payroll.ytd_gross || grossSalary;
  const ytdNet = payroll.ytd_net || (payroll.net_salary || 0);

  const bonusBreakdown = bonuses.filter(b => b.amount > 0);
  const otherEarnings = payroll.bonuses || 0;

  // PF: always compute from basic if not stored (applicable to ESI employees as well)
  const pfBase = Math.min(basicEarned, 15000);
  const pfDeduction = deductions.pf != null ? deductions.pf : (salaryStructure.pf_contribution || Math.round(pfBase * 0.12));
  // ESI: only if basic <= ₹21,000; use payroll record if available
  const esiDeduction = deductions.esi != null ? deductions.esi : (basicEarned <= 21000 ? (salaryStructure.esi_contribution || Math.round(basicEarned * 0.0075)) : 0);
  const profTax = deductions.professional_tax || 0;
  const tdsDeduction = deductions.tds || 0;
  const loanEmi = deductions.loan_emi || 0;
  const totalDeductions = pfDeduction + esiDeduction + profTax + tdsDeduction + loanEmi;
  const netSalary = payroll.net_salary || (grossSalary - totalDeductions);

  const empPFBase = Math.min(basicEarned, 15000);
  const employerPF = payroll.employer_contributions?.pf ?? salaryStructure.employer_pf_contribution ?? Math.round(empPFBase * 0.13);
  const employerESI = payroll.employer_contributions?.esi ?? (basicEarned <= 21000 ? (salaryStructure.employer_esi_contribution || Math.round(basicEarned * 0.0325)) : 0);
  const gratuity = salaryStructure.gratuity || Math.round(basicEarned * 0.0481);

  const month = monthNames[(payroll.month || 1) - 1];
  const year = payroll.year;
  const payPeriod = `${month} ${year}`;

  // UAN / PF account
  const uanNumber = employee.uan_number || '—';
  const pfAccountNumber = employee.pf_account_number || '—';

  function earningRow(label, fixed, earned, ytd, arrearAmt) {
    if (!fixed && !earned) return '';
    return `<tr>
      <td class="td">${label}</td>
      <td class="td amt">${fmt(fixed)}</td>
      <td class="td amt">${fmt(earned)}</td>
      <td class="td amt">${fmt(arrearAmt || 0)}</td>
      <td class="td amt">${fmt(ytd || earned)}</td>
    </tr>`;
  }

  function dedRow(label, amount, alwaysShow = false) {
    if (!alwaysShow && !amount) return '';
    return `<tr><td class="td">${label}</td><td class="td amt" colspan="4">${fmt(amount)}</td></tr>`;
  }

  const contentHtml = `
    <div style="border:1.5px solid #e87722;border-radius:4px;overflow:hidden;margin-bottom:8px;">

      <!-- Slip title bar -->
      <div style="background:#e87722;color:white;padding:8px 16px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:15px;font-weight:bold;letter-spacing:1px;">SALARY SLIP</div>
        <div style="font-size:12px;opacity:0.9;">Pay Period: ${payPeriod}</div>
      </div>

      <!-- Employee details -->
      <div style="padding:10px 16px;border-bottom:1px solid #f3e9d8;background:#fffdf9;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 20px;">
          ${[
            ['Employee Name', employee.display_name || empUser.full_name || 'N/A'],
            ['Employee Code', employee.employee_code || 'N/A'],
            ['Date of Joining', employee.date_of_joining ? new Date(employee.date_of_joining).toLocaleDateString('en-IN') : 'N/A'],
            ['Designation', employee.designation || 'N/A'],
            ['Department', employee.department || 'N/A'],
            ['Employment Type', (employee.employment_type || 'full_time').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())],
            ['PAN Number', employee.pan_number || 'N/A'],
            ['UAN Number', uanNumber],
            ['PF Account No.', pfAccountNumber],
            ['Bank Account', employee.bank_account?.account_number ? '****' + employee.bank_account.account_number.slice(-4) : 'N/A'],
            ['ESI Number', employee.esi_number || '—'],
            ['Payment Status', `<span style="color:${payroll.status === 'paid' ? '#15803d' : '#d97706'};font-weight:bold;">${(payroll.status || 'PAID').toUpperCase()}</span>`],
          ].map(([l, v]) => `<div><div style="font-size:8px;color:#a07040;text-transform:uppercase;letter-spacing:0.3px;">${l}</div><div style="font-size:10.5px;font-weight:600;">${v}</div></div>`).join('')}
        </div>
      </div>

      <!-- Attendance -->
      <div style="display:flex;border-bottom:1px solid #f3e9d8;">
        ${[
          ['Working Days', workingDays, '#1a1a1a'],
          ['Present Days', presentDays, '#15803d'],
          ['Paid Leave', leaveDays, '#1d4ed8'],
          ['LOP Days', lopDays, lopDays > 0 ? '#dc2626' : '#6b7280'],
          ['Overtime Hrs', payroll.overtime_hours || 0, '#7c3aed'],
        ].map(([l, v, c]) => `
          <div style="flex:1;text-align:center;padding:7px 4px;border-right:1px solid #f3e9d8;">
            <div style="font-size:8px;color:#a07040;text-transform:uppercase;">${l}</div>
            <div style="font-size:17px;font-weight:bold;color:${c};">${v}</div>
          </div>`).join('')}
        <div style="flex:1;padding:7px 4px;"></div>
      </div>

      <!-- Earnings & Deductions -->
      <div style="display:flex;border-bottom:1px solid #f3e9d8;">
        <div style="flex:3;border-right:1px solid #f3e9d8;">
          <div style="background:#f6f8f1;padding:5px 12px;font-size:9.5px;font-weight:bold;text-transform:uppercase;color:#4d7c0f;border-bottom:1px solid #e5e7eb;">Earnings</div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f0f9e8;">
                <th class="td" style="text-align:left;font-size:8px;color:#6b7280;text-transform:uppercase;">Component</th>
                <th class="td amt" style="font-size:8px;color:#6b7280;text-transform:uppercase;">Fixed</th>
                <th class="td amt" style="font-size:8px;color:#6b7280;text-transform:uppercase;">Earned</th>
                <th class="td amt" style="font-size:8px;color:#6b7280;text-transform:uppercase;">Arrear</th>
                <th class="td amt" style="font-size:8px;color:#6b7280;text-transform:uppercase;">YTD</th>
              </tr>
            </thead>
            <tbody>
              ${earningRow('Basic Salary', basicFixed, basicEarned, ytdGross * (basicFixed / (grossFixed || 1)), 0)}
              ${earningRow('House Rent Allowance (HRA)', hraFixed, hraEarned, ytdGross * (hraFixed / (grossFixed || 1)), 0)}
              ${earningRow('Conveyance Allowance', conveyanceFixed, conveyanceEarned, ytdGross * (conveyanceFixed / (grossFixed || 1)), 0)}
              ${arrear > 0 ? `<tr><td class="td">Arrear</td><td class="td amt">—</td><td class="td amt">—</td><td class="td amt">${fmt(arrear)}</td><td class="td amt">${fmt(arrear)}</td></tr>` : ''}
              ${bonusBreakdown.length > 0
                ? bonusBreakdown.map(b => `<tr><td class="td">${(b.bonus_type || 'Bonus').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())} (${b.reason || 'Off-cycle'})</td><td class="td amt">—</td><td class="td amt">${fmt(b.amount)}</td><td class="td amt">—</td><td class="td amt">${fmt(b.amount)}</td></tr>`).join('')
                : (otherEarnings ? `<tr><td class="td">Performance Bonus</td><td class="td amt">${fmt(bonusFixed)}</td><td class="td amt">${fmt(otherEarnings)}</td><td class="td amt">—</td><td class="td amt">${fmt(otherEarnings)}</td></tr>` : '')}
            </tbody>
            <tfoot>
              <tr style="background:#f0fdf4;font-weight:bold;">
                <td class="td" style="color:#15803d;">Gross Earnings</td>
                <td class="td amt" style="color:#15803d;">₹${fmt(grossFixed)}</td>
                <td class="td amt" style="color:#15803d;">₹${fmt(grossSalary)}</td>
                <td class="td amt" style="color:#15803d;">₹${fmt(arrear)}</td>
                <td class="td amt" style="color:#15803d;">₹${fmt(ytdGross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style="flex:1.5;">
          <div style="background:#fff5f5;padding:5px 12px;font-size:9.5px;font-weight:bold;text-transform:uppercase;color:#dc2626;border-bottom:1px solid #e5e7eb;">Deductions</div>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>
              ${dedRow('Provident Fund (Employee 12%)', pfDeduction, true)}
              ${esiDeduction > 0 ? dedRow('ESI (Employee 0.75%)', esiDeduction) : ''}
              ${profTax ? dedRow('Professional Tax', profTax) : ''}
              ${tdsDeduction ? dedRow('Income Tax (TDS)', tdsDeduction) : ''}
              ${loanEmi ? dedRow('Loan EMI', loanEmi) : ''}
            </tbody>
            <tfoot>
              <tr style="background:#fef2f2;font-weight:bold;">
                <td class="td" style="color:#dc2626;">Total Deductions</td>
                <td class="td amt" style="color:#dc2626;" colspan="4">₹${fmt(totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Employer Contributions -->
      <div style="padding:8px 16px;background:#f0fdf4;border-bottom:1px solid #f3e9d8;">
        <div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;color:#15803d;margin-bottom:5px;">Employer Contributions (CTC Components — Not Deducted from Salary)</div>
        <div style="display:flex;gap:28px;">
          <div><div style="font-size:8px;color:#6b7280;text-transform:uppercase;">Employer PF (13%)</div><div style="font-size:11px;font-weight:600;color:#15803d;">₹${fmt(employerPF)}</div></div>
          ${employerESI > 0 ? `<div><div style="font-size:8px;color:#6b7280;text-transform:uppercase;">Employer ESI (3.25%)</div><div style="font-size:11px;font-weight:600;color:#15803d;">₹${fmt(employerESI)}</div></div>` : ''}
          <div><div style="font-size:8px;color:#6b7280;text-transform:uppercase;">Gratuity (4.81% of Basic)</div><div style="font-size:11px;font-weight:600;color:#15803d;">₹${fmt(gratuity)}</div></div>
          ${(salaryStructure.medical_contribution || 0) > 0 ? `<div><div style="font-size:8px;color:#6b7280;text-transform:uppercase;">Medical Contribution</div><div style="font-size:11px;font-weight:600;color:#15803d;">₹${fmt(salaryStructure.medical_contribution)}</div></div>` : ''}
        </div>
      </div>

      <!-- Net Salary -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:linear-gradient(135deg,#e87722 0%,#f4a83a 100%);color:white;">
        <div>
          <div style="font-size:13px;font-weight:bold;letter-spacing:0.5px;">Net Take-Home Salary</div>
          <div style="font-size:8.5px;opacity:0.9;margin-top:2px;">${numToWords(Math.round(netSalary))}</div>
          <div style="font-size:8px;opacity:0.8;margin-top:2px;">YTD Net: ₹${fmt(ytdNet)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:24px;font-weight:bold;">₹${fmt(netSalary)}</div>
          <div style="font-size:9px;opacity:0.85;">${payPeriod}</div>
        </div>
      </div>

      <!-- Footer note -->
      <div style="padding:8px 16px;display:flex;justify-content:space-between;align-items:flex-end;font-size:8px;color:#9ca3af;">
        <div>
          This is a computer-generated payslip and does not require a physical signature.
          ${lopDays > 0 ? `<br><span style="color:#dc2626;">* ${lopDays} day(s) LOP deducted from Basic Salary.</span>` : ''}
        </div>
        <div style="text-align:right;">
          <div style="margin-bottom:20px;">_______________________</div>
          <div>Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;

  const extraStyles = `
    .td { padding: 5px 12px; border-bottom: 1px solid #f3f4f6; font-size: 10.5px; }
    .amt { text-align: right; font-variant-numeric: tabular-nums; }
  `;

  openLetterheadPrintWindow(
    `Payslip - ${employee.display_name || empUser.full_name || ''} - ${payPeriod}`,
    contentHtml,
    extraStyles
  );
}