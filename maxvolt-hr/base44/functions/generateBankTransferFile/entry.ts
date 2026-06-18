import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'hr') {
      return Response.json({ error: 'Forbidden: Admin/HR access required' }, { status: 403 });
    }

    const { month, year, format } = await req.json();

    if (!month || !year) {
      return Response.json({ error: 'Month and year are required' }, { status: 400 });
    }

    const bankFormat = format || 'generic';

    const payrolls = await base44.asServiceRole.entities.Payroll.filter({ month, year });
    const activePayrolls = payrolls.filter(p => p.status === 'paid' || p.status === 'processed');

    if (activePayrolls.length === 0) {
      return Response.json({ error: 'No processed/paid payroll records found for this period' }, { status: 404 });
    }

    const employees = await base44.asServiceRole.entities.Employee.list();
    const users = await base44.asServiceRole.entities.User.list();
    const bonuses = await base44.asServiceRole.entities.Bonus.filter({ month, year, status: 'approved' });

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthAbbr = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

    // Get company bank details (debit account) - try to read from payroll config
    let companyAccount = 'MAXVOLT ENERGY INDUSTRIES LTD';
    let companyAccountNo = '';
    let companyIFSC = '';
    let companyBankName = '';
    try {
      const payrollConfigs = await base44.asServiceRole.entities.PayrollConfiguration.list();
      if (payrollConfigs.length > 0) {
        const config = payrollConfigs[0];
        companyAccountNo = config.bank_account_number || '';
        companyIFSC = config.bank_ifsc || '';
        companyBankName = config.bank_name || '';
      }
    } catch (_) {}

    const totalSalary = activePayrolls.reduce((s, p) => s + (p.net_salary || 0), 0);
    const totalBonus = bonuses.reduce((s, b) => s + (b.amount || 0), 0);
    const grandTotal = totalSalary + totalBonus;
    let includedCount = 0;

    // Build rows
    const rows = [];
    for (const payroll of activePayrolls) {
      const emp = employees.find(e => e.user_id === payroll.user_id);
      const empUser = users.find(u => u.id === payroll.user_id);

      if (!emp) continue;
      const bank = emp.bank_account || {};
      const accountNo = (bank.account_number || '').replace(/[^0-9]/g, '');
      const ifsc = (bank.ifsc_code || '').toUpperCase().trim();
      const bankName = bank.bank_name || '';
      const branch = bank.branch || '';
      const netSalary = payroll.net_salary || 0;
      const empBonuses = bonuses.filter(b => b.user_id === payroll.user_id);
      const bonusAmount = empBonuses.reduce((s, b) => s + (b.amount || 0), 0);
      const totalPay = netSalary + bonusAmount;
      const name = (emp.display_name || empUser?.full_name || '').replace(/,/g, ' ');

      rows.push({
        employeeCode: emp.employee_code,
        name,
        accountNo,
        ifsc,
        bankName,
        branch,
        netSalary,
        bonusAmount,
        totalPay,
      });
      includedCount++;
    }

    // Build content based on format
    let csvContent = '';
    let filename = '';

    if (bankFormat === 'sbi') {
      // SBI bulk upload format: Debit A/c, Cr A/c, IFSC, Beneficiary Name, Amount, Narration
      const lines = [];
      for (const r of rows) {
        if (!r.accountNo) continue;
        lines.push(`${companyAccountNo},${r.accountNo},${r.ifsc},"${r.name}",${r.totalPay.toFixed(2)},"SAL ${monthAbbr[month-1]}${year}"`);
      }
      csvContent = `Debit Account,Credit Account,IFSC Code,Beneficiary Name,Amount,Payment Details\n${lines.join('\n')}`;
      filename = `SBI_SALARY_${monthAbbr[month-1]}_${year}.csv`;
    } else if (bankFormat === 'hdfc') {
      // HDFC bulk upload format
      const lines = [];
      for (const r of rows) {
        if (!r.accountNo) continue;
        lines.push(`${r.accountNo},${r.name},${r.ifsc},"${r.bankName}",${r.totalPay.toFixed(2)},"SALARY ${monthNames[month-1]} ${year}"`);
      }
      csvContent = `Account Number,Beneficiary Name,IFSC Code,Bank Name,Amount,Narration\n${lines.join('\n')}`;
      filename = `HDFC_SALARY_${monthAbbr[month-1]}_${year}.csv`;
    } else if (bankFormat === 'icici') {
      const lines = [];
      for (const r of rows) {
        if (!r.accountNo) continue;
        lines.push(`${r.accountNo},${r.name},${r.ifsc},"${r.bankName}",${r.totalPay.toFixed(2)},"SAL ${monthAbbr[month-1]} ${year}"`);
      }
      csvContent = `Beneficiary Account No,Beneficiary Name,IFSC Code,Bank Name,Amount,Remarks\n${lines.join('\n')}`;
      filename = `ICICI_SALARY_${monthAbbr[month-1]}_${year}.csv`;
    } else {
      // Generic / standard format — comprehensive bank file
      const lines = [];
      // Header section
      lines.push(`"COMPANY","${companyAccount}"`);
      lines.push(`"ACCOUNT","${companyAccountNo}"`);
      lines.push(`"IFSC","${companyIFSC}"`);
      lines.push(`"BANK","${companyBankName}"`);
      lines.push(`"PERIOD","${monthNames[month-1]} ${year}"`);
      lines.push(`"GENERATED","${new Date().toISOString().split('T')[0]}"`);
      lines.push(`"TOTAL EMPLOYEES","${includedCount}"`);
      lines.push(`"TOTAL AMOUNT","${grandTotal.toFixed(2)}"`);
      lines.push('');
      lines.push('Emp Code,Employee Name,Bank A/c No,IFSC Code,Bank Name,Branch,Salary Amount,Bonus/Off-Cycle,Total Amount,Payment Mode,Narration');

      for (const r of rows) {
        lines.push(`${r.employeeCode},"${r.name}",${r.accountNo},${r.ifsc},"${r.bankName}","${r.branch}",${r.netSalary.toFixed(2)},${r.bonusAmount.toFixed(2)},${r.totalPay.toFixed(2)},NEFT,"Salary for ${monthNames[month-1]} ${year}"`);
      }

      // Summary footer
      lines.push('');
      lines.push(`"SUMMARY",,,,"Total Employees: ${includedCount}","Total Salary: ${totalSalary.toFixed(2)}","Total Bonus: ${totalBonus.toFixed(2)}","Grand Total: ${grandTotal.toFixed(2)}"`);

      csvContent = lines.join('\n');
      filename = `Bank_Transfer_${monthNames[month-1]}_${year}.csv`;
    }

    return Response.json({
      success: true,
      csv: csvContent,
      filename,
      format: bankFormat,
      total: grandTotal,
      salaryTotal: totalSalary,
      bonusTotal: totalBonus,
      count: includedCount,
    });

  } catch (error) {
    console.error('generateBankTransferFile error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});