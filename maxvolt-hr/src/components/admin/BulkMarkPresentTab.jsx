import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Undo2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const call = async (name, params) => { const r = await base44.functions.invoke(name, params); const d = r?.data || r; if (d && d.success === false) throw new Error(d.error || 'Request failed'); return d; };
const clock = (iso) => { const m = /T(\d{2}):(\d{2})/.exec(String(iso || '')); if (!m) return '—'; let h = Number(m[1]); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${String(h).padStart(2, '0')}:${m[2]} ${ap}`; };
const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// Admin Panel -> Bulk Mark Present: pick a date, preview, then mark everyone who has an attendance record that day as full-day present.
export default function BulkMarkPresentTab() {
  const [date, setDate] = useState('');
  const [includeNoCheckin, setIncludeNoCheckin] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [batches, setBatches] = useState([]);

  const loadBatches = async () => { try { setBatches((await call('listBulkAttendanceBatches', {})).batches || []); } catch { /* admin only; ignore */ } };
  useEffect(() => { loadBatches(); }, []);

  const runPreview = async () => {
    if (!date) { toast.error('Choose a date'); return; }
    setBusy('preview');
    try { setPreview(await call('bulkMarkPresent', { date, include_no_checkin: includeNoCheckin, dry_run: true })); }
    catch (e) { toast.error(e.message); setPreview(null); }
    setBusy('');
  };
  const apply = async () => {
    setBusy('apply');
    try {
      const d = await call('bulkMarkPresent', { date, include_no_checkin: includeNoCheckin, dry_run: false, reason });
      toast.success(`${d.marked} employee(s) marked present for ${date}`);
      setConfirmOpen(false); setReason(''); setPreview(null); loadBatches();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const undo = async (b) => {
    if (!window.confirm(`Undo the batch for ${b.date}? The ${b.count} record(s) return to exactly how they were before. Days edited again since are left alone.`)) return;
    setBusy('undo' + b.id);
    try { const d = await call('undoBulkAttendanceBatch', { batch_id: b.id }); toast.success(`${d.restored} restored${d.left_unchanged ? `, ${d.left_unchanged} left as they are (edited later)` : ''}`); loadBatches(); }
    catch (e) { toast.error(e.message); }
    setBusy('');
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Bulk Mark Present</h2>
        <p className="text-sm text-muted-foreground">Pick a date and mark everyone who has an attendance record that day as a full-day present. People with no real check-out get a check-out at their own shift end. Anyone on leave is skipped. You always see a preview first, and every run can be undone.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="text-xs font-medium">Date</label><Input type="date" max={todayIst()} value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} className="w-44" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeNoCheckin} onChange={(e) => { setIncludeNoCheckin(e.target.checked); setPreview(null); }} />Also include records with no check-in (e.g. auto-marked absent)</label>
        <Button onClick={runPreview} disabled={!date || !!busy}>{busy === 'preview' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Eye className="w-4 h-4 mr-1.5" />}Preview</Button>
      </div>

      {preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[['Records that day', preview.records], ['Will be marked present', preview.to_mark], ['Check-out set to shift end', preview.checkout_will_be_set], ['Left unchanged', preview.skipped]].map(([l, v]) => (
              <div key={l} className="rounded-lg border p-3"><p className="text-[11px] text-muted-foreground">{l}</p><p className="text-2xl font-bold">{v}</p></div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Current status of those to change: {Object.entries(preview.by_status || {}).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(' · ') || '—'}. Left unchanged: {Object.entries(preview.skipped_by_reason || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}.</p>
          <div className="border rounded-lg max-h-80 overflow-y-auto divide-y text-sm">
            {preview.people_to_mark.length === 0 ? <p className="p-4 text-center text-muted-foreground">Nobody to change for this date.</p> : preview.people_to_mark.map((x) => (
              <div key={x.user_id} className="p-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{x.name}</span><span className="text-xs text-muted-foreground">{x.code} · {x.department}</span>
                <Badge variant="outline" className="text-[10px]">{String(x.was || 'record').replace(/_/g, ' ')}</Badge>
                <span className="text-xs ml-auto">in {clock(x.check_in)} · out {clock(x.check_out)}{x.new_check_out ? ` → ${clock(x.new_check_out)}` : ''}{x.late_minutes ? ` · ${x.late_minutes}m late` : ''}</span>
              </div>
            ))}
          </div>
          <Button disabled={!preview.to_mark || !!busy} onClick={() => setConfirmOpen(true)}><CheckCircle2 className="w-4 h-4 mr-1.5" />Mark {preview.to_mark} present…</Button>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-2">Previous runs</h3>
        {batches.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <div className="border rounded-lg divide-y text-sm">
            {batches.map((b) => (
              <div key={b.id} className="p-3 flex flex-wrap items-center gap-2">
                <span className="font-medium">{b.date}</span><span>{b.count} marked</span>
                <span className="text-xs text-muted-foreground">by {b.by_name} · {new Date(b.at).toLocaleString('en-IN')} · “{b.reason}”</span>
                {b.undone ? <Badge className="bg-gray-200 text-gray-700">Undone {b.undone_by_name ? `by ${b.undone_by_name}` : ''}</Badge>
                  : <Button size="sm" variant="outline" className="ml-auto" disabled={!!busy} onClick={() => undo(b)}>{busy === 'undo' + b.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Undo2 className="w-3.5 h-3.5 mr-1" />}Undo</Button>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Mark {preview?.to_mark} employee(s) present on {date}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This changes the attendance of {preview?.to_mark} people to full-day present. The original records are saved so you can undo it.</p>
          <Input placeholder="Reason (required, shown on each corrected day)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button disabled={reason.trim().length < 5 || !!busy} onClick={apply}>{busy === 'apply' && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
