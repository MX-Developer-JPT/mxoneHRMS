import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import * as XLSX from 'npm:xlsx@0.18.5';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    const role = user?.custom_role || user?.role;
    if (!user || (role !== 'admin' && role !== 'hr')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const wb = XLSX.utils.book_new();

    // ---- README ----
    const readme = [
      ['EMPLOYEE BULK IMPORT TEMPLATE - README'],
      [''],
      ['INSTRUCTIONS:'],
      ['1. Fill in each sheet with the relevant employee data.'],
      ['2. personal_email is the UNIQUE KEY linking all sheets. Use it consistently across all sheets.'],
      ['3. employee_code must be unique per employee.'],
      ['4. Dates must be in YYYY-MM-DD format (e.g., 2024-01-15).'],
      ['5. Boolean fields: use TRUE or FALSE (all caps).'],
      ['6. Enum fields: use exactly the values shown below.'],
      ['7. Required fields are marked with * in the column header.'],
      [''],
      ['SHEET DESCRIPTIONS:'],
      ['Employee_Profile', 'Core employee personal and job information'],
      ['Statutory_Info',   'PAN, Aadhar, PF, ESI, UAN numbers'],
      ['Bank_Details',     'Bank account details for salary transfer'],
      ['PF_Nominee',       'Provident Fund nominee details'],
      ['Insurance_Policies','Employee insurance policy records (multiple rows per employee allowed)'],
      ['Salary_Structure', 'Salary components and CTC details'],
      ['Leave_Balances',   'Initial leave balance per employee per policy code'],
      [''],
      ['ENUM VALUES:'],
      ['gender',            'male | female | other'],
      ['designation_tier',  'executive | senior_executive | territory_manager | manager | general_manager | director'],
      ['employee_status',   'probation | confirmation | trainee'],
      ['employment_type',   'full_time | part_time | contract | intern'],
      ['status (employee)', 'active | on_leave | resigned | terminated'],
      ['blood_group',       'A+ | A- | B+ | B- | AB+ | AB- | O+ | O-'],
      ['salary status',     'active | inactive | revision_pending'],
      ['role',              'employee | management | hr | admin'],
    ];
    const readmeWs = XLSX.utils.aoa_to_sheet(readme);
    readmeWs['!cols'] = [{ wch: 30 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, readmeWs, 'README');

    // ---- EMPLOYEE PROFILE ----
    const empHeaders = [
      'full_name*', 'employee_code*', 'personal_email*', 'department*', 'designation*',
      'designation_tier', 'employee_status', 'date_of_joining*', 'employee_confirmation_date',
      'work_location', 'date_of_birth', 'gender', 'father_spouse_name',
      'phone', 'blood_group', 'employment_type', 'status', 'role',
      'reporting_manager_email', 'is_attendance_exempt',
      'address',
      'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone', 'emergency_contact_address'
    ];
    const empSample = [
      'John Doe', 'EMP001', 'john.doe@company.com', 'Sales', 'Territory Manager',
      'territory_manager', 'confirmation', '2023-06-01', '2023-12-01',
      'Mumbai', '1990-05-15', 'male', 'Robert Doe',
      '9876543210', 'O+', 'full_time', 'active', 'employee',
      'manager@company.com', 'FALSE',
      '123 Main Street, Mumbai 400001',
      'Jane Doe', 'spouse', '9876500000', '123 Main Street, Mumbai 400001'
    ];
    const empWs = XLSX.utils.aoa_to_sheet([empHeaders, empSample]);
    empWs['!cols'] = empHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, empWs, 'Employee_Profile');

    // ---- STATUTORY INFO ----
    const statHeaders = [
      'personal_email*', 'pan_number', 'aadhar_number', 'uan_number',
      'pf_account_number', 'is_esi_applicable', 'esi_number'
    ];
    const statSample = [
      'john.doe@company.com', 'ABCDE1234F', '1234 5678 9012', 'UAN123456789',
      'PF/MH/12345/001', 'FALSE', ''
    ];
    const statWs = XLSX.utils.aoa_to_sheet([statHeaders, statSample]);
    statWs['!cols'] = statHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, statWs, 'Statutory_Info');

    // ---- BANK DETAILS ----
    const bankHeaders = [
      'personal_email*', 'account_number*', 'ifsc_code*', 'bank_name*', 'branch'
    ];
    const bankSample = [
      'john.doe@company.com', '1234567890123', 'HDFC0001234', 'HDFC Bank', 'Andheri West'
    ];
    const bankWs = XLSX.utils.aoa_to_sheet([bankHeaders, bankSample]);
    bankWs['!cols'] = bankHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, bankWs, 'Bank_Details');

    // ---- PF NOMINEE ----
    const pfHeaders = [
      'personal_email*', 'nominee_name*', 'nominee_relationship*', 'nominee_date_of_birth', 'share_percentage'
    ];
    const pfSample = [
      'john.doe@company.com', 'Jane Doe', 'spouse', '1992-08-20', '100'
    ];
    const pfWs = XLSX.utils.aoa_to_sheet([pfHeaders, pfSample]);
    pfWs['!cols'] = pfHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, pfWs, 'PF_Nominee');

    // ---- INSURANCE POLICIES ----
    const insHeaders = [
      'personal_email*', 'insurance_type', 'insurer_name', 'policy_number',
      'sum_insured', 'validity_date', 'nominee_name', 'nominee_relationship', 'nominee_date_of_birth'
    ];
    const insSample = [
      'john.doe@company.com', 'Group Health', 'Star Health', 'POL/2024/001',
      '300000', '2025-03-31', 'Jane Doe', 'spouse', '1992-08-20'
    ];
    const insWs = XLSX.utils.aoa_to_sheet([insHeaders, insSample]);
    insWs['!cols'] = insHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, insWs, 'Insurance_Policies');

    // ---- SALARY STRUCTURE ----
    const salHeaders = [
      'personal_email*', 'effective_from*', 'ctc*', 'basic_salary', 'hra',
      'conveyance', 'medical', 'special_allowance', 'lta', 'performance_bonus',
      'pf_contribution', 'employer_pf_contribution', 'esi_contribution', 'employer_esi_contribution',
      'professional_tax', 'gratuity', 'gratuity_eligible', 'insurance_premium', 'status'
    ];
    const salSample = [
      'john.doe@company.com', '2024-01-01', '600000', '20000', '8000',
      '1600', '1250', '5000', '5000', '10000',
      '1800', '1800', '0', '0',
      '200', '1000', 'TRUE', '500', 'active'
    ];
    const salWs = XLSX.utils.aoa_to_sheet([salHeaders, salSample]);
    salWs['!cols'] = salHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, salWs, 'Salary_Structure');

    // ---- LEAVE BALANCES ----
    const lvHeaders = [
      'personal_email*', 'leave_policy_code*', 'year*', 'total_allocated',
      'accrued_this_year', 'used', 'carried_forward', 'last_accrual_month', 'last_accrual_year'
    ];
    const lvSample = [
      'john.doe@company.com', 'CL', '2026', '12',
      '4', '0', '2', '4', '2026'
    ];
    const lvWs = XLSX.utils.aoa_to_sheet([lvHeaders, lvSample]);
    lvWs['!cols'] = lvHeaders.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, lvWs, 'Leave_Balances');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Encode as base64 so it can be returned via invoke() JSON response
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

    return Response.json({ base64, filename: 'Employee_Import_Template.xlsx' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});