import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { safeDate, safeTime, nowIST } from '@/lib/dateUtils';
import { toast } from 'sonner';
import {
  Users, UserPlus, QrCode, LogIn, LogOut, Search, Clock, Car, Building2, Phone,
  AlertTriangle, ChevronsUpDown, Camera, ShieldAlert, History as HistoryIcon, RefreshCw,
} from 'lucide-react';
import VisitorQRCode from '@/components/visitor/VisitorQRCode';
import VisitorQRScanner from '@/components/visitor/VisitorQRScanner';
import AttendanceCameraCapture from '@/components/attendance/AttendanceCameraCapture';

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
const CATEGORIES = [
  { value: 'guest', label: 'Guest' }, { value: 'vendor', label: 'Vendor' },
  { value: 'client', label: 'Client' }, { value: 'interview', label: 'Interview Candidate' },
  { value: 'delivery', label: 'Delivery / Courier' }, { value: 'other', label: 'Other' },
];

// Both stored server-side using the same "IST digits as UTC" convention
// Attendance uses — comparing them as naive local times (stripping any Z
// suffix) keeps overdue/today calculations correct regardless of the
// browser's own timezone, matching safeTime/safeDate's own parsing rule.
const istDate = (s) => { if (!s) return null; const d = new Date(String(s).replace(/Z$/, '')); return isNaN(d.getTime()) ? null : d; };
const istNow = () => istDate(nowIST());
const todayStr = () => nowIST().slice(0, 10);

const emptyWalkIn = { visitor_name: '', mobile_number: '', company: '', visitor_category: 'guest', purpose: '', host_user_id: '', vehicle_number: '' };

export default function VisitorManagement() {
  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('dashboard'); // dashboard | currently_inside | history
  const [dashFilter, setDashFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');

  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInForm, setWalkInForm] = useState(emptyWalkIn);
  const [walkInPhoto, setWalkInPhoto] = useState(null);
  const [showWalkInCamera, setShowWalkInCamera] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [showScanner, setShowScanner] = useState(false);
  const [checkInTarget, setCheckInTarget] = useState(null); // visitor pending a check-in confirm
  const [checkInPhoto, setCheckInPhoto] = useState(null);
  const [showCheckInCamera, setShowCheckInCamera] = useState(false);
  const [idProof, setIdProof] = useState('');
  const [actioningId, setActioningId] = useState(null);
  const [qrVisitor, setQrVisitor] = useState(null);
  const [showHeadcount, setShowHeadcount] = useState(false);

  const role = user?.custom_role || user?.role;
  const canOperate = ['gate_admin', 'hr', 'admin', 'management'].includes(role);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [me, emps, allVisitors] = await Promise.all([
        base44.auth.me(),
        base44.entities.Employee.filter({ status: 'active' }),
        base44.entities.Visitor.list('-created_date', 1000),
      ]);
      setUser(me);
      setEmployees(emps);
      setVisitors(allVisitors);
    } catch (e) {
      console.error('VisitorManagement loadData:', e.message);
    }
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const empName = (uid) => employees.find(e => e.user_id === uid)?.display_name || '';

  const isOverdue = (v) => v.status === 'checked_in' && v.expected_departure && istDate(v.expected_departure) < istNow();

  const todaysVisitors = useMemo(() => visitors.filter(v => (v.expected_arrival || '').slice(0, 10) === todayStr() || (v.check_in_time || '').slice(0, 10) === todayStr()), [visitors]);
  const expectedVisitors = useMemo(() => visitors.filter(v => v.status === 'approved'), [visitors]);
  const pendingApprovals = useMemo(() => visitors.filter(v => v.status === 'pending_approval'), [visitors]);
  const currentlyInside = useMemo(() => visitors.filter(v => v.status === 'checked_in'), [visitors]);
  const overdueVisitors = useMemo(() => currentlyInside.filter(isOverdue), [currentlyInside]);

  const dashLists = {
    all: todaysVisitors, today: todaysVisitors, expected: expectedVisitors,
    pending: pendingApprovals, inside: currentlyInside, overdue: overdueVisitors,
  };
  const dashboardRows = dashLists[dashFilter] || todaysVisitors;

  const filteredHistory = useMemo(() => {
    const term = search.trim().toLowerCase();
    return visitors.filter(v => {
      if (historyStatus !== 'all' && v.status !== historyStatus) return false;
      if (!term) return true;
      return [v.visitor_name, v.mobile_number, v.company, v.vehicle_number, v.host_name].some(f => (f || '').toLowerCase().includes(term));
    });
  }, [visitors, search, historyStatus]);

  const resetWalkIn = () => { setWalkInForm(emptyWalkIn); setWalkInPhoto(null); };

  const handleWalkInSubmit = async (e) => {
    e.preventDefault();
    if (!walkInForm.visitor_name || !walkInForm.mobile_number || !walkInForm.purpose || !walkInForm.host_user_id) {
      toast.error('Visitor name, mobile number, purpose and the employee to meet are required');
      return;
    }
    setSubmitting(true);
    try {
      let photo_url = '';
      if (walkInPhoto) {
        const up = await base44.integrations.Core.UploadFile({ file: walkInPhoto });
        photo_url = up.file_url;
      }
      const res = await base44.functions.invoke('registerWalkInVisitor', { ...walkInForm, photo_url });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Failed to register visitor'); return; }
      toast.success('Walk-in registered — approval request sent to host');
      setShowWalkIn(false);
      resetWalkIn();
      loadData(true);
    } catch (err) {
      toast.error(err.message || 'Failed to register visitor');
    } finally {
      setSubmitting(false);
    }
  };

  // A scanned/looked-up visitor is either ready for check-in (approved) or
  // check-out (checked_in) — route to the right flow without making the
  // gate admin pick which action they meant.
  const handleResolvedVisitor = (visitor) => {
    if (!visitor) { toast.error('No matching visitor pass found'); return; }
    if (visitor.status === 'approved') {
      setCheckInTarget(visitor);
      setIdProof('');
      setCheckInPhoto(null);
    } else if (visitor.status === 'checked_in') {
      doCheckOut(visitor);
    } else {
      toast.error(`Cannot process — visit is ${(visitor.status || '').replace(/_/g, ' ')}`);
    }
  };

  const handleScan = (code) => {
    setShowScanner(false);
    const match = visitors.find(v => v.qr_code === code);
    handleResolvedVisitor(match);
  };

  const doCheckIn = async () => {
    if (!checkInTarget) return;
    setActioningId(checkInTarget.id);
    try {
      let photo_url = '';
      if (checkInPhoto) {
        const up = await base44.integrations.Core.UploadFile({ file: checkInPhoto });
        photo_url = up.file_url;
      }
      const res = await base44.functions.invoke('visitorCheckIn', { visitor_id: checkInTarget.id, photo_url, id_proof_reference: idProof });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Check-in failed'); return; }
      toast.success(`${checkInTarget.visitor_name} checked in`);
      setCheckInTarget(null);
      loadData(true);
    } catch (err) {
      toast.error(err.message || 'Check-in failed');
    } finally {
      setActioningId(null);
    }
  };

  const doCheckOut = async (visitor) => {
    setActioningId(visitor.id);
    try {
      const res = await base44.functions.invoke('visitorCheckOut', { visitor_id: visitor.id });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Check-out failed'); return; }
      toast.success(`${visitor.visitor_name} checked out`);
      loadData(true);
    } catch (err) {
      toast.error(err.message || 'Check-out failed');
    } finally {
      setActioningId(null);
    }
  };

  const exportHistoryCsv = () => {
    const headers = ['Visitor', 'Mobile', 'Company', 'Purpose', 'Host', 'Status', 'Expected Arrival', 'Check In', 'Check Out', 'Vehicle'];
    const rows = filteredHistory.map(v => [
      v.visitor_name, v.mobile_number, v.company || '', v.purpose || '', v.host_name || '',
      STATUS_LABELS[v.status] || v.status, safeDate(v.expected_arrival, 'dd MMM yyyy h:mm a'),
      v.check_in_time ? safeDate(v.check_in_time, 'dd MMM yyyy h:mm a') : '', v.check_out_time ? safeDate(v.check_out_time, 'dd MMM yyyy h:mm a') : '',
      v.vehicle_number || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Visitor_History_${todayStr()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const headcountByCategory = CATEGORIES.map(c => ({ ...c, count: currentlyInside.filter(v => v.visitor_category === c.value).length }));

  const renderRow = (v) => (
    <div key={v.id} className="border rounded-lg p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
            {v.visitor_name}
            <Badge className={STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}>{STATUS_LABELS[v.status] || v.status}</Badge>
            {isOverdue(v) && <Badge className="bg-red-100 text-red-800 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overdue</Badge>}
          </p>
          <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {v.company && <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{v.company}</span>}
            <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{v.mobile_number}</span>
            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(v.expected_arrival, 'dd MMM, h:mm a')}</span>
            {v.vehicle_number && <span className="inline-flex items-center gap-1"><Car className="w-3 h-3" />{v.vehicle_number}</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{v.purpose} · Host: {v.host_name}{v.source === 'walk_in' ? ' · Walk-in' : ''}</p>
          {v.status === 'checked_in' && <p className="text-xs text-green-600 mt-0.5">In: {safeTime(v.check_in_time)}{v.expected_departure ? ` · Expected out: ${safeDate(v.expected_departure, 'h:mm a')}` : ''}</p>}
          {v.status === 'checked_out' && <p className="text-xs text-gray-500 mt-0.5">{safeTime(v.check_in_time)} → {safeTime(v.check_out_time)}</p>}
        </div>
        {canOperate && (
          <div className="flex gap-2 shrink-0">
            {v.status === 'approved' && (
              <Button size="sm" onClick={() => handleResolvedVisitor(v)} className="bg-green-600 hover:bg-green-700">
                <LogIn className="w-3.5 h-3.5 mr-1" /> Check In
              </Button>
            )}
            {v.status === 'checked_in' && (
              <Button size="sm" disabled={actioningId === v.id} onClick={() => doCheckOut(v)} className="bg-orange-600 hover:bg-orange-700">
                <LogOut className="w-3.5 h-3.5 mr-1" /> Check Out
              </Button>
            )}
            {v.qr_code && v.status === 'approved' && (
              <Button size="sm" variant="outline" onClick={() => setQrVisitor(v)}><QrCode className="w-3.5 h-3.5" /></Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 rounded-xl"><Users className="w-6 h-6 text-white" /></div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Visitor Management</h1>
              <p className="text-gray-500 text-sm">{new Date().toDateString()}</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => loadData()}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => setShowHeadcount(true)}><ShieldAlert className="w-3.5 h-3.5 mr-1.5" />Headcount</Button>
            {canOperate && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowScanner(true)}><QrCode className="w-3.5 h-3.5 mr-1.5" />Scan QR</Button>
                <Button size="sm" onClick={() => { resetWalkIn(); setShowWalkIn(true); }} className="bg-blue-600 hover:bg-blue-700">
                  <UserPlus className="w-3.5 h-3.5 mr-1.5" />Walk-in Registration
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { key: 'today', label: "Today's Visitors", count: todaysVisitors.length, textClass: 'text-blue-600' },
            { key: 'expected', label: 'Expected', count: expectedVisitors.length, textClass: 'text-indigo-600' },
            { key: 'pending', label: 'Pending Approvals', count: pendingApprovals.length, textClass: 'text-yellow-600' },
            { key: 'inside', label: 'Currently Inside', count: currentlyInside.length, textClass: 'text-green-600' },
            { key: 'overdue', label: 'Overdue', count: overdueVisitors.length, textClass: 'text-red-600' },
          ].map(c => (
            <Card key={c.key} className={`cursor-pointer hover:shadow-md transition-all ${dashFilter === c.key && tab === 'dashboard' ? 'ring-2 ring-blue-400' : ''}`}
              onClick={() => { setTab('dashboard'); setDashFilter(prev => prev === c.key ? 'all' : c.key); }}>
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${c.textClass}`}>{c.count}</p>
                <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 border-b">
          {[['dashboard', 'Dashboard'], ['currently_inside', 'Currently Inside'], ['history', 'History']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'dashboard' && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {{ today: "Today's Visitors", expected: 'Expected Visitors', pending: 'Pending Approvals', inside: 'Currently Inside', overdue: 'Overdue Visitors' }[dashFilter] || "Today's Visitors"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboardRows.length === 0 ? <p className="text-center text-gray-400 py-8">Nothing here.</p> : <div className="space-y-2">{dashboardRows.map(renderRow)}</div>}
            </CardContent>
          </Card>
        )}

        {tab === 'currently_inside' && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Currently Inside ({currentlyInside.length})</CardTitle></CardHeader>
            <CardContent>
              {currentlyInside.length === 0 ? <p className="text-center text-gray-400 py-8">No visitors currently inside.</p> : <div className="space-y-2">{currentlyInside.map(renderRow)}</div>}
            </CardContent>
          </Card>
        )}

        {tab === 'history' && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input className="pl-9" placeholder="Search name, mobile, company, vehicle, host..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Select value={historyStatus} onValueChange={setHistoryStatus}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={exportHistoryCsv}><HistoryIcon className="w-3.5 h-3.5 mr-1.5" />Export CSV</Button>
              </div>
            </CardHeader>
            <CardContent>
              {filteredHistory.length === 0 ? <p className="text-center text-gray-400 py-8">No matching visitor records.</p> : <div className="space-y-2">{filteredHistory.map(renderRow)}</div>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Walk-in registration dialog */}
      <Dialog open={showWalkIn} onOpenChange={setShowWalkIn}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader><DialogTitle>Walk-in Visitor Registration</DialogTitle></DialogHeader>
          <form onSubmit={handleWalkInSubmit} className="space-y-3">
            <div><Label>Name *</Label><Input value={walkInForm.visitor_name} onChange={e => setWalkInForm({ ...walkInForm, visitor_name: e.target.value })} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Mobile Number *</Label><Input value={walkInForm.mobile_number} onChange={e => setWalkInForm({ ...walkInForm, mobile_number: e.target.value })} required /></div>
              <div><Label>Company</Label><Input value={walkInForm.company} onChange={e => setWalkInForm({ ...walkInForm, company: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Visitor Type</Label>
                <Select value={walkInForm.visitor_category} onValueChange={v => setWalkInForm({ ...walkInForm, visitor_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Vehicle Number</Label><Input value={walkInForm.vehicle_number} onChange={e => setWalkInForm({ ...walkInForm, vehicle_number: e.target.value })} /></div>
            </div>
            <div><Label>Purpose *</Label><Input value={walkInForm.purpose} onChange={e => setWalkInForm({ ...walkInForm, purpose: e.target.value })} required /></div>
            <div>
              <Label>Employee to Meet *</Label>
              <Popover open={hostOpen} onOpenChange={setHostOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {empName(walkInForm.host_user_id) || 'Select employee...'}
                    <ChevronsUpDown className="w-4 h-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[350px] p-0">
                  <Command>
                    <CommandInput placeholder="Search employee..." />
                    <CommandList>
                      <CommandEmpty>No employee found</CommandEmpty>
                      <CommandGroup>
                        {employees.map(emp => (
                          <CommandItem key={emp.user_id} value={emp.display_name} onSelect={() => { setWalkInForm({ ...walkInForm, host_user_id: emp.user_id }); setHostOpen(false); }}>
                            {emp.display_name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Visitor Photograph (recommended)</Label>
              <div className="flex items-center gap-3 mt-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowWalkInCamera(true)}><Camera className="w-4 h-4 mr-1.5" />{walkInPhoto ? 'Retake Photo' : 'Take Photo'}</Button>
                {walkInPhoto && <img src={URL.createObjectURL(walkInPhoto)} alt="Visitor" className="w-12 h-12 rounded-lg object-cover border" />}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">{submitting ? 'Submitting...' : 'Send Approval Request'}</Button>
              <Button type="button" variant="outline" onClick={() => setShowWalkIn(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AttendanceCameraCapture open={showWalkInCamera} onClose={() => setShowWalkInCamera(false)} onCapture={setWalkInPhoto} />

      {/* QR scanner */}
      <VisitorQRScanner open={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />

      {/* Check-in confirm dialog */}
      <Dialog open={!!checkInTarget} onOpenChange={(o) => !o && setCheckInTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Check In Visitor</DialogTitle></DialogHeader>
          {checkInTarget && (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-semibold">{checkInTarget.visitor_name}</p>
                <p className="text-gray-500">{checkInTarget.company} · Meeting {checkInTarget.host_name}</p>
                <p className="text-gray-500">{checkInTarget.purpose}</p>
              </div>
              <div>
                <Label>ID Proof Reference</Label>
                <Input placeholder="e.g. Aadhaar / DL number" value={idProof} onChange={e => setIdProof(e.target.value)} />
              </div>
              <div>
                <Label>Photo (optional)</Label>
                <div className="flex items-center gap-3 mt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowCheckInCamera(true)}><Camera className="w-4 h-4 mr-1.5" />{checkInPhoto ? 'Retake Photo' : 'Take Photo'}</Button>
                  {checkInPhoto && <img src={URL.createObjectURL(checkInPhoto)} alt="Visitor" className="w-12 h-12 rounded-lg object-cover border" />}
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button disabled={actioningId === checkInTarget.id} onClick={doCheckIn} className="bg-green-600 hover:bg-green-700">
                  <LogIn className="w-4 h-4 mr-1.5" /> Check In
                </Button>
                <Button variant="outline" onClick={() => setCheckInTarget(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AttendanceCameraCapture open={showCheckInCamera} onClose={() => setShowCheckInCamera(false)} onCapture={setCheckInPhoto} />

      {/* QR pass viewer */}
      {qrVisitor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setQrVisitor(null)}>
          <div className="bg-white rounded-xl p-6 max-w-xs w-full text-center space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-semibold">{qrVisitor.visitor_name}'s Visitor Pass</p>
            <div className="flex justify-center"><VisitorQRCode value={qrVisitor.qr_code} size={220} /></div>
            <Button variant="outline" size="sm" onClick={() => setQrVisitor(null)}>Close</Button>
          </div>
        </div>
      )}

      {/* Headcount */}
      <Dialog open={showHeadcount} onOpenChange={setShowHeadcount}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader><DialogTitle>Emergency Headcount</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <p className="text-3xl font-bold text-blue-700">{currentlyInside.length}</p>
              <p className="text-sm text-blue-600">Visitors currently inside the premises</p>
            </div>
            <div className="space-y-1.5">
              {headcountByCategory.filter(c => c.count > 0).map(c => (
                <div key={c.value} className="flex justify-between text-sm border-b pb-1.5">
                  <span>{c.label}</span><span className="font-semibold">{c.count}</span>
                </div>
              ))}
              {headcountByCategory.every(c => c.count === 0) && <p className="text-center text-gray-400 text-sm py-4">No visitors currently inside.</p>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
