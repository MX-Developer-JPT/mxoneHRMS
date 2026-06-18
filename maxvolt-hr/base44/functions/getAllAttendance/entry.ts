import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fetches all Attendance records for a given date OR date range.
 * Accepts: { date } for single day, or { date_from, date_to } for range.
 * Only accessible by admin, hr, or management roles.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = user.custom_role || user.role;
    if (!['admin', 'hr', 'management'].includes(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { date, date_from, date_to } = body;

    if (!date && !date_from) {
      return Response.json({ error: 'date or date_from is required' }, { status: 400 });
    }

    let rawRecords = [];

    if (date_from && date_to) {
      // Date range: fetch by iterating dates or use $gte/$lte filter
      rawRecords = await base44.asServiceRole.entities.Attendance.list('-date', 20000);
      rawRecords = rawRecords.filter(r => {
        const d = String(r.date).slice(0, 10);
        return d >= date_from && d <= date_to;
      });
    } else {
      // Single date
      const targetDate = date;
      rawRecords = await base44.asServiceRole.entities.Attendance.filter({ date: targetDate }, '-updated_date', 2000);
    }

    // Deduplicate: per user_id+date, keep the most up-to-date record
    const byUserDate = {};
    for (const r of rawRecords) {
      const uid = r.user_id;
      const d = String(r.date).slice(0, 10);
      if (!uid) continue;
      const key = `${uid}__${d}`;
      const existing = byUserDate[key];
      if (!existing) { byUserDate[key] = r; continue; }
      const newSessions = (r.punch_sessions || []).length;
      const existingSessions = (existing.punch_sessions || []).length;
      if (newSessions > existingSessions) { byUserDate[key] = r; }
      else if (newSessions === existingSessions && new Date(r.updated_date) > new Date(existing.updated_date)) {
        byUserDate[key] = r;
      }
    }
    const records = Object.values(byUserDate);

    return Response.json({ records });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});