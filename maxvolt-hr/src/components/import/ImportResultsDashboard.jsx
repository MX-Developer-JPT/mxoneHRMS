import React from 'react';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, UserCheck, Clock, Key, AlertTriangle } from 'lucide-react';

const statusConfig = {
  created: { label: 'Account Created', icon: CheckCircle2, color: 'bg-green-100 text-green-700' },
  already_exists: { label: 'Already Exists', icon: UserCheck, color: 'bg-blue-100 text-blue-700' },
  invite_failed: { label: 'Failed', icon: XCircle, color: 'bg-red-100 text-red-700' },
  error: { label: 'Error', icon: AlertTriangle, color: 'bg-red-100 text-red-700' },
  warning: { label: 'Warning', icon: AlertTriangle, color: 'bg-yellow-100 text-yellow-700' },
};

export default function ImportResultsDashboard({ results }) {
  const created = results.filter(r => r.status === 'created').length;
  const alreadyExists = results.filter(r => r.status === 'already_exists').length;
  const failed = results.filter(r => r.status === 'invite_failed' || r.status === 'error').length;
  const warnings = results.filter(r => r.status === 'warning').length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-green-50 rounded-lg p-3 text-center border border-green-100">
          <p className="text-2xl font-bold text-green-700">{created}</p>
          <p className="text-xs text-green-600 mt-0.5">Accounts Created</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-100">
          <p className="text-2xl font-bold text-blue-700">{alreadyExists}</p>
          <p className="text-xs text-blue-600 mt-0.5">Already Existed</p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-3 text-center border border-yellow-100">
          <p className="text-2xl font-bold text-yellow-700">{warnings}</p>
          <p className="text-xs text-yellow-600 mt-0.5">Warnings</p>
        </div>
        <div className="bg-red-50 rounded-lg p-3 text-center border border-red-100">
          <p className="text-2xl font-bold text-red-700">{failed}</p>
          <p className="text-xs text-red-600 mt-0.5">Failed</p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Key className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Accounts created — employees will set passwords via invite email</p>
            <p className="text-xs text-blue-600 mt-0.5">
              All records (Employee profile, Salary Structure, Leave Balances) are linked to user accounts immediately. Employees will receive an email to set their password and can log in right away.
            </p>
          </div>
        </div>
      </div>

      {/* Result Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-3 py-2 text-gray-600 font-medium">Name</th>
              <th className="text-left px-3 py-2 text-gray-600 font-medium">Email</th>
              <th className="text-left px-3 py-2 text-gray-600 font-medium">Emp. Code</th>
              <th className="text-left px-3 py-2 text-gray-600 font-medium">Account</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => {
              const cfg = statusConfig[r.status] || statusConfig.error;
              const StatusIcon = cfg.icon;
              return (
                <tr key={i} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700 font-medium">{r.name || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{r.email}</td>
                  <td className="px-3 py-2 text-gray-500">{r.employee_code || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {cfg.label}
                    </span>
                    {r.note && <p className="text-xs text-gray-400 mt-0.5">{r.note}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}