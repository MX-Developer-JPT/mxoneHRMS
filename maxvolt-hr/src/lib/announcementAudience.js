// Single source of truth for "should this employee see this announcement" —
// mirrors getAnnouncementAudienceUserIds in backend/routes/entities.js
// (which drives the notification), so the Dashboard/Announcements pages
// never show a published announcement to someone who was never in its
// targeted audience (and never notified about it) in the first place.
// Names are compared ignoring case and surrounding spaces, exactly as the backend does.
const key = (v) => String(v || '').trim().toLowerCase();
const same = (list) => (Array.isArray(list) ? list : []).map(key).filter(Boolean);
export function isAnnouncementForEmployee(announcement, employee) {
  const audience = announcement?.target_audience || 'all';
  if (audience === 'all') return true;

  if (audience === 'specific_locations') {
    const locs = same(announcement.target_locations);
    if (!locs.length) return false; // the API refuses to publish a targeted announcement with nothing selected
    return !!employee?.work_location && locs.includes(key(employee.work_location));
  }

  // 'specific_departments' (or any other non-'all' value — same fallback
  // the backend audience resolver uses for an unrecognized/legacy value).
  const depts = same(announcement.target_departments);
  if (!depts.length) return false;
  return !!employee?.department && depts.includes(key(employee.department));
}
