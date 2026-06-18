import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();
    console.log('handleNewUserSignup triggered:', event?.type, event?.entity_name, data?.email);

    // Only process new user creation events
    if (event?.type !== 'create' || event?.entity_name !== 'User') {
      return Response.json({ success: true, message: 'Not a user creation event' });
    }

    const userId = event.entity_id;
    const userEmail = data?.email;
    const fullName = data?.full_name || '';

    // ---- AUTO-LINK: check if this user was bulk-imported ----
    if (userEmail) {
      // Use filter() directly on indexed fields for reliable, paginated-safe matching
      const [importedEmployees, pendingSalary, pendingLeave] = await Promise.all([
        base44.asServiceRole.entities.Employee.filter({ personal_email: userEmail }),
        base44.asServiceRole.entities.SalaryStructure.filter({ _pending_email: userEmail }),
        base44.asServiceRole.entities.LeaveBalance.filter({ _pending_email: userEmail }),
      ]);

      console.log(`Found ${importedEmployees.length} employee(s), ${pendingSalary.length} salary record(s), ${pendingLeave.length} leave balance(s) for ${userEmail}`);

      // Filter to only records that are still unlinked (user_id is 'pending' or missing)
      const unlinkedEmployees = importedEmployees.filter(
        e => !e.user_id || e.user_id === 'pending'
      );

      // Link SalaryStructure records
      for (const ss of pendingSalary) {
        await base44.asServiceRole.entities.SalaryStructure.update(ss.id, { user_id: userId, _pending_email: null });
      }

      // Link LeaveBalance records
      for (const lb of pendingLeave) {
        await base44.asServiceRole.entities.LeaveBalance.update(lb.id, { user_id: userId, _pending_email: null });
      }

      // If bulk-imported employee exists, link and activate with proper role
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
        console.log('Bulk-imported user linked:', userEmail, 'role:', empRole);
        return Response.json({ success: true, message: 'Bulk-imported user linked and activated' });
      }

      // If imported employee exists but is ALREADY LINKED (import did it first), skip
      const alreadyLinked = importedEmployees.filter(
        e => e.user_id && e.user_id !== 'pending'
      );
      if (alreadyLinked.length > 0) {
        console.log('Bulk-imported user already linked by import:', userEmail);
        return Response.json({ success: true, message: 'Already linked by import' });
      }
    }

    // Brand new user — assign onboarding_pending role immediately
    await base44.asServiceRole.entities.User.update(userId, {
      role: 'onboarding_pending',
      custom_role: 'onboarding_pending',
    });
    console.log('New user set to onboarding_pending:', userEmail);

    // Create a temporary employee record
    const allEmployees = await base44.asServiceRole.entities.Employee.list('-created_date', 1);
    let nextNumber = 1;
    if (allEmployees.length > 0) {
      const lastCode = allEmployees[0].employee_code || '';
      const lastNumber = parseInt(lastCode.replace(/[^0-9]/g, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    const tempEmployeeCode = `TEMP${String(nextNumber).padStart(4, '0')}`;

    // Derive a clean display name: use full_name if it looks real (not an email prefix)
    const cleanFullName = fullName && !fullName.includes('@') && fullName.length > 1 ? fullName : '';

    await base44.asServiceRole.entities.Employee.create({
      user_id: userId,
      display_name: cleanFullName || userEmail?.split('@')[0]?.replace(/[._]/g, ' ') || '',
      employee_code: tempEmployeeCode,
      department: 'pending',
      designation: 'Pending Assignment',
      date_of_joining: new Date().toISOString().split('T')[0],
      employment_type: 'full_time',
      status: 'active',
      onboarding_submitted: false,
    });

    return Response.json({ success: true, message: 'New user set to onboarding_pending' });

  } catch (error) {
    console.error('handleNewUserSignup error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});