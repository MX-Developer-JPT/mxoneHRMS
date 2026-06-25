import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { MapPin, Camera, Clock, Coffee, ArrowDownCircle, ArrowUpCircle, Timer, Fingerprint } from 'lucide-react';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';

export default function AttendanceDetailsDialog({ record, employee, open, onClose }) {
  if (!record) return null;

  const statusColors = {
    present: 'bg-green-100 text-green-800',
    absent: 'bg-red-100 text-red-800',
    half_day: 'bg-yellow-100 text-yellow-800',
    leave: 'bg-blue-100 text-blue-800',
    holiday: 'bg-purple-100 text-purple-800',
    week_off: 'bg-gray-100 text-gray-800'
  };

  const formatTime = (iso) => {
    if (!iso) return '-';
    try { return safeDate(iso, 'hh:mm:ss a'); } catch { return iso; }
  };

  const formatHours = (h) => {
    if (h === null || h === undefined) return '-';
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return `${hrs}h ${mins}m`;
  };

  const sessions = record.punch_sessions || [];
  const hasBiometricSessions = sessions.length > 0;
  const hasSelfie = record.check_in_selfie_url || record.check_out_selfie_url;
  const attendanceMethod = record.biometric_synced ? 'biometric' : hasSelfie ? 'selfie' : 'manual';

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
                <Badge className={statusColors[record.status]}>
                  {record.status.replace('_', ' ').toUpperCase()}
                </Badge>
                {attendanceMethod === 'biometric' && (
                  <Badge className="bg-green-100 text-green-700 flex items-center gap-1">
                    <Fingerprint className="w-3 h-3" /> Biometric
                  </Badge>
                )}
                {attendanceMethod === 'selfie' && (
                  <Badge className="bg-blue-100 text-blue-700 flex items-center gap-1">
                    <Camera className="w-3 h-3" /> Selfie + Location
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
              <p className="font-semibold text-sm text-orange-700">{formatTime(record.check_out_time)}</p>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <p className="text-xs text-gray-500 mb-1">Total Work</p>
              <p className="font-semibold text-sm text-blue-700">{formatHours(record.working_hours)}</p>
            </div>
          </div>

          {record.break_hours > 0 && (
            <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
              <Coffee className="w-4 h-4 text-yellow-600" />
              <span className="text-sm text-yellow-800 font-medium">Total Break Time: {formatHours(record.break_hours)}</span>
              {record.total_punches && (
                <span className="ml-auto text-xs text-yellow-600">{record.total_punches} punches recorded</span>
              )}
            </div>
          )}

          {/* Biometric session timeline */}
          {hasBiometricSessions && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Timer className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">Work Sessions</h3>
                <Badge variant="outline" className="ml-auto text-xs">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</Badge>
              </div>

              <div className="space-y-3">
                {sessions.map((session, idx) => (
                  <div key={idx}>
                    {/* Break before this session */}
                    {idx > 0 && session.break_before_hours > 0 && (
                      <div className="flex items-center gap-2 ml-4 my-1 text-xs text-amber-600">
                        <Coffee className="w-3 h-3" />
                        <span>Break: {formatHours(session.break_before_hours)}</span>
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
                          {session.punch_out && (
                            <>
                              <span className="text-gray-300">→</span>
                              <div className="flex items-center gap-1.5">
                                <ArrowUpCircle className="w-4 h-4 text-red-500" />
                                <span className="text-sm font-medium text-red-600">{formatTime(session.punch_out)}</span>
                                <span className="text-xs text-gray-400">OUT</span>
                              </div>
                              <Badge variant="outline" className="text-xs ml-auto">
                                <Clock className="w-3 h-3 mr-1" />
                                {formatHours(session.duration_hours)}
                              </Badge>
                            </>
                          )}
                          {!session.punch_out && (
                            <Badge className="text-xs ml-auto bg-green-100 text-green-700">Currently In</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selfie / manual check-in/out (non-biometric records) */}
          {!hasBiometricSessions && (record.check_in_time || record.check_out_time) && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <Camera className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-base">Attendance Session</h3>
                <Badge variant="outline" className="ml-auto text-xs">1 session</Badge>
              </div>
              {/* Session timeline row */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-4 flex-wrap">
                  {record.check_in_time && (
                    <div className="flex items-center gap-1.5">
                      <ArrowDownCircle className="w-4 h-4 text-green-600" />
                      <span className="text-sm font-medium text-green-700">{formatTime(record.check_in_time)}</span>
                      <span className="text-xs text-gray-400">IN</span>
                    </div>
                  )}
                  {record.check_out_time && (
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
                  )}
                  {!record.check_out_time && record.check_in_time && (
                    <Badge className="text-xs ml-auto bg-green-100 text-green-700">Currently In</Badge>
                  )}
                </div>
              </div>
              {/* Selfie photos + location */}
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
                        <MapPin className="w-3 h-3" /> {record.check_in_location.address || 'View on Maps'}
                      </a>
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
                        <MapPin className="w-3 h-3" /> {record.check_out_location.address || 'View on Maps'}
                      </a>
                    )}
                    {record.check_out_selfie_url && (
                      <img src={record.check_out_selfie_url} alt="Check-out selfie" className="w-full max-w-[160px] rounded-lg border" />
                    )}
                  </div>
                )}
              </div>
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