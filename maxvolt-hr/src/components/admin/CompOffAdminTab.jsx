import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Search, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

// Admin Panel → Comp-Off Requests. Cancels a pending or approved comp-off claim; an approved one is taken back out
// of the employee's Compensatory Off balance, and the employee can then raise a new request for the same date.
export default function CompOffAdminTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('active');
  const [busy, setBusy] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('listCompOffs', {});
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Failed to load');
      setRows(d.comp_offs || []);
    } catch (e) { toast.error('Failed to load comp-offs: ' + e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const cancel = async (c) => {
    const reason = window.prompt(`Cancel ${c.employee_name || 'this'} comp-off for ${c.work_date}?${c.status === 'approved' ? ' The credited day(s) will be taken back from their balance.' : ''}\n\nReason (optional):`);
    if (reason === null) return;
    setBusy(c.id);
    try {
      const res = await base44.functions.invoke('cancelCompOff', { comp_off_id: c.id, reason });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not cancel');
      toast.success(d.credit_not_recovered > 0
        ? `Cancelled. ${d.credit_not_recovered} day(s) could not be taken back because they were already used.`
        : 'Cancelled — the employee can raise a new request.');
      await load();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  const shown = rows
    .filter(c => view === 'all' || (view === 'active' ? ['pending', 'approved'].includes(c.status) : c.status === view))
    .filter(c => !search || `${c.employee_name} ${c.employee_code} ${c.department} ${c.work_date}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Comp-Off Requests</h2>
        <p className="text-sm text-muted-foreground">Cancel a pending or approved comp-off. An approved one is taken back from the employee&apos;s Compensatory Off balance, and they can raise a new request for that date.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {[['active', 'Pending & approved'], ['cancelled', 'Cancelled'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, label]) => (
          <Button key={k} size="sm" variant={view === k ? 'default' : 'outline'} onClick={() => setView(k)}>{label}</Button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search name, code, date" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>
      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No comp-off requests found.</p>
      ) : (
        <div className="border rounded-lg divide-y">
          {shown.map(c => (
            <div key={c.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="font-medium text-sm">{c.employee_name || 'Unknown'} <span className="text-xs text-muted-foreground">· {c.employee_code} · {c.department}</span></p>
                <p className="text-xs text-muted-foreground">Worked {c.work_date} ({c.holiday_name || c.day_type}) · {c.days || 1} day(s){c.reason ? ` · ${c.reason}` : ''}</p>
                {c.status === 'cancelled' && c.cancel_reason && <p className="text-xs text-muted-foreground">Cancelled: {c.cancel_reason}</p>}
              </div>
              <Badge className={STATUS_STYLES[c.status] || 'bg-gray-100 text-gray-600'}>{String(c.status).toUpperCase()}</Badge>
              {['pending', 'approved'].includes(c.status) && (
                <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" disabled={busy === c.id} onClick={() => cancel(c)}>
                  {busy === c.id ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Ban className="w-4 h-4 mr-1.5" />}Cancel
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
