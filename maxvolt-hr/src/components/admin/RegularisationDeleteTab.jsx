import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { fmtDate } from '@/lib/assetDates';

const call = async (name, args) => { const r = await base44.functions.invoke(name, args); return r?.data || r; };
const nice = (s) => String(s || '').replace(/_/g, ' ');
const STATUS = { pending: 'bg-amber-100 text-amber-800', manager_approved: 'bg-blue-100 text-blue-800', completed: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-600', sent_back: 'bg-purple-100 text-purple-800' };
// attendance times are stored as India clock digits, so they are shown exactly as written
const clock = (t) => (t ? String(t).slice(11, 16) : '—');
const day = (d) => (d ? <><span className="capitalize font-medium">{nice(d.status) || 'No status'}</span> · in {clock(d.check_in_time)} · out {clock(d.check_out_time)}{d.regularised ? ' · regularised' : ''}</> : 'No record');

// Admin Panel → Regularisation Deletion. Removes a request completely, in any status, and puts the day's attendance back.
export default function RegularisationDeleteTab() {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [month, setMonth] = useState('');
  const [target, setTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await call('rg_list', { search, status, month }); setRows(d.requests || []); setTotal(d.total || 0); }
    catch (e) { toast.error(e.message); setRows([]); }
  }, [search, status, month]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const open = async (r) => {
    setTarget(r); setReason(''); setPreview(null);
    try { setPreview(await call('rg_preview', { regularisation_id: r.id })); }
    catch (e) { toast.error(e.message); setTarget(null); load(); }
  };

  const remove = async () => {
    setBusy(true);
    try { await call('rg_delete', { regularisation_id: target.id, reason: reason.trim() }); toast.success('Regularisation request deleted'); setTarget(null); load(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Regularisation Deletion</h2>
        <p className="text-sm text-muted-foreground">Cancel and permanently delete a regularisation request in any status. If it had changed attendance, the day is put back. The employee is notified, the monthly request limit is freed, and the audit log records who deleted it.</p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" /><Input className="pl-8" placeholder="Search employee, code, department" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select aria-label="Status" className="h-9 border rounded-md px-2 text-sm bg-background" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{Object.keys(STATUS).map((s) => <option key={s} value={s}>{nice(s)}</option>)}
        </select>
        <Input type="month" aria-label="Attendance month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      {!rows ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No regularisation requests found.</p>
      ) : (
        <div className="space-y-2">
          {total > rows.length && <p className="text-xs text-muted-foreground">Showing the latest {rows.length} of {total}. Search or choose a month to narrow the list.</p>}
          {rows.map((r) => (
            <div key={r.id} className="border rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.employee_name || 'Unknown'}</span><span className="text-xs text-muted-foreground">{r.employee_code}</span>
                  <Badge className={`text-[10px] capitalize ${STATUS[r.status] || 'bg-gray-100 text-gray-600'}`}>{nice(r.status)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">For {fmtDate(r.date, 'dd MMM yyyy')} · asked: {nice(r.requested_status)}{r.requested_check_in ? ` · in ${r.requested_check_in}` : ''}{r.requested_check_out ? ` · out ${r.requested_check_out}` : ''}{r.reason ? ` · "${r.reason}"` : ''}</p>
              </div>
              <Button size="sm" variant="outline" className="text-red-600" onClick={() => open(r)}><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(o) => { if (!o && !busy) setTarget(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>Delete regularisation request</DialogTitle></DialogHeader>
          {target && <p className="text-sm"><strong>{target.employee_name}</strong> {target.employee_code} — {fmtDate(target.date, 'dd MMM yyyy')} ({nice(target.status)}).</p>}
          {!preview ? <div className="py-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
            <div className="text-sm border rounded-lg p-3 space-y-1 bg-muted/40">
              {preview.action === 'unchanged' ? <p>{preview.note}</p> : (
                <>
                  <p>Attendance now: {day(preview.before)}</p>
                  <p>After deleting: {day(preview.after)}</p>
                  <p className="text-xs text-muted-foreground">{preview.note} Payroll already processed for that month is not recalculated.</p>
                </>
              )}
            </div>
          )}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for deleting (required, sent to the employee)" />
          <p className="text-xs text-red-600">This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>Keep request</Button>
            <Button variant="destructive" onClick={remove} disabled={busy || !preview || reason.trim().length < 3}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
