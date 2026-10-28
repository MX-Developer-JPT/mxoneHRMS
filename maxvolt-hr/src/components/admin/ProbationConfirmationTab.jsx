import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Search, BadgeCheck, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

// Admin Panel → Probation & Confirmation. Moves an employee from probation to confirmation (or back).
// A confirmed employee starts earning Earned Leave (EL: 1 day per 20 working days) and may apply for it.
export default function ProbationConfirmationTab() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('probation');
  const [dates, setDates] = useState({});
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const all = await base44.entities.Employee.list();
      setEmployees(all.filter(e => e.user_id && ['probation', 'confirmation'].includes(e.employee_status)));
    } catch (e) { toast.error('Failed to load employees: ' + e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const act = async (emp, action) => {
    if (action === 'revert' && !window.confirm(`Move ${emp.display_name} back to probation? They will stop earning EL and cannot apply for it.`)) return;
    setBusy(emp.user_id);
    try {
      const res = await base44.functions.invoke('confirmEmployee', { user_id: emp.user_id, action, confirmation_date: dates[emp.user_id] || todayIST() });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not update');
      toast.success(action === 'revert' ? `${emp.display_name} is back on probation` : `${emp.display_name} is confirmed — EL starts from ${d.confirmation_date}`);
      await load();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const counts = useMemo(() => ({
    probation: employees.filter(e => e.employee_status === 'probation').length,
    confirmation: employees.filter(e => e.employee_status === 'confirmation').length,
  }), [employees]);

  const rows = employees
    .filter(e => e.employee_status === view)
    .filter(e => !search || `${e.display_name} ${e.employee_code} ${e.department}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || '')));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Probation &amp; Confirmation</h2>
        <p className="text-sm text-muted-foreground">Confirm an employee after probation. From the confirmation date they earn Earned Leave (1 day per 20 working days) and can apply for EL.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[['probation', 'On probation'], ['confirmation', 'Confirmed']].map(([k, label]) => (
          <Button key={k} size="sm" variant={view === k ? 'default' : 'outline'} onClick={() => setView(k)}>{label} ({counts[k]})</Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, code, department" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No employees found.</p>
      ) : (
        <div className="border rounded-lg divide-y">
          {rows.map(emp => (
            <div key={emp.user_id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium text-sm">{emp.display_name} <span className="text-xs text-muted-foreground">· {emp.employee_code}</span></p>
                <p className="text-xs text-muted-foreground">{[emp.designation, emp.department].filter(Boolean).join(' · ')}{emp.date_of_joining ? ` · joined ${String(emp.date_of_joining).slice(0, 10)}` : ''}</p>
              </div>
              {emp.employee_status === 'probation' ? (
                <>
                  <Input type="date" className="w-40" max={todayIST()} value={dates[emp.user_id] || todayIST()} onChange={e => setDates(d => ({ ...d, [emp.user_id]: e.target.value }))} />
                  <Button size="sm" disabled={busy === emp.user_id} onClick={() => act(emp, 'confirm')}>
                    {busy === emp.user_id ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <BadgeCheck className="w-4 h-4 mr-1.5" />}Confirm
                  </Button>
                </>
              ) : (
                <>
                  <Badge variant="secondary">Confirmed {String(emp.employee_confirmation_date || emp.confirmation_date || '').slice(0, 10) || ''}</Badge>
                  <Button size="sm" variant="outline" disabled={busy === emp.user_id} onClick={() => act(emp, 'revert')}>
                    <Undo2 className="w-4 h-4 mr-1.5" />Back to probation
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
