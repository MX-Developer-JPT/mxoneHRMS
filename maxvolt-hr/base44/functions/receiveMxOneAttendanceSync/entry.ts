import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // 1. Authenticate using BIOMETRIC_AGENT_API_KEY
        const authHeader = req.headers.get('Authorization');
        const xApiKey = req.headers.get('x-api-key');
        const expectedApiKey = Deno.env.get('BIOMETRIC_AGENT_API_KEY');

        if (!expectedApiKey) {
            console.error('Server config error: BIOMETRIC_AGENT_API_KEY not set');
            return Response.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // Accept: Bearer <key>, plain <key> in Authorization, or x-api-key header
        let token = null;
        if (xApiKey) {
            token = xApiKey;
        } else if (authHeader) {
            token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
        }

        console.log('Received token (first 8 chars):', token ? token.substring(0, 8) : 'none');
        console.log('Expected key (first 8 chars):', expectedApiKey.substring(0, 8));

        if (!token || token.trim() !== expectedApiKey.trim()) {
            console.warn('Auth failed: Invalid API key');
            return Response.json({ error: 'Unauthorized: Invalid API Key' }, { status: 401 });
        }

        // 2. Only accept POST
        if (req.method !== 'POST') {
            return Response.json({ error: 'Method Not Allowed' }, { status: 405 });
        }

        // 3. Parse and validate payload
        let payload;
        try {
            payload = await req.json();
        } catch {
            return Response.json({ error: 'Bad Request: Invalid JSON' }, { status: 400 });
        }

        console.log('Received MX-One payload:', JSON.stringify(payload));

        const { employee_id, time, type } = payload;

        if (!employee_id || !time || !type) {
            console.warn('Invalid payload: missing fields', payload);
            return Response.json({ error: 'Bad Request: Missing required fields (employee_id, time, type)' }, { status: 400 });
        }

        const attendanceTime = new Date(time);
        if (isNaN(attendanceTime.getTime())) {
            console.warn('Invalid payload: time is not valid ISO 8601', payload);
            return Response.json({ error: 'Bad Request: "time" must be a valid ISO 8601 timestamp' }, { status: 400 });
        }

        if (type !== 'IN') {
            console.warn(`Unsupported type: ${type}`);
            return Response.json({ error: `Bad Request: Unsupported type '${type}'. Only 'IN' is supported.` }, { status: 400 });
        }

        // Format date as YYYY-MM-DD
        const attendanceDate = attendanceTime.toISOString().split('T')[0];

        // 4. Verify employee exists by employee_code
        const employees = await base44.asServiceRole.entities.Employee.filter({ employee_code: String(employee_id) });

        if (!employees || employees.length === 0) {
            console.warn(`Employee not found: ${employee_id}`);
            return Response.json({ error: `Not Found: Employee with ID ${employee_id} not found` }, { status: 404 });
        }

        const employee = employees[0];
        const userId = employee.user_id;

        // 5. Create or update attendance record
        const existingAttendances = await base44.asServiceRole.entities.Attendance.filter({ user_id: userId, date: attendanceDate });

        if (existingAttendances && existingAttendances.length > 0) {
            const existing = existingAttendances[0];
            // Only update if no check-in yet, or this time is earlier
            if (!existing.check_in_time || attendanceTime < new Date(existing.check_in_time)) {
                await base44.asServiceRole.entities.Attendance.update(existing.id, {
                    check_in_time: attendanceTime.toISOString(),
                    status: 'present',
                });
                console.log(`Updated check-in for user ${userId} on ${attendanceDate}`);
            } else {
                console.log(`Check-in already recorded for user ${userId} on ${attendanceDate}, skipping`);
            }
        } else {
            await base44.asServiceRole.entities.Attendance.create({
                user_id: userId,
                date: attendanceDate,
                check_in_time: attendanceTime.toISOString(),
                status: 'present',
                auto_marked: true,
            });
            console.log(`Created attendance for user ${userId} on ${attendanceDate}`);
        }

        // 6. Log to BiometricSyncLog
        try {
            await base44.asServiceRole.entities.BiometricSyncLog.create({
                last_sync_time: new Date().toISOString(),
                records_synced: 1,
                status: 'success',
                triggered_by: `mx-one-${employee_id}`,
            });
        } catch (logErr) {
            console.error('Failed to write BiometricSyncLog:', logErr.message);
        }

        return Response.json({ message: 'Attendance sync successful', employee_id, date: attendanceDate, type }, { status: 200 });

    } catch (error) {
        console.error('Unexpected error:', error.message);
        return Response.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
});