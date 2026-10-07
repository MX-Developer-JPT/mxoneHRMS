import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

// Active employees (user_id, name, department…) — loaded once and shared by the L&D tabs.
let cache = null;
export function useEmployees() {
  const [emps, setEmps] = useState(cache || []);
  useEffect(() => {
    if (cache) return;
    base44.entities.Employee.list().then(list => {
      cache = (list || []).filter(e => e.user_id && e.status !== 'inactive').sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
      setEmps(cache);
    }).catch(() => {});
  }, []);
  return emps;
}

export const EmployeeSelect = ({ value, onChange, emps, placeholder = 'Select employee', className = '' }) => (
  <select className={`h-9 w-full rounded-md border bg-white px-2 text-sm ${className}`} value={value || ''} onChange={e => onChange(e.target.value)}>
    <option value="">{placeholder}</option>
    {emps.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name} · {e.employee_code || ''} · {e.department || ''}</option>)}
  </select>
);

export const Tile = ({ label, value, tone = '', sub }) => (
  <div className="rounded-xl border bg-white p-4">
    <div className={`text-2xl font-bold ${tone || 'text-gray-900'}`}>{value ?? '—'}</div>
    <div className="text-xs text-gray-500">{label}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

export const Field = ({ label, children, className = '' }) => (
  <label className={`block text-xs text-gray-600 ${className}`}>{label}<div className="mt-1">{children}</div></label>
);
