import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use the authenticated user's own ID — ignore any passed user_id for security
    const userId = user.id;
    const email = user.email;
    const fullName = user.full_name || '';

    // Check if already linked to a bulk-imported employee record
    if (email) {
      // Use filter() directly on indexed fields for reliable, paginated-safe matching
      const [importedEmployees, pendingSalary, pendingLeave] = await Promise.all([
        base44.asServiceRole.entities.Employee.filter({ personal_email: email }),
        base44.asServiceRole.entities.SalaryStructure.filter({ _pending_email: email }),
        base44.asServiceRole.entities.LeaveBalance.filter({ _pending_email: email }),
      ]);

      console.log(`initNewUser: Found ${importedEmployees.length} employee(s), ${pendingSalary.length} salary record(s), ${pendingLeave.length} leave balance(s) for ${email}`);

      // Only link records that are still unlinked (user_id is 'pending' or missing)
      const unlinkedEmployees = importedEmployees.filter(
        e => !e.user_id || e.user_id === 'pending'
      );

      // Link salary/leave records
      for (const ss of pendingSalary) {
        await base44.asServiceRole.entities.SalaryStructure.update(ss.id, { user_id: userId, _pending_email: null });
      }

      for (const lb of pendingLeave) {
        await base44.asServiceRole.entities.LeaveBalance.update(lb.id, { user_id: userId, _pending_email: null });
      }

      if (unlinkedEmployees.length > 0) {
        const empRecord = unlinkedEmployees[0];
        for (const emp of unlinkedEmployees) {
          await base44.asServiceRole.entities.Employee.update(emp.id, { user_id: userId });
        }
        const empRole = empRecord._import_role || 'employee';
        const systemRole = empRole === 'employee' ? 'user' : empRole;
        await base44.asServiceRole.entities.User.update(userId, {
          role: systemRole,
          custom_role: empRole,
        });
        console.log('Bulk-imported user linked:', email, 'role:', empRole);
        return Response.json({ success: true, message: 'Bulk-imported user linked and activated', role: empRole });
      }
    }

    // Brand new user — assign onboarding_pending role
    await base44.asServiceRole.entities.User.update(userId, {
      role: 'onboarding_pending',
      custom_role: 'onboarding_pending',
    });

    // Create a temporary employee record
    const allEmployees = await base44.asServiceRole.entities.Employee.list('-created_date', 1);
    let nextNumber = 1;
    if (allEmployees.length > 0) {
      const lastCode = allEmployees[0].employee_code || '';
      const lastNumber = parseInt(lastCode.replace(/[^0-9]/g, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    const tempEmployeeCode = `TEMP${String(nextNumber).padStart(4, '0')}`;

    await base44.asServiceRole.entities.Employee.create({
      user_id: userId,
      display_name: fullName || email?.split('@')[0] || '',
      employee_code: tempEmployeeCode,
      department: 'pending',
      designation: 'Pending Assignment',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      status: 'active',
      onboarding_submitted: false,
    });

    return Response.json({ success: true, message: 'New user set to onboarding_pending', role: 'onboarding_pending' });

  } catch (error) {
    console.error('initNewUser error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});