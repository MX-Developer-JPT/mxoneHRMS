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

// Searchable checklist for picking several employees at once.
export function EmployeeMultiSelect({ emps, value = [], onChange }) {
  const [q, setQ] = useState('');
  const shown = emps.filter(e => `${e.display_name} ${e.employee_code} ${e.department}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const allShown = shown.length > 0 && shown.every(e => value.includes(e.user_id));
  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center gap-2 p-2 border-b">
        <input className="h-8 flex-1 rounded border px-2 text-sm" placeholder="Search name, code, department…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className="text-xs text-blue-700 hover:underline whitespace-nowrap" onClick={() => onChange(allShown ? value.filter(x => !shown.some(e => e.user_id === x)) : [...new Set([...value, ...shown.map(e => e.user_id)])])}>{allShown ? 'Clear shown' : 'Select all shown'}</button>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {shown.length === 0 && <div className="p-3 text-xs text-gray-500">No employees match.</div>}
        {shown.map(e => (
          <label key={e.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={value.includes(e.user_id)} onChange={() => toggle(e.user_id)} />
            <span className="flex-1">{e.display_name} <span className="text-xs text-gray-400">{e.employee_code || ''} · {e.department || ''}</span></span>
          </label>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t text-xs text-gray-500">{value.length} selected</div>
    </div>
  );
}

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
