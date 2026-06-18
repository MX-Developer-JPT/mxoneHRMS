import React, { useState } from 'react';
import { CheckCircle, XCircle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const Check = ({ val }) => val
  ? <CheckCircle className="w-4 h-4 text-green-500" />
  : <XCircle className="w-4 h-4 text-red-400" />;

export default function KYCStatusTable({ employees, users }) {
  const [search, setSearch] = useState('');

  const userMap = {};
  for (const u of (users || [])) userMap[u.id] = u;

  const filtered = (employees || []).filter(emp => {
    const u = userMap[emp.user_id];
    const name = u?.full_name || '';
    return name.toLowerCase().includes(search.toLowerCase()) ||
      (emp.employee_code || '').toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div>
      <div className="mb-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input placeholder="Search employee..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Employee</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">PAN</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">Aadhar</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">Bank</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">UAN</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">ESI No.</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(emp => {
              const u = userMap[emp.user_id];
              const allOk = emp.pan_number && emp.aadhar_number &&
                emp.bank_account?.account_number && emp.uan_number;
              return (
                <tr key={emp.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{u?.full_name || 'N/A'}</p>
                    <p className="text-xs text-gray-400">{emp.employee_code} · {emp.department}</p>
                  </td>
                  <td className="px-3 py-2 text-center"><Check val={emp.pan_number} /></td>
                  <td className="px-3 py-2 text-center"><Check val={emp.aadhar_number} /></td>
                  <td className="px-3 py-2 text-center"><Check val={emp.bank_account?.account_number} /></td>
                  <td className="px-3 py-2 text-center"><Check val={emp.uan_number} /></td>
                  <td className="px-3 py-2 text-center"><Check val={!emp.is_esi_applicable || emp.esi_number} /></td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${allOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {allOk ? 'Complete' : 'Incomplete'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 py-8 text-sm">No employees found</p>
        )}
      </div>
    </div>
  );
}