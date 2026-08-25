// Single source of truth for "should this employee see this announcement" —
// mirrors getAnnouncementAudienceUserIds in backend/routes/entities.js
// (which drives the notification), so the Dashboard/Announcements pages
// never show a published announcement to someone who was never in its
// targeted audience (and never notified about it) in the first place.
export function isAnnouncementForEmployee(announcement, employee) {
  const audience = announcement?.target_audience || 'all';
  if (audience === 'all') return true;

  if (audience === 'specific_locations') {
    const locs = Array.isArray(announcement.target_locations) ? announcement.target_locations : [];
    if (!locs.length) return true; // matches the backend's own "nothing selected -> everyone" fallback
    return !!employee?.work_location && locs.includes(employee.work_location);
  }

  // 'specific_departments' (or any other non-'all' value — same fallback
  // the backend audience resolver uses for an unrecognized/legacy value).
  const depts = Array.isArray(announcement.target_departments) ? announcement.target_departments : [];
  if (!depts.length) return true;
  return !!employee?.department && depts.includes(employee.department);
}
