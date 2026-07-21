import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Camera, Clock, Coffee, ArrowDownCircle, ArrowUpCircle, Timer, Fingerprint, Activity } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { getAttendanceMethod, getGeofenceDetail } from '@/lib/attendanceSource';

export default function AttendanceDetailsDialog({ record, employee, open, onClose }) {
  if (!record) return null;

  const statusColors = {
    present:          'bg-green-100 text-green-800',
    absent:           'bg-red-100 text-red-800',
    half_day:         'bg-yellow-100 text-yellow-800',
    leave:            'bg-blue-100 text-blue-800',
    holiday:          'bg-purple-100 text-purple-800',
    week_off:         'bg-gray-100 text-gray-800',
    late:             'bg-orange-100 text-orange-800',
    short_attendance: 'bg-red-100 text-red-700',
    in_progress:      'bg-green-100 text-green-700',
  };

  const formatTime = (iso) => {
    if (!iso) return '-';
    try { return safeDate(iso, 'hh:mm:ss a'); } catch { return iso; }
  };

  const formatMins = (mins) => {
    if (mins == null || mins <= 0) return '-';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatHours = (h) => {
    if (h == null || h <= 0) return '-';
    return formatMins(Math.round(h * 60));
  };

  // Support both new (sessions/breaks) and legacy (punch_sessions) schema
  const richSessions = record.sessions || [];
  const legacySessions = (record.punch_sessions || []).filter(s => s.punch_in || s.session_number);
  const hasSessions = richSessions.length > 0 || legacySessions.length > 0;

  const totalBreakMins = record.total_break_minutes ?? (record.break_hours ? Math.round(record.break_hours * 60) : 0);
  const totalWorkMins  = record.total_working_minutes ?? (record.working_hours ? Math.round(record.working_hours * 60) : 0);

  const attendanceMethod = getAttendanceMethod(record).key;
  const isWorking = record.is_in_progress || record.status === 'in_progress';

  // Unified display sessions list
  const displaySessions = richSessions.length > 0
    ? richSessions.map((s, i) => {
        const breakRecord = (record.breaks || [])[i - 1];
        return {
          session_number:     s.session_number || i + 1,
          punch_in:           s.check_in,
          punch_out:          s.check_out,
          duration_hours:     s.duration_minutes != null ? s.duration_minutes / 60 : null,
          break_before_mins:  breakRecord ? breakRecord.duration_minutes : 0,
          is_complete:        s.is_complete,
        };
      })
    : legacySessions.map((s, i) => ({
        session_number:    s.session_number || i + 1,
        punch_in:          s.punch_in,
        punch_out:         s.punch_out,
        duration_hours:    s.duration_hours,
        break_before_mins: s.break_before_hours ? Math.round(s.break_before_hours * 60) : 0,
        is_complete:       !!s.punch_out,
      }));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attendance Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Employee info */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-blue-600 font-bold text-xl">
                {(employee?.user?.full_name || employee?.display_name || '?').charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-xl font-bold">{employee?.display_name || employee?.user?.display_name || employee?.user?.full_name}</p>
              <p className="text-gray-600">{employee?.designation}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge className={statusColors[record.status] || 'bg-gray-100 text-gray-700'}>
                  {(record.status || '').replace(/_/g, ' ').toUpperCase()}
                </Badge>
                {isWorking && (
                  <Badge className="bg-green-50 text-green-700 border border-green-300 flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Currently Working
                  </Badge>
                )}
                {!isWorking && record.check_out_time && (
                  <Badge className="bg-gray-50 text-gray-600 border border-gray-200">
                    Checked Out
                  </Badge>
                )}
                {attendanceMethod === 'biometric' && (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
                    <Fingerprint className="w-3 h-3" /> Biometric
                  </Badge>
                )}
                {attendanceMethod === 'geofence' && (
                  <Badge className="bg-indigo-100 text-indigo-700 flex items-center gap-1" title={getGeofenceDetail(record)}>
                    <MapPin className="w-3 h-3" /> {getGeofenceDetail(record)}
                  </Badge>
                )}
                {attendanceMethod === 'selfie' && (
                  <Badge className="bg-blue-100 text-blue-700 flex items-center gap-1">
                    <Camera className="w-3 h-3" /> Selfie + Location
                  </Badge>
                )}
                {attendanceMethod === 'manual' && record.check_in_time && (
                  <Badge className="bg-gray-100 text-gray-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Manual
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gray-50 p-3 rounded-lg text-center">
              <p className="text-xs text-gray-500 mb-1">Date</p>
              <p className="font-semibold text-sm">{safeDate(record.date, 'dd MMM yyyy')}</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <p className="text-xs text-gray-500 mb-1">First In</p>
              <p className="font-semibold text-sm text-green-700">{formatTime(record.check_in_time)}</p>
            </div>
            <div className="bg-orange-50 p-3 rounded-lg text-center">
              <p className="text-xs text-gray-500 mb-1">Last Out</p>
              <p className="font-semibold text-sm text-orange-700">
                {isWorking && !record.check_out_time
                  ? <span className="text-green-600 text-xs font-medium">Still Working</span>
                  : formatTime(record.check_out_time)}
              </p>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <p className="text-xs text-gray-500 mb-1">Total Work</p>
              <p className="font-semibold text-sm text-blue-700">
                {totalWorkMins > 0
                  ? formatMins(totalWorkMins)
                  : (isWorking ? <span className="text-green-600 text-xs">In Progress</span> : '-')}
              </p>
            </div>
          </div>

          {/* Break / sessions bar */}
          {(totalBreakMins > 0 || displaySessions.length > 1) && (
            <div className="flex flex-wrap items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2.5">
              <Coffee className="w-4 h-4 text-yellow-600 flex-shrink-0" />
              <div className="flex flex-wrap gap-4 text-sm">
                {totalBreakMins > 0 && (
                  <span className="text-yellow-800 font-medium">Total Break: {formatMins(totalBreakMins)}</span>
                )}
                {displaySessions.length > 1 && (
                  <span className="text-yellow-700">{displaySessions.length} work sessions</span>
                )}
                {record.punch_count > 0 && (
                  <span className="text-yellow-600 text-xs">{record.punch_count} punches recorded</span>
                )}
              </div>
            </div>
          )}

          {/* Work session timeline */}
          {hasSessions && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Timer className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">Work Sessions</h3>
                <Badge variant="outline" className="ml-auto text-xs">
                  {displaySessions.length} session{displaySessions.length !== 1 ? 's' : ''}
                </Badge>
              </div>

              <div className="space-y-2">
                {displaySessions.map((session, idx) => (
                  <div key={idx}>
                    {idx > 0 && session.break_before_mins > 0 && (
                      <div className="flex items-center gap-2 ml-4 my-2 text-xs text-amber-600">
                        <Coffee className="w-3 h-3" />
                        <span className="font-medium">Break {idx}: {formatMins(session.break_before_mins)}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                        {session.session_number}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-4 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <ArrowDownCircle className="w-4 h-4 text-green-600" />
                            <span className="text-sm font-medium text-green-700">{formatTime(session.punch_in)}</span>
                            <span className="text-xs text-gray-400">IN</span>
                          </div>
                          {session.punch_out ? (
                            <>
                              <span className="text-gray-300">→</span>
                              <div className="flex items-center gap-1.5">
                                <ArrowUpCircle className="w-4 h-4 text-red-500" />
                                <span className="text-sm font-medium text-red-600">{formatTime(session.punch_out)}</span>
                                <span className="text-xs text-gray-400">OUT</span>
                              </div>
                              {session.duration_hours != null && (
                                <Badge variant="outline" className="text-xs ml-auto">
                                  <Clock className="w-3 h-3 mr-1" />
                                  {formatHours(session.duration_hours)}
                                </Badge>
                              )}
                            </>
                          ) : (
                            <Badge className="text-xs ml-auto bg-green-100 text-green-700 flex items-center gap-1">
                              <Activity className="w-3 h-3" /> Currently In
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selfie photo + GPS location — a day-level field regardless of how
              many work sessions it has, so this must render independently of
              hasSessions. Previously this only lived inside the legacy
              !hasSessions block below, which every selfie/geofence/biometric
              record now fails (they all populate `sessions` via the unified
              buildSessions engine) — so the photo/location silently never
              rendered for any real selfie check-in. */}
          {(record.check_in_selfie_url || record.check_out_selfie_url || record.check_in_location?.latitude || record.check_out_location?.latitude) && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Camera className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">Selfie & Location</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(record.check_in_selfie_url || record.check_in_location?.latitude) && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <ArrowDownCircle className="w-3 h-3 text-green-600" /> Check In
                    </p>
                    {record.check_in_location?.latitude && (
                      <a
                        href={`https://www.google.com/maps?q=${record.check_in_location.latitude},${record.check_in_location.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs mb-2 flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span>
                          {record.check_in_location.location_address || record.check_in_location.address || 'View on Maps'}
                          {record.check_in_location.landmark_distance && ` — ${record.check_in_location.landmark_distance}`}
                        </span>
                      </a>
                    )}
                    {record.check_in_location?.accuracy != null && (
                      <p className="text-[11px] text-gray-400 mb-2">GPS accuracy: ±{Math.round(record.check_in_location.accuracy)}m</p>
                    )}
                    {record.check_in_selfie_url && (
                      <img src={record.check_in_selfie_url} alt="Check-in selfie" className="w-full max-w-[160px] rounded-lg border" />
                    )}
                  </div>
                )}
                {(record.check_out_selfie_url || record.check_out_location?.latitude) && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <ArrowUpCircle className="w-3 h-3 text-red-500" /> Check Out
                    </p>
                    {record.check_out_location?.latitude && (
                      <a
                        href={`https://www.google.com/maps?q=${record.check_out_location.latitude},${record.check_out_location.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs mb-2 flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span>
                          {record.check_out_location.location_address || record.check_out_location.address || 'View on Maps'}
                          {record.check_out_location.landmark_distance && ` — ${record.check_out_location.landmark_distance}`}
                        </span>
                      </a>
                    )}
                    {record.check_out_location?.accuracy != null && (
                      <p className="text-[11px] text-gray-400 mb-2">GPS accuracy: ±{Math.round(record.check_out_location.accuracy)}m</p>
                    )}
                    {record.check_out_selfie_url && (
                      <img src={record.check_out_selfie_url} alt="Check-out selfie" className="w-full max-w-[160px] rounded-lg border" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selfie / manual records */}
          {!hasSessions && (record.check_in_time || record.check_out_time) && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Camera className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">Attendance Session</h3>
                <Badge variant="outline" className="ml-auto text-xs">1 session</Badge>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {record.check_in_time && (
                    <div className="flex items-center gap-1.5">
                      <ArrowDownCircle className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">{formatTime(record.check_in_time)}</span>
                      <span className="text-xs text-gray-400">IN</span>
                    </div>
                  )}
                  {record.check_out_time ? (
                    <>
                      <span className="text-gray-300">→</span>
                      <div className="flex items-center gap-1.5">
                        <ArrowUpCircle className="w-4 h-4 text-red-500" />
                        <span className="text-sm font-medium text-red-600">{formatTime(record.check_out_time)}</span>
                        <span className="text-xs text-gray-400">OUT</span>
                      </div>
                      {record.working_hours > 0 && (
                        <Badge variant="outline" className="text-xs ml-auto">
                          <Clock className="w-3 h-3 mr-1" />{formatHours(record.working_hours)}
                        </Badge>
                      )}
                    </>
                  ) : record.check_in_time && (
                    <Badge className="text-xs ml-auto bg-green-100 text-green-700">Currently In</Badge>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {record.check_in_time && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <ArrowDownCircle className="w-3 h-3 text-green-600" /> Check In
                    </p>
                    {record.check_in_location?.latitude && (
                      <a
                        href={`https://www.google.com/maps?q=${record.check_in_location.latitude},${record.check_in_location.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs mb-2 flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span>
                          {record.check_in_location.location_address || record.check_in_location.address || 'View on Maps'}
                          {record.check_in_location.landmark_distance && ` — ${record.check_in_location.landmark_distance}`}
                        </span>
                      </a>
                    )}
                    {record.check_in_location?.accuracy != null && (
                      <p className="text-[11px] text-gray-400 mb-2">GPS accuracy: ±{Math.round(record.check_in_location.accuracy)}m</p>
                    )}
                    {record.check_in_selfie_url && (
                      <img src={record.check_in_selfie_url} alt="Check-in selfie" className="w-full max-w-[160px] rounded-lg border" />
                    )}
                  </div>
                )}
                {record.check_out_time && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <ArrowUpCircle className="w-3 h-3 text-red-500" /> Check Out
                    </p>
                    {record.check_out_location?.latitude && (
                      <a
                        href={`https://www.google.com/maps?q=${record.check_out_location.latitude},${record.check_out_location.longitude}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-xs mb-2 flex items-center gap-1"
                      >
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span>
                          {record.check_out_location.location_address || record.check_out_location.address || 'View on Maps'}
                          {record.check_out_location.landmark_distance && ` — ${record.check_out_location.landmark_distance}`}
                        </span>
                      </a>
                    )}
                    {record.check_out_location?.accuracy != null && (
                      <p className="text-[11px] text-gray-400 mb-2">GPS accuracy: ±{Math.round(record.check_out_location.accuracy)}m</p>
                    )}
                    {record.check_out_selfie_url && (
                      <img src={record.check_out_selfie_url} alt="Check-out selfie" className="w-full max-w-[160px] rounded-lg border" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {record.late_minutes > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 text-sm text-orange-800">
              Late arrival by <strong>{formatMins(record.late_minutes)}</strong>
            </div>
          )}

          {record.auto_closed_reason && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
              <strong>Auto-closed:</strong> {record.auto_closed_reason}
            </div>
          )}

          {record.notes && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600 mb-2">Notes</p>
              <p>{record.notes}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
