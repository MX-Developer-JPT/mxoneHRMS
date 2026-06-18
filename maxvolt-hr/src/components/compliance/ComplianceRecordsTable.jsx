import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import MobileSelect from '@/components/MobileSelect';

const StatusBadge = ({ status }) => {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-700',
    filed: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    deposited: 'bg-green-100 text-green-700',
    deducted: 'bg-teal-100 text-teal-700',
    overdue: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
};

export default function ComplianceRecordsTable({ records, users, onStatusUpdate }) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');

  const userMap = {};
  for (const u of (users || [])) userMap[u.id] = u;

  const filtered = (records || []).filter(r => {
    const u = userMap[r.user_id];
    const name = u?.full_name || '';
    const matchSearch = name.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (filterType === 'pf_pending') return r.pf_applicable && r.pf_status === 'pending';
    if (filterType === 'esi_pending') return r.esi_applicable && r.esi_status === 'pending';
    if (filterType === 'tds_pending') return r.tds_amount > 0 && r.tds_status === 'pending';
    if (filterType === 'min_wage_violation') return !r.minimum_wage_compliant;
    return true;
  });

  const fmt = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <Input placeholder="Search employee..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <MobileSelect
          value={filterType}
          onValueChange={setFilterType}
          placeholder="Filter"
          label="Filter Records"
          className="w-48"
          options={[
            { value: 'all', label: 'All Records' },
            { value: 'pf_pending', label: 'PF Pending' },
            { value: 'esi_pending', label: 'ESI Pending' },
            { value: 'tds_pending', label: 'TDS Pending' },
            { value: 'min_wage_violation', label: 'Min Wage Violation' },
          ]}
        />
      </div>
      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {filtered.map(r => {
          const u = userMap[r.user_id];
          return (
            <div key={r.id} className="border rounded-lg p-3 bg-white space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-medium text-gray-800">{u?.full_name || 'N/A'}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.minimum_wage_compliant ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {r.minimum_wage_compliant ? '✓ Min Wage' : '✗ Violation'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>Gross: <strong>{fmt(r.gross_salary)}</strong></span>
                {r.tds_amount > 0 && <span>TDS: <strong>{fmt(r.tds_amount)}</strong></span>}
                {r.pf_applicable && (
                  <span>PF: <strong>{fmt(r.pf_employee_contribution)}+{fmt(r.pf_employer_contribution)}</strong> — <StatusBadge status={r.pf_status} /></span>
                )}
                {r.esi_applicable && (
                  <span>ESI: <strong>{fmt(r.esi_employee_contribution)}+{fmt(r.esi_employer_contribution)}</strong> — <StatusBadge status={r.esi_status} /></span>
                )}
                {r.pt_applicable && <span>PT: <strong>{fmt(r.pt_amount)}</strong></span>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No records found</p>}
      </div>

      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs">Employee</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-right">Gross</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-right">PF (Ee+Er)</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">PF Status</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-right">ESI (Ee+Er)</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">ESI Status</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-right">TDS</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-right">PT</th>
              <th className="px-3 py-2 font-semibold text-gray-600 text-xs text-center">Min Wage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(r => {
              const u = userMap[r.user_id];
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">{u?.full_name || 'N/A'}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmt(r.gross_salary)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {r.pf_applicable ? `${fmt(r.pf_employee_contribution)} + ${fmt(r.pf_employer_contribution)}` : <span className="text-gray-400 text-xs">N/A</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.pf_applicable ? <StatusBadge status={r.pf_status} /> : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {r.esi_applicable ? `${fmt(r.esi_employee_contribution)} + ${fmt(r.esi_employer_contribution)}` : <span className="text-gray-400 text-xs">N/A</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.esi_applicable ? <StatusBadge status={r.esi_status} /> : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{r.tds_amount > 0 ? fmt(r.tds_amount) : <span className="text-gray-400 text-xs">—</span>}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{r.pt_applicable ? fmt(r.pt_amount) : <span className="text-gray-400 text-xs">—</span>}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.minimum_wage_compliant ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {r.minimum_wage_compliant ? '✓' : '✗ Violation'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No records found</p>}
      </div>
    </div>
  );
}