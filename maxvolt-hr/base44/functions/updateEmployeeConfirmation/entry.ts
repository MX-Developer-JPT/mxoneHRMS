import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Get all active employees
        const employees = await base44.asServiceRole.entities.Employee.filter({ status: 'active' });
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        let updatedCount = 0;

        for (const employee of employees) {
            // Check if employee is on probation and has a confirmation date
            if (employee.employee_status === 'probation' && employee.employee_confirmation_date) {
                const confirmationDate = new Date(employee.employee_confirmation_date);
                confirmationDate.setHours(0, 0, 0, 0);
                
                // If confirmation date has passed or is today, update status to confirmation
                if (confirmationDate <= today) {
                    await base44.asServiceRole.entities.Employee.update(employee.id, {
                        employee_status: 'confirmation'
                    });
                    updatedCount++;
                }
            }
        }

        return Response.json({ 
            message: 'Employee confirmation status updated successfully',
            updated_count: updatedCount
        }, { status: 200 });

    } catch (error) {
        console.error('Error updating employee confirmation:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});