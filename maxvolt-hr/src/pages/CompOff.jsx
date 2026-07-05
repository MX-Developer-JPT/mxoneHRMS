import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CalendarPlus, Clock, CheckCircle2, XCircle, RefreshCw, Sun, PartyPopper, Wallet, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES = {
  pending:  'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  redeemed: 'bg-blue-100 text-blue-700',
};

export default function CompOff() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ mine: [], balance: 0, approvals: [], can_approve: false });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workDate, setWorkDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getCompOffData', {});
      const d = res.data || res;
      if (d.success) setData(d);
      else toast.error(d.error || 'Failed to load comp-off data');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const submit = async () => {
    if (!workDate) { toast.error('Pick the Sunday/holiday you worked'); return; }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('requestCompOff', { work_date: workDate, reason });
      const d = res.data || res;
      if (d.success) {
        toast.success('Comp-off request submitted — your manager has been notified');
        setDialogOpen(false); setWorkDate(''); setReason('');
        load();
      } else toast.error(d.error || 'Request failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSubmitting(false);
  };

  const decide = async (id, action) => {
    setDeciding(id + action);
    try {
      const res = await base44.functions.invoke('decideCompOff', { comp_off_id: id, action });
      const d = res.data || res;
      if (d.success) { toast.success(action === 'approve' ? 'Approved — 1 day credited to their Comp Off balance' : 'Rejected'); load(); }
      else toast.error(d.error || 'Failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setDeciding(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <CalendarPlus className="w-6 h-6 text-violet-600" /> Compensatory Off
          </h1>
          <p className="text-gray-500 text-sm mt-1">Worked on a Sunday or a company holiday? Claim a comp-off — once approved it is credited to your leave balance.</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="bg-violet-600 hover:bg-violet-700 text-white">
          <CalendarPlus className="w-4 h-4 mr-2" /> Claim Comp-Off
        </Button>
      </div>

      {/* Balance + quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="pt-5 flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-violet-100 text-violet-600"><Wallet className="w-5 h-5" /></div>
          <div><p className="text-xs text-gray-500">Available balance</p><p className="text-xl font-bold text-gray-800">{data.balance} day{data.balance === 1 ? '' : 's'}</p></div>
        </CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-amber-100 text-amber-600"><Clock className="w-5 h-5" /></div>
          <div><p className="text-xs text-gray-500">Pending requests</p><p className="text-xl font-bold text-gray-800">{data.mine.filter(m => m.status === 'pending').length}</p></div>
        </CardContent></Card>
        <Card><CardContent className="pt-5 flex items-center gap-3">
          <div className="p-2.5 rounded-full bg-green-100 text-green-600"><CheckCircle2 className="w-5 h-5" /></div>
          <div><p className="text-xs text-gray-500">Approved (all time)</p><p className="text-xl font-bold text-gray-800">{data.mine.filter(m => m.status === 'approved').length}</p></div>
        </CardContent></Card>
      </div>

      {/* Approvals queue (managers + HR) */}
      {data.approvals.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500" /> Awaiting your approval ({data.approvals.length})
          </h2>
          {data.approvals.map(a => (
            <Card key={a.id} className="border-amber-200">
              <CardContent className="py-4 flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">{a.employee_name} <span className="text-xs text-gray-400">{a.employee_code} · {a.department}</span></p>
                  <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
                    {a.day_type === 'sunday' ? <Sun className="w-3.5 h-3.5 text-orange-500" /> : <PartyPopper className="w-3.5 h-3.5 text-pink-500" />}
                    Worked on <strong>{a.holiday_name}</strong> — {a.work_date} ({a.days} day{a.days === 1 ? '' : 's'})
                  </p>
                  {a.reason && <p className="text-xs text-gray-400 mt-0.5">"{a.reason}"</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" disabled={!!deciding} onClick={() => decide(a.id, 'reject')}>
                    <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" disabled={!!deciding} onClick={() => decide(a.id, 'approve')}>
                    {deciding === a.id + 'approve' ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />} Approve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* My requests */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-700">My comp-off requests</h2>
        {loading ? (
          <div className="text-center py-10 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></div>
        ) : data.mine.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">
            <CalendarPlus className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            No comp-off claims yet. Work a Sunday or holiday, then claim it here.
          </CardContent></Card>
        ) : data.mine.map(m => (
          <Card key={m.id}>
            <CardContent className="py-4 flex flex-wrap items-center gap-3 justify-between">
              <div>
                <p className="font-medium text-gray-800 flex items-center gap-1.5">
                  {m.day_type === 'sunday' ? <Sun className="w-4 h-4 text-orange-500" /> : <PartyPopper className="w-4 h-4 text-pink-500" />}
                  {m.holiday_name} — {m.work_date}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {m.days} day{m.days === 1 ? '' : 's'} · requested {new Date(m.requested_at).toLocaleDateString('en-IN')}
                  {m.decision_note ? ` · "${m.decision_note}"` : ''}
                </p>
              </div>
              <Badge className={STATUS_STYLES[m.status] || 'bg-gray-100 text-gray-600'}>{m.status.toUpperCase()}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Claim dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarPlus className="w-5 h-5 text-violet-600" /> Claim Comp-Off</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-gray-500">The date must be a Sunday or a company holiday on which you have an attendance punch.</p>
            <div>
              <Label className="text-xs text-gray-500">Worked date</Label>
              <Input type="date" className="mt-1" value={workDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setWorkDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Reason / work done (optional)</Label>
              <Textarea rows={2} className="mt-1" placeholder="e.g. Production support during plant maintenance" value={reason} onChange={e => setReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={submit} disabled={submitting || !workDate}>
                {submitting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CalendarPlus className="w-4 h-4 mr-2" />}
                {submitting ? 'Submitting…' : 'Submit Claim'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
