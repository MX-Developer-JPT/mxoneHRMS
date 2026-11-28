// Who has left, and until when their attendance belongs on monthly screens and reports. Pure (no database access);
// maxvolt-hr/src/lib/leavers.js mirrors these rules for the browser.
export const LEFT_VALUES = ['left', 'resigned', 'terminated', 'retired', 'relieved', 'absconded'];
const norm = (v) => String(v || '').trim().toLowerCase();
export const isLeaver = (e) => [e?.status, e?.employee_status, e?.employment_status].some((v) => LEFT_VALUES.includes(norm(v)));
export const ymd = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
export const lastWorkingDay = (e, exit) => ymd(e?.exit_date) || ymd(exit?.last_working_date) || ymd(e?.last_working_date);

/** Is this date after the person's last working day? Always false for someone who has not left (a notice-period date). */
export const afterExit = (e, date) => { if (!isLeaver(e)) return false; const l = lastWorkingDay(e); return !!l && date > l; };

/**
 * The people a report for the period starting `from` must list: everyone active, plus anyone who left on or after the
 * first day of the period (so they stay in their last working month and every earlier one). A leaver with no recorded
 * last working day is listed whenever they have attendance in the period (`withRecords` = user ids that do).
 */
export function rosterFor(employees, from, withRecords = new Set()) {
  return (employees || []).filter((e) => {
    if (!isLeaver(e)) return e.status === 'active';
    const l = lastWorkingDay(e);
    return l ? l >= from : withRecords.has(e.user_id);
  });
}
