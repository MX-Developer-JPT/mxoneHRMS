import React from 'react';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import { Badge } from '@/components/ui/badge';

export default function AuditLogTable({ logs }) {
  const actionColor = {
    COMPUTE_COMPLIANCE: 'bg-blue-100 text-blue-700',
    UPDATE_COMPLIANCE_STATUS: 'bg-purple-100 text-purple-700',
    MARK_DEADLINE_COMPLETE: 'bg-green-100 text-green-700',
  };

  return (
    <div>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {(logs || []).length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">No audit logs found</p>
        )}
        {(logs || []).map(log => (
          <div key={log.id} className="border rounded-lg p-3 bg-white space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${actionColor[log.action] || 'bg-gray-100 text-gray-600'}`}>
                {log.action?.replace(/_/g, ' ')}
              </span>
              <span className="text-xs text-gray-400">
                {log.created_date ? safeDate(log.created_date, 'dd MMM yy, HH:mm') : '—'}
              </span>
            </div>
            <div className="text-xs text-gray-600">
              <span className="font-medium">{log.actor_name || log.actor_id}</span>
              {log.module && <span className="ml-2 text-gray-400">· {log.module}</span>}
            </div>
            {(log.new_value || log.old_value || log.remarks) && (
              <p className="text-xs text-gray-500">
                {log.new_value && <span className="text-green-600">{log.new_value}</span>}
                {log.old_value && <span className="text-gray-400"> (was: {log.old_value})</span>}
                {log.remarks && <span className="ml-1">— {log.remarks}</span>}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Action</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Module</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Actor</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Details</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Timestamp</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(logs || []).map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor[log.action] || 'bg-gray-100 text-gray-600'}`}>
                    {log.action?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">{log.module}</td>
                <td className="px-3 py-2 text-gray-700 font-medium text-xs">{log.actor_name || log.actor_id}</td>
                <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate">
                  {log.new_value && <span className="text-green-600">{log.new_value}</span>}
                  {log.old_value && <span className="text-gray-400"> (was: {log.old_value})</span>}
                  {log.remarks && <span className="ml-1 text-gray-400">— {log.remarks}</span>}
                </td>
                <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                  {log.created_date ? safeDate(log.created_date, 'dd MMM yyyy, HH:mm') : '—'}
                </td>
              </tr>
            ))}
            {(!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="text-center text-gray-400 py-8 text-sm">No audit logs found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}