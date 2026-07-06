// Single source of truth for "how was this attendance record marked" across
// AllAttendance, AttendanceDetailsDialog, AttendanceHistory and AttendanceReports.
// Precedence when a record carries more than one signal (e.g. biometric sync
// landed on a day that also has a selfie punch): biometric > geofence > selfie > manual.
export const ATTENDANCE_METHODS = {
  biometric: { key: 'biometric', label: 'Biometric', shortLabel: 'Bio', color: 'green' },
  geofence:  { key: 'geofence',  label: 'Geofence',   shortLabel: 'Geo', color: 'indigo' },
  selfie:    { key: 'selfie',    label: 'Selfie',     shortLabel: 'Selfie', color: 'blue' },
  manual:    { key: 'manual',    label: 'Manual',     shortLabel: 'Manual', color: 'gray' },
};

export function getAttendanceMethod(record) {
  if (!record) return ATTENDANCE_METHODS.manual;
  if (record.biometric_synced) return ATTENDANCE_METHODS.biometric;
  if (record.auto_geofence || record.auto_geofence_checkout) return ATTENDANCE_METHODS.geofence;
  if (record.check_in_selfie_url || record.check_out_selfie_url) return ATTENDANCE_METHODS.selfie;
  return ATTENDANCE_METHODS.manual;
}

// Human-readable detail for the geofence case — distinguishes the native Android
// background geofence (works with the app closed) from the in-app foreground watcher.
export function getGeofenceDetail(record) {
  if (record?.geofence_source === 'native_android') return `Native geofence — ${record.geofence_location || 'assigned office'}`;
  if (record?.geofence_location) return `In-app geofence — ${record.geofence_location}`;
  return 'Geofence';
}
