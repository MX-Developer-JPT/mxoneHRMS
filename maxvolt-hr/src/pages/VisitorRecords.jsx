import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Users, Search, Download, Loader2, DoorOpen, UserCheck, Footprints, MailCheck, Clock, X } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { toast } from 'sonner';

const STATUS_COLORS = {
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  checked_in: 'bg-green-100 text-green-800',
  checked_out: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS = {
  pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected',
  checked_in: 'Currently Inside', checked_out: 'Checked Out', cancelled: 'Cancelled',
};
const CATEGORY_LABELS = { guest: 'Guest', vendor: 'Vendor', client: 'Client', interview: 'Interview Candidate', delivery: 'Delivery / Courier', other: 'Other' };
const PAGE_SIZE = 100;

const isWalkIn = (v) => (v.source || 'pre_registered') === 'walk_in';
// Same "visit date" the server-side export filters on.
const visitDate = (v) => String(v.expected_arrival || v.check_in_time || '').slice(0, 10);
const durationMin = (v) => {
  if (!v.check_in_time || !v.check_out_time) return null;
  const m = Math.round((new Date(String(v.check_out_time).replace(/Z$/, '')) - new Date(String(v.check_in_time).replace(/Z$/, ''))) / 60000);
  return isFinite(m) && m >= 0 ? m : null;
};
const fmtDuration = (m) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const fmt = (t, f = 'dd MMM yyyy, h:mm a') => (t ? safeDate(t, f) : '—');

function downloadBase64Xlsx(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const Field = ({ label, children }) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
    <p className="text-sm text-gray-800 break-words">{children || '—'}</p>
  </div>
);

export default function VisitorRecords() {
  const [loading, setLoading] = useState(true);
  const [visitors, setVisitors] = useState([]);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [location, setLocation] = useState('all');
  const [category, setCategory] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getVisitorsScoped', {});
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not load visitors');
      setVisitors(d.visitors || []);
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load visitors');
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const locations = useMemo(() => [...new Set(visitors.map(v => v.location_name).filter(Boolean))].sort(), [visitors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visitors
      .filter(v => {
        const d = visitDate(v);
        if (from && d < from) return false;
        if (to && d > to) return false;
        if (type !== 'all' && (isWalkIn(v) ? 'walk_in' : 'pre_registered') !== type) return false;
        if (status !== 'all' && v.status !== status) return false;
        if (location !== 'all' && v.location_name !== location) return false;
        if (category !== 'all' && v.visitor_category !== category) return false;
        if (q && ![v.visitor_name, v.mobile_number, v.company, v.host_name, v.purpose, v.vehicle_number].some(x => String(x || '').toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => String(b.expected_arrival || b.check_in_time || '').localeCompare(String(a.expected_arrival || a.check_in_time || '')));
  }, [visitors, search, type, status, location, category, from, to]);

  const stats = useMemo(() => ({
    total: filtered.length,
    invited: filtered.filter(v => !isWalkIn(v)).length,
    walkIn: filtered.filter(isWalkIn).length,
    inside: filtered.filter(v => v.status === 'checked_in').length,
    out: filtered.filter(v => v.status === 'checked_out').length,
    pending: filtered.filter(v => v.status === 'pending_approval').length,
  }), [filtered]);

  const filtersActive = search || type !== 'all' || status !== 'all' || location !== 'all' || category !== 'all' || from || to;
  const clearFilters = () => { setSearch(''); setType('all'); setStatus('all'); setLocation('all'); setCategory('all'); setFrom(''); setTo(''); setShown(PAGE_SIZE); };

  const handleExport = async (all) => {
    setExporting(true);
    try {
      const params = all ? {} : { from, to, location, status, source: type, category, search };
      const res = await base44.functions.invoke('exportVisitors', params);
      const d = res?.data || res;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Export failed');
      downloadBase64Xlsx(d.base64, d.filename);
      toast.success(`Exported ${d.total} visitor record${d.total === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e.message || 'Export failed');
    }
    setExporting(false);
  };

  const sel = (value, onChange, options, label) => (
    <select
      value={value}
      onChange={e => { onChange(e.target.value); setShown(PAGE_SIZE); }}
      aria-label={label}
      className="border border-input rounded-md px-2.5 h-9 text-sm bg-background min-w-[130px]"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const rows = filtered.slice(0, shown);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Users className="w-7 h-7 text-blue-600" /> Visitor Records</h1>
            <p className="text-gray-600 mt-1 text-sm">Every visitor logged by the gate admins — invited (pre-registered) and walk-in — across all locations.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => handleExport(false)} disabled={exporting || !filtered.length}>
              {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Export {filtersActive ? 'Filtered' : 'All'} (Excel)
            </Button>
            {filtersActive && (
              <Button variant="outline" onClick={() => handleExport(true)} disabled={exporting}>
                <Download className="w-4 h-4 mr-2" /> Export All Visitors
              </Button>
            )}
          </div>
        </div>

        {error && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">{error}</CardContent></Card>}

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: stats.total, icon: Users, cls: 'text-gray-700' },
            { label: 'Invited', value: stats.invited, icon: MailCheck, cls: 'text-indigo-600' },
            { label: 'Walk-in', value: stats.walkIn, icon: Footprints, cls: 'text-orange-600' },
            { label: 'Inside Now', value: stats.inside, icon: DoorOpen, cls: 'text-green-600' },
            { label: 'Checked Out', value: stats.out, icon: UserCheck, cls: 'text-gray-600' },
            { label: 'Pending Approval', value: stats.pending, icon: Clock, cls: 'text-yellow-600' },
          ].map(({ label, value, icon: Icon, cls }) => (
            <Card key={label}><CardContent className="p-3 text-center">
              <Icon className={`w-4 h-4 mx-auto mb-1 ${cls}`} />
              <p className={`text-2xl font-bold ${cls}`}>{value}</p>
              <p className="text-xs text-gray-500">{label}</p>
            </CardContent></Card>
          ))}
        </div>

        <Card><CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input className="pl-9" placeholder="Search name, mobile, company, host, purpose, vehicle…" value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE_SIZE); }} />
            </div>
            {sel(type, setType, [['all', 'All Types'], ['pre_registered', 'Invited'], ['walk_in', 'Walk-in']], 'Visitor type')}
            {sel(status, setStatus, [['all', 'All Status'], ...Object.entries(STATUS_LABELS)], 'Status')}
            {sel(location, setLocation, [['all', 'All Locations'], ...locations.map(l => [l, l])], 'Location')}
            {sel(category, setCategory, [['all', 'All Categories'], ...Object.entries(CATEGORY_LABELS)], 'Category')}
          </div>
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-gray-500">Visit date</span>
            <input type="date" value={from} onChange={e => { setFrom(e.target.value); setShown(PAGE_SIZE); }} className="border border-input rounded-md px-2.5 h-9 text-sm bg-background" aria-label="From date" />
            <span className="text-gray-400">to</span>
            <input type="date" value={to} onChange={e => { setTo(e.target.value); setShown(PAGE_SIZE); }} className="border border-input rounded-md px-2.5 h-9 text-sm bg-background" aria-label="To date" />
            {filtersActive && <Button variant="ghost" size="sm" onClick={clearFilters}><X className="w-3.5 h-3.5 mr-1" /> Clear filters</Button>}
          </div>
        </CardContent></Card>

        {!filtered.length ? (
          <Card><CardContent className="p-12 text-center text-gray-400"><Users className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No visitor records match.</p></CardContent></Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden md:block"><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    {['Type', 'Visitor', 'Host', 'Location', 'Purpose', 'Expected / Registered', 'Check-In', 'Check-Out', 'Duration', 'Status'].map(h => <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(v => (
                    <tr key={v.id} className="border-t hover:bg-blue-50/40 cursor-pointer" onClick={() => setSelected(v)}>
                      <td className="px-3 py-2.5"><Badge className={isWalkIn(v) ? 'bg-orange-100 text-orange-800' : 'bg-indigo-100 text-indigo-800'}>{isWalkIn(v) ? 'Walk-in' : 'Invited'}</Badge></td>
                      <td className="px-3 py-2.5 min-w-[170px]"><p className="font-medium text-gray-900">{v.visitor_name}</p><p className="text-xs text-gray-500">{[v.company, v.mobile_number].filter(Boolean).join(' · ')}</p></td>
                      <td className="px-3 py-2.5">{v.host_name || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{v.location_name || '—'}</td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate" title={v.purpose}>{v.purpose || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(v.expected_arrival)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(v.check_in_time)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmt(v.check_out_time)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{fmtDuration(durationMin(v))}</td>
                      <td className="px-3 py-2.5"><Badge className={STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}>{STATUS_LABELS[v.status] || v.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {rows.map(v => (
                <Card key={v.id} className="cursor-pointer" onClick={() => setSelected(v)}><CardContent className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-gray-900 truncate">{v.visitor_name}</p>
                      <p className="text-xs text-gray-500 truncate">{[v.company, v.mobile_number].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Badge className={STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}>{STATUS_LABELS[v.status] || v.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <Badge className={isWalkIn(v) ? 'bg-orange-100 text-orange-800' : 'bg-indigo-100 text-indigo-800'}>{isWalkIn(v) ? 'Walk-in' : 'Invited'}</Badge>
                    <span className="text-xs text-gray-600">{v.location_name}</span>
                  </div>
                  <p className="text-xs text-gray-600">To meet <span className="font-medium">{v.host_name || '—'}</span>{v.purpose ? ` — ${v.purpose}` : ''}</p>
                  <p className="text-[11px] text-gray-400">In {fmt(v.check_in_time, 'dd MMM, h:mm a')} · Out {fmt(v.check_out_time, 'dd MMM, h:mm a')}</p>
                </CardContent></Card>
              ))}
            </div>

            {filtered.length > shown && (
              <div className="text-center"><Button variant="outline" onClick={() => setShown(s => s + PAGE_SIZE)}>Show more ({filtered.length - shown} remaining)</Button></div>
            )}
            <p className="text-xs text-gray-500 text-center">Showing {Math.min(shown, filtered.length)} of {filtered.length} record{filtered.length === 1 ? '' : 's'}. The Excel export includes every matching record, not just the rows shown.</p>
          </>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Visitor Details</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                {selected.photo_url ? (
                  <img src={selected.photo_url} alt={selected.visitor_name} className="w-24 h-24 rounded-lg object-cover border bg-gray-100" />
                ) : (
                  <div className="w-24 h-24 rounded-lg border bg-gray-50 flex items-center justify-center text-gray-300"><Users className="w-8 h-8" /></div>
                )}
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900">{selected.visitor_name}</p>
                  <p className="text-sm text-gray-500">{selected.company || 'No company'}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge className={isWalkIn(selected) ? 'bg-orange-100 text-orange-800' : 'bg-indigo-100 text-indigo-800'}>{isWalkIn(selected) ? 'Walk-in' : 'Invited (Pre-registered)'}</Badge>
                    <Badge className={STATUS_COLORS[selected.status] || 'bg-gray-100 text-gray-700'}>{STATUS_LABELS[selected.status] || selected.status}</Badge>
                    <Badge variant="outline">{CATEGORY_LABELS[selected.visitor_category] || selected.visitor_category || '—'}</Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-gray-50 rounded-lg p-4">
                <Field label="Mobile">{selected.mobile_number}</Field>
                <Field label="Email">{selected.visitor_email}</Field>
                <Field label="Host (employee met)">{selected.host_name}</Field>
                <Field label="Location / gate">{selected.location_name}</Field>
                <Field label="Purpose">{selected.purpose}</Field>
                <Field label="Meeting location">{selected.meeting_location}</Field>
                <Field label="Registered by">{selected.created_by_name}</Field>
                <Field label="Vehicle number">{selected.vehicle_number}</Field>
                <Field label="Special instructions">{selected.special_instructions}</Field>
                <Field label="ID proof reference">{selected.id_proof_reference}</Field>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-gray-50 rounded-lg p-4">
                <Field label={isWalkIn(selected) ? 'Registered at gate' : 'Expected arrival'}>{fmt(selected.expected_arrival)}</Field>
                <Field label="Expected departure">{fmt(selected.expected_departure)}</Field>
                <Field label={selected.status === 'rejected' ? 'Rejected by' : 'Approved by'}>{selected.status === 'rejected' ? selected.rejected_by_name : selected.approved_by_name}</Field>
                <Field label="Decision time">{fmt(selected.approved_at || selected.rejected_at)}</Field>
                {selected.rejection_reason && <div className="col-span-2"><Field label="Rejection reason">{selected.rejection_reason}</Field></div>}
                <Field label="Checked in">{fmt(selected.check_in_time)}</Field>
                <Field label="Checked in by (gate admin)">{selected.check_in_by_name}</Field>
                <Field label="Checked out">{fmt(selected.check_out_time)}</Field>
                <Field label="Checked out by (gate admin)">{selected.check_out_by_name}</Field>
                <Field label="Time on premises">{fmtDuration(durationMin(selected))}</Field>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
