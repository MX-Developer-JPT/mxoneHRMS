import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Search, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { fmtDate } from '@/lib/assetDates';

// Admin Panel -> Leave Cancellation. Cancels an APPROVED leave: the days return to the employee's balance, the leave is removed
// from their attendance calendar, they are notified, and the leave stays on record as cancelled with who did it and why.
export default function LeaveCancelTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('approved');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('listApprovedLeaves', {});
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Failed to load');
      setRows(d.leaves || []);
    } catch (e) { toast.error(e.message || 'Could not load leaves'); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter(r => r.status === view && (!s || [r.employee_name, r.employee_code, r.department, r.leave_type].join(' ').toLowerCase().includes(s)));
  }, [rows, search, view]);

  const confirm = async () => {
    if (reason.trim().length < 3) { toast.error('Please give a reason'); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('cancelApprovedLeave', { leave_id: target.id, reason: reason.trim() });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not cancel');
      toast.success(`Leave cancelled${d.balance_restored ? ` - ${d.balance_restored} day(s) returned to the balance` : ''}`);
      setTarget(null); setReason('');
      load();
    } catch (e) { toast.error(e.message || 'Could not cancel'); }
    setBusy(false);
  };

  const range = (r) => (r.start_date === r.end_date ? fmtDate(r.start_date, 'dd MMM yyyy') : `${fmtDate(r.start_date, 'dd MMM yyyy')} - ${fmtDate(r.end_date, 'dd MMM yyyy')}`);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Leave Cancellation</h2>
        <p className="text-sm text-muted-foreground">Cancel a leave that was already approved. The days go back to the employee's balance and the leave is removed from their attendance.</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search employee, code, department, leave type" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="inline-flex rounded-md border overflow-hidden text-sm">
          {[['approved', 'Approved'], ['cancelled', 'Cancelled']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setView(k)} className={`px-3 py-1.5 ${view === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{l}</button>
          ))}
        </div>
      </div>

      {loading ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No {view} leaves found.</p>
      ) : (
        <div className="space-y-2">
          {shown.map(r => (
            <div key={r.id} className="border rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.employee_name || 'Unknown'}</span><span className="text-xs text-muted-foreground">{r.employee_code}</span>
                  <Badge variant="outline" className="text-[10px]">{r.is_wfh ? 'Work from home' : r.leave_type || 'Leave'}</Badge>
                  {r.half_day && <Badge className="bg-blue-100 text-blue-700 text-[10px]">Half day</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{range(r)} · {r.total_days} day(s){r.approved_by_name ? ` · approved by ${r.approved_by_name}` : ''}{r.reason ? ` · "${r.reason}"` : ''}</p>
                {r.status === 'cancelled' && <p className="text-xs text-gray-600 mt-0.5">Cancelled by {r.cancelled_by_name || '—'}{r.cancelled_at ? ` on ${fmtDate(r.cancelled_at, 'dd MMM yyyy, hh:mm a')}` : ''}: {r.cancel_reason}</p>}
              </div>
              {r.status === 'approved' && <Button size="sm" variant="outline" className="text-red-600" onClick={() => { setTarget(r); setReason(''); }}><Ban className="w-4 h-4 mr-1" /> Cancel leave</Button>}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o) setTarget(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader><DialogTitle>Cancel approved leave</DialogTitle></DialogHeader>
          {target && <p className="text-sm"><strong>{target.employee_name}</strong> — {range(target)} ({target.total_days} day{target.total_days === 1 ? '' : 's'}). {target.is_wfh ? '' : 'The days will be returned to their leave balance. '}The employee is notified with your reason.</p>}
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for cancelling (required)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Keep leave</Button>
            <Button variant="destructive" onClick={confirm} disabled={busy}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Cancel leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
