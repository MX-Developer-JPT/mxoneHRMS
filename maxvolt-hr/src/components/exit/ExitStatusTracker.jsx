import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, XCircle, Clock, User, Calendar, AlertCircle } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

const STEPS = [
  { key: 'submitted', label: 'Resignation Submitted', desc: 'Your resignation has been received' },
  { key: 'manager_approved', label: 'Manager Approval', desc: 'Awaiting reporting manager approval' },
  { key: 'hr_approved', label: 'HR Approval', desc: 'Awaiting HR department approval' },
  { key: 'in_notice', label: 'Notice Period', desc: 'Serving notice period' },
  { key: 'clearance_pending', label: 'Department Clearance', desc: 'Clearing all departments' },
  { key: 'fnf_pending', label: 'F&F Settlement', desc: 'Final settlement processing' },
  { key: 'completed', label: 'Exit Completed', desc: 'All formalities done' },
];

const STATUS_ORDER = ['submitted', 'manager_approved', 'hr_approved', 'in_notice', 'clearance_pending', 'clearance_done', 'fnf_pending', 'completed'];

export default function ExitStatusTracker({ exitRecord, employee, onRefresh }) {
  const currentIdx = STATUS_ORDER.indexOf(exitRecord.status);
  const lwd = exitRecord.last_working_date ? new Date(exitRecord.last_working_date) : null;
  const daysLeft = lwd ? differenceInDays(lwd, new Date()) : null;
  const isRejected = exitRecord.status === 'manager_rejected' || exitRecord.status === 'hr_rejected';

  const getStepStatus = (key) => {
    if (exitRecord.status === 'manager_rejected' && (key === 'manager_approved' || key === 'hr_approved' || key === 'in_notice' || key === 'clearance_pending' || key === 'fnf_pending' || key === 'completed')) return 'blocked';
    if (exitRecord.status === 'hr_rejected' && (key === 'hr_approved' || key === 'in_notice' || key === 'clearance_pending' || key === 'fnf_pending' || key === 'completed')) return 'blocked';
    const stepIdx = STATUS_ORDER.indexOf(key);
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'current';
    return 'pending';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="w-5 h-5" /> Exit Progress</CardTitle></CardHeader>
        <CardContent>
          {isRejected && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex gap-3">
              <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-700">Resignation Rejected</p>
                <p className="text-sm text-red-600 mt-1">{exitRecord.manager_action === 'rejected' ? exitRecord.manager_comment : exitRecord.hr_comment}</p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            {STEPS.map((step, i) => {
              const st = getStepStatus(step.key);
              return (
                <div key={step.key} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${st === 'done' ? 'bg-green-500' : st === 'current' ? 'bg-blue-500' : st === 'blocked' ? 'bg-red-200' : 'bg-gray-200'}`}>
                      {st === 'done' ? <CheckCircle2 className="w-4 h-4 text-white" /> : st === 'blocked' ? <XCircle className="w-4 h-4 text-red-400" /> : <span className={`text-xs font-bold ${st === 'current' ? 'text-white' : 'text-gray-400'}`}>{i + 1}</span>}
                    </div>
                    {i < STEPS.length - 1 && <div className={`w-0.5 h-8 mt-1 ${st === 'done' ? 'bg-green-300' : 'bg-gray-200'}`} />}
                  </div>
                  <div className={`pb-4 ${st === 'current' ? 'text-blue-700' : st === 'done' ? 'text-gray-700' : 'text-gray-400'}`}>
                    <p className={`font-semibold text-sm ${st === 'current' ? 'text-blue-700' : ''}`}>{step.label}</p>
                    <p className="text-xs mt-0.5">{step.desc}</p>
                    {st === 'current' && <Badge className="mt-1 bg-blue-100 text-blue-700 text-xs">Current Stage</Badge>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-orange-500" />
              <div>
                <p className="text-xs text-gray-500">Last Working Day</p>
                <p className="font-bold">{lwd ? format(lwd, 'MMM d, yyyy') : '—'}</p>
                {daysLeft !== null && daysLeft >= 0 && <p className="text-xs text-orange-600">{daysLeft} days remaining</p>}
                {daysLeft !== null && daysLeft < 0 && <p className="text-xs text-gray-500">Completed</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-purple-500" />
              <div>
                <p className="text-xs text-gray-500">Notice Period</p>
                <p className="font-bold">{exitRecord.notice_period_days || 0} days</p>
                <p className="text-xs text-gray-400">Served: {exitRecord.notice_served_days || 0} days</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <User className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-xs text-gray-500">Exit Type</p>
                <p className="font-bold capitalize">{exitRecord.exit_type?.replace('_', ' ')}</p>
                <p className="text-xs text-gray-400 capitalize">{exitRecord.reason_category?.replace(/_/g, ' ')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {exitRecord.audit_log?.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Activity Log</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[...exitRecord.audit_log].reverse().map((log, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                  <div>
                    <span className="font-medium">{log.actor_name}</span>
                    <span className="text-gray-500"> — {log.action}</span>
                    {log.comment && <p className="text-xs text-gray-400 italic">"{log.comment}"</p>}
                    <p className="text-xs text-gray-400">{log.timestamp ? format(new Date(log.timestamp), 'MMM d, yyyy h:mm a') : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}