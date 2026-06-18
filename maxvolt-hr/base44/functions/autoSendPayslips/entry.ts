import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin' && user?.role !== 'hr') {
      return Response.json({ error: 'Forbidden: Admin/HR access required' }, { status: 403 });
    }

    const { month, year } = await req.json();

    const payrolls = await base44.asServiceRole.entities.Payroll.filter({
      month,
      year,
      status: 'paid'
    });

    const results = [];

    for (const payroll of payrolls) {
      try {
        const employee = await base44.asServiceRole.entities.Employee.filter({ 
          user_id: payroll.user_id 
        });
        
        if (!employee.length) continue;

        const empUser = await base44.asServiceRole.entities.User.filter({ 
          id: payroll.user_id 
        });
        
        if (!empUser.length) continue;

        const user = empUser[0];
        const emp = employee[0];

        // Generate payslip content
        const emailBody = `
          <h2>Payslip for ${new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
          
          <p>Dear ${user.full_name},</p>
          
          <p>Please find your payslip details below:</p>
          
          <table border="1" cellpadding="10" style="border-collapse: collapse;">
            <tr><th colspan="2" style="background-color: #f0f0f0;">Employee Details</th></tr>
            <tr><td>Employee Code</td><td>${emp.employee_code}</td></tr>
            <tr><td>Name</td><td>${user.full_name}</td></tr>
            <tr><td>Department</td><td>${emp.department}</td></tr>
            <tr><td>Designation</td><td>${emp.designation}</td></tr>
            
            <tr><th colspan="2" style="background-color: #f0f0f0;">Earnings</th></tr>
            <tr><td>Basic Salary</td><td>₹${payroll.basic_salary?.toFixed(2) || 0}</td></tr>
            <tr><td>HRA</td><td>₹${payroll.hra?.toFixed(2) || 0}</td></tr>
            <tr><td>Conveyance</td><td>₹${payroll.allowances?.conveyance?.toFixed(2) || 0}</td></tr>
            <tr><td>Medical</td><td>₹${payroll.allowances?.medical?.toFixed(2) || 0}</td></tr>
            <tr><td>Special Allowance</td><td>₹${payroll.allowances?.special_allowance?.toFixed(2) || 0}</td></tr>
            ${payroll.overtime_amount ? `<tr><td>Overtime</td><td>₹${payroll.overtime_amount.toFixed(2)}</td></tr>` : ''}
            ${payroll.bonuses ? `<tr><td>Bonus</td><td>₹${payroll.bonuses.toFixed(2)}</td></tr>` : ''}
            ${payroll.reimbursements ? `<tr><td>Reimbursements</td><td>₹${payroll.reimbursements.toFixed(2)}</td></tr>` : ''}
            <tr style="font-weight: bold;"><td>Gross Salary</td><td>₹${payroll.gross_salary?.toFixed(2) || 0}</td></tr>
            
            <tr><th colspan="2" style="background-color: #f0f0f0;">Deductions</th></tr>
            <tr><td>PF</td><td>₹${payroll.deductions?.pf?.toFixed(2) || 0}</td></tr>
            <tr><td>ESI</td><td>₹${payroll.deductions?.esi?.toFixed(2) || 0}</td></tr>
            <tr><td>Professional Tax</td><td>₹${payroll.deductions?.professional_tax?.toFixed(2) || 0}</td></tr>
            <tr><td>TDS</td><td>₹${payroll.deductions?.tds?.toFixed(2) || 0}</td></tr>
            ${payroll.loan_emi_deduction ? `<tr><td>Loan EMI</td><td>₹${payroll.loan_emi_deduction.toFixed(2)}</td></tr>` : ''}
            <tr style="font-weight: bold;"><td>Total Deductions</td><td>₹${Object.values(payroll.deductions || {}).reduce((sum, val) => sum + val, 0).toFixed(2)}</td></tr>
            
            <tr style="font-weight: bold; background-color: #e8f5e9;"><td>Net Salary</td><td>₹${payroll.net_salary?.toFixed(2) || 0}</td></tr>
          </table>
          
          <p><strong>Attendance Summary:</strong></p>
          <ul>
            <li>Working Days: ${payroll.working_days}</li>
            <li>Present Days: ${payroll.present_days}</li>
            <li>Paid Leave Days: ${payroll.paid_leave_days}</li>
            <li>Loss of Pay Days: ${payroll.loss_of_pay_days}</li>
          </ul>
          
          <p>This is a system-generated payslip.</p>
          
          <p>Best Regards,<br/>HR Department</p>
        `;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user.email,
          subject: `Payslip for ${new Date(year, month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}`,
          body: emailBody
        });

        results.push({
          employee: emp.employee_code,
          email: user.email,
          status: 'sent'
        });

      } catch (error) {
        console.error(`Error sending payslip for ${payroll.user_id}:`, error);
        results.push({
          user_id: payroll.user_id,
          status: 'error',
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      message: `Sent ${results.filter(r => r.status === 'sent').length} payslips`,
      results
    });

  } catch (error) {
    console.error('Error in autoSendPayslips:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});