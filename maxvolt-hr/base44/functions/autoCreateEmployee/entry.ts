import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { user_id, email, full_name } = body;

    // Check if employee record already exists
    const existingEmployee = await base44.asServiceRole.entities.Employee.filter({ user_id });
    
    if (existingEmployee.length > 0) {
      return Response.json({ 
        success: true, 
        message: 'Employee already exists',
        employee: existingEmployee[0]
      });
    }

    // Generate unique employee code
    const allEmployees = await base44.asServiceRole.entities.Employee.list();
    const employeeCode = `EMP${String(allEmployees.length + 1).padStart(4, '0')}`;

    // Create employee record
    const employee = await base44.asServiceRole.entities.Employee.create({
      user_id,
      employee_code: employeeCode,
      department: 'operations',
      designation: 'Employee',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      status: 'active'
    });

    // Initialize leave balances for the current year
    const leavePolicies = await base44.asServiceRole.entities.LeavePolicy.list();
    const currentYear = new Date().getFullYear();

    for (const policy of leavePolicies) {
      await base44.asServiceRole.entities.LeaveBalance.create({
        user_id,
        leave_policy_id: policy.id,
        year: currentYear,
        total_allocated: policy.total_days,
        used: 0,
        pending_approval: 0,
        available: policy.total_days,
        carried_forward: 0
      });
    }

    return Response.json({ 
      success: true, 
      message: 'Employee created successfully',
      employee 
    });

  } catch (error) {
    console.error('Error creating employee:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});