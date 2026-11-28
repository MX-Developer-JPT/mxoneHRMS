// Browser copy of backend/utils/leavers.js: who has left, and until when their attendance belongs on monthly screens.
export const LEFT_VALUES = ['left', 'resigned', 'terminated', 'retired', 'relieved', 'absconded'];
const norm = (v) => String(v || '').trim().toLowerCase();
export const isLeaver = (e) => [e?.status, e?.employee_status, e?.employment_status].some((v) => LEFT_VALUES.includes(norm(v)));
export const ymd = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
/** The first day attendance counts for this record: the joining date, or earlier when older attendance was transferred in. */
export const joinedFrom = (e) => [ymd(e?.date_of_joining), ymd(e?.attendance_from)].filter(Boolean).sort()[0] || '';
export const lastWorkingDay = (e) => ymd(e?.exit_date) || ymd(e?.last_working_date);
export const afterExit = (e, date) => { if (!isLeaver(e)) return false; const l = lastWorkingDay(e); return !!l && date > l; };
export function rosterFor(employees, from, withRecords = new Set()) {
  return (employees || []).filter((e) => {
    if (!isLeaver(e)) return e.status === 'active';
    // attendance moved to the person's new record: list the old one only while it still has records of its own
    if (e.attendance_transferred_to) return withRecords.has(e.user_id);
    const l = lastWorkingDay(e);
    return l ? l >= from : withRecords.has(e.user_id);
  });
}
