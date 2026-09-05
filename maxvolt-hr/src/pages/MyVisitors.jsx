import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { generateVisitorPassImage, downloadBlob, shareOrDownloadPass } from '@/lib/visitorPass';
import { toast } from 'sonner';
import {
  UserPlus, Users, Check, X, ChevronsUpDown, Car, MapPin, Clock,
  Building2, Phone, QrCode, XCircle, Download, Share2, Mail,
} from 'lucide-react';
import VisitorQRCode from '@/components/visitor/VisitorQRCode';

const STATUS_COLORS = {
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  checked_in: 'bg-green-100 text-green-800',
  checked_out: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-500',
};
const STATUS_LABELS = {
  pending_approval: 'Pending Approval', approved: 'Approved (Awaiting Arrival)',
  rejected: 'Rejected', checked_in: 'Currently Inside', checked_out: 'Visit Completed', cancelled: 'Cancelled',
};
const CATEGORIES = [
  { value: 'guest', label: 'Guest' }, { value: 'vendor', label: 'Vendor' },
  { value: 'client', label: 'Client' }, { value: 'interview', label: 'Interview Candidate' },
  { value: 'delivery', label: 'Delivery / Courier' }, { value: 'other', label: 'Other' },
];

const emptyForm = {
  visitor_name: '', mobile_number: '', visitor_email: '', company: '', visitor_category: 'guest', purpose: '',
  expected_arrival: '', expected_departure: '', host_user_id: '', location_name: '', vehicle_number: '',
  meeting_location: '', special_instructions: '',
};

export default function MyVisitors() {
  const [user, setUser] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [locations, setLocations] = useState([]);
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [hostOpen, setHostOpen] = useState(false);
  const [actioningId, setActioningId] = useState(null);
  const [qrVisitor, setQrVisitor] = useState(null);
  const [passImageUrl, setPassImageUrl] = useState(null);
  const [passBlob, setPassBlob] = useState(null);
  const [passLoading, setPassLoading] = useState(false);
  const [tab, setTab] = useState('mine'); // 'mine' | 'hosting'

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [me, emps, locs, res] = await Promise.all([
        base44.auth.me(),
        base44.entities.Employee.filter({ status: 'active' }),
        base44.entities.AppLocation.filter({ is_active: true }),
        base44.functions.invoke('getMyVisitors', {}),
      ]);
      const d = res.data || res;
      setUser(me);
      setEmployees(emps);
      setLocations(locs);
      setVisitors(d.success ? d.visitors : []);
      setForm(f => ({ ...f, host_user_id: f.host_user_id || me.id }));
    } catch (e) {
      console.error('MyVisitors loadData:', e.message);
    }
    setLoading(false);
  };

  const myInvites = useMemo(() => visitors.filter(v => v.created_by === user?.id), [visitors, user]);
  const hostingForMe = useMemo(() => visitors.filter(v => v.host_user_id === user?.id && v.created_by !== user?.id), [visitors, user]);
  const pendingMyApproval = useMemo(() => hostingForMe.filter(v => v.status === 'pending_approval'), [hostingForMe]);

  const resetForm = () => setForm({ ...emptyForm, host_user_id: user?.id || '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.visitor_name || !form.mobile_number || !form.purpose || !form.expected_arrival || !form.location_name) {
      toast.error('Visitor name, mobile number, purpose, office location and expected arrival are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('createVisitorInvite', form);
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Failed to create invite'); return; }
      toast.success(d.visitor.status === 'approved' ? 'Visitor invited — QR pass ready' : 'Invite sent — awaiting host approval');
      setShowForm(false);
      resetForm();
      loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to create invite');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproval = async (visitor, action) => {
    setActioningId(visitor.id);
    try {
      const note = action === 'reject' ? (window.prompt('Reason for rejection (optional):') || '') : '';
      const res = await base44.functions.invoke('actionVisitorApproval', { visitor_id: visitor.id, action, note });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Action failed'); return; }
      toast.success(action === 'approve' ? 'Visitor approved' : 'Visitor rejected');
      loadData();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setActioningId(null);
    }
  };

  const handleCancel = async (visitor) => {
    if (!window.confirm(`Cancel the visit for ${visitor.visitor_name}?`)) return;
    setActioningId(visitor.id);
    try {
      const res = await base44.functions.invoke('cancelVisitorInvite', { visitor_id: visitor.id });
      const d = res.data || res;
      if (!d.success) { toast.error(d.error || 'Failed to cancel'); return; }
      toast.success('Visit cancelled');
      loadData();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel');
    } finally {
      setActioningId(null);
    }
  };

  const empName = (uid) => employees.find(e => e.user_id === uid)?.display_name || '';

  const openPass = async (visitor) => {
    setQrVisitor(visitor);
    setPassImageUrl(null);
    setPassBlob(null);
    setPassLoading(true);
    try {
      const location = locations.find(l => l.name === visitor.location_name) || null;
      const blob = await generateVisitorPassImage(visitor, location);
      setPassBlob(blob);
      setPassImageUrl(URL.createObjectURL(blob));
    } catch (e) {
      console.error('Pass generation failed:', e.message);
      toast.error('Could not generate the pass image');
    }
    setPassLoading(false);
  };

  const closePass = () => {
    if (passImageUrl) URL.revokeObjectURL(passImageUrl);
    setQrVisitor(null); setPassImageUrl(null); setPassBlob(null);
  };

  const handleDownloadPass = () => {
    if (!passBlob || !qrVisitor) return;
    downloadBlob(passBlob, `Visitor_Pass_${qrVisitor.visitor_name.replace(/\s+/g, '_')}.png`);
  };

  const handleSharePass = async () => {
    if (!passBlob || !qrVisitor) return;
    const result = await shareOrDownloadPass(passBlob, `Visitor_Pass_${qrVisitor.visitor_name.replace(/\s+/g, '_')}.png`, `Visitor Pass — ${qrVisitor.visitor_name}`);
    if (result === 'downloaded') toast.info('Sharing not supported here — pass downloaded instead');
  };

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;

  const list = tab === 'mine' ? myInvites : hostingForMe;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-blue-600" /> My Visitors
            </h1>
            <p className="text-gray-600 text-sm mt-1">Invite visitors and approve requests for visitors meeting you</p>
          </div>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="bg-blue-600 hover:bg-blue-700">
            <UserPlus className="w-4 h-4 mr-2" /> Invite a Visitor
          </Button>
        </div>

        {pendingMyApproval.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardContent className="py-3 px-4">
              <p className="text-sm font-semibold text-amber-800 mb-2">
                {pendingMyApproval.length} visitor{pendingMyApproval.length > 1 ? 's' : ''} awaiting your approval
              </p>
              <div className="space-y-2">
                {pendingMyApproval.map(v => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-lg p-3 border border-amber-200">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{v.visitor_name} {v.company && <span className="text-gray-400 font-normal">— {v.company}</span>}</p>
                      <p className="text-xs text-gray-500">{v.purpose} · {v.location_name} · Invited by {v.created_by_name}{v.source === 'walk_in' ? ' · Walk-in at gate' : ''}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" disabled={actioningId === v.id} onClick={() => handleApproval(v, 'approve')} className="bg-green-600 hover:bg-green-700">
                        <Check className="w-3.5 h-3.5 mr-1" /> Allow Entry
                      </Button>
                      <Button size="sm" variant="outline" disabled={actioningId === v.id} onClick={() => handleApproval(v, 'reject')} className="border-red-300 text-red-700 hover:bg-red-50">
                        <X className="w-3.5 h-3.5 mr-1" /> Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {showForm && (
          <Card>
            <CardHeader><CardTitle className="text-lg">Invite a Visitor</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Visitor Name *</Label>
                    <Input value={form.visitor_name} onChange={e => setForm({ ...form, visitor_name: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Mobile Number *</Label>
                    <Input value={form.mobile_number} onChange={e => setForm({ ...form, mobile_number: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Visitor Email</Label>
                    <Input type="email" value={form.visitor_email} onChange={e => setForm({ ...form, visitor_email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Company / Organisation</Label>
                    <Input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
                  </div>
                  <div>
                    <Label>Visitor Category</Label>
                    <Select value={form.visitor_category} onValueChange={v => setForm({ ...form, visitor_category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Office Location *</Label>
                    <Select value={form.location_name} onValueChange={v => setForm({ ...form, location_name: v })}>
                      <SelectTrigger><SelectValue placeholder="Select location..." /></SelectTrigger>
                      <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Purpose of Visit *</Label>
                    <Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Expected Arrival *</Label>
                    <Input type="datetime-local" value={form.expected_arrival} onChange={e => setForm({ ...form, expected_arrival: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Expected Departure</Label>
                    <Input type="datetime-local" value={form.expected_departure} onChange={e => setForm({ ...form, expected_departure: e.target.value })} />
                  </div>
                  <div>
                    <Label>Employee / Host *</Label>
                    <Popover open={hostOpen} onOpenChange={setHostOpen}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {form.host_user_id === user?.id ? `${user?.full_name} (You)` : (empName(form.host_user_id) || 'Select host...')}
                          <ChevronsUpDown className="w-4 h-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0">
                        <Command>
                          <CommandInput placeholder="Search employee..." />
                          <CommandList>
                            <CommandEmpty>No employee found</CommandEmpty>
                            <CommandGroup>
                              {employees.map(emp => (
                                <CommandItem key={emp.user_id} value={emp.display_name} onSelect={() => { setForm({ ...form, host_user_id: emp.user_id }); setHostOpen(false); }}>
                                  {emp.display_name}{emp.user_id === user?.id ? ' (You)' : ''}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label>Vehicle Number</Label>
                    <Input value={form.vehicle_number} onChange={e => setForm({ ...form, vehicle_number: e.target.value })} />
                  </div>
                  <div>
                    <Label>Meeting Location (within office)</Label>
                    <Input value={form.meeting_location} onChange={e => setForm({ ...form, meeting_location: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Special Instructions</Label>
                    <Textarea rows={2} value={form.special_instructions} onChange={e => setForm({ ...form, special_instructions: e.target.value })} />
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                    {submitting ? 'Submitting...' : 'Submit Invite'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <div className="flex gap-2">
              <button onClick={() => setTab('mine')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'mine' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                My Invites ({myInvites.length})
              </button>
              <button onClick={() => setTab('hosting')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === 'hosting' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                Visitors Meeting Me ({hostingForMe.length})
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No visitors here yet.</p>
            ) : (
              <div className="space-y-2">
                {list.map(v => (
                  <div key={v.id} className="border rounded-lg p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          {v.visitor_name}
                          <Badge className={STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}>{STATUS_LABELS[v.status] || v.status}</Badge>
                          {v.location_name && <Badge variant="outline" className="flex items-center gap-1"><MapPin className="w-3 h-3" />{v.location_name}</Badge>}
                        </p>
                        <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {v.company && <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" />{v.company}</span>}
                          <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{v.mobile_number}</span>
                          {v.visitor_email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{v.visitor_email}</span>}
                          <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(v.expected_arrival, 'dd MMM, h:mm a')}</span>
                          {v.vehicle_number && <span className="inline-flex items-center gap-1"><Car className="w-3 h-3" />{v.vehicle_number}</span>}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{v.purpose}{tab === 'mine' ? ` · Host: ${v.host_name}` : ` · Invited by: ${v.created_by_name}`}</p>
                        {v.status === 'checked_in' && v.check_in_time && (
                          <p className="text-xs text-green-600 mt-0.5">Checked in at {safeTime(v.check_in_time)}</p>
                        )}
                        {v.status === 'checked_out' && (
                          <p className="text-xs text-gray-500 mt-0.5">{safeTime(v.check_in_time)} → {safeTime(v.check_out_time)}</p>
                        )}
                        {v.status === 'rejected' && v.rejection_reason && (
                          <p className="text-xs text-red-600 mt-0.5">Reason: {v.rejection_reason}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {v.status === 'approved' && v.qr_code && (
                          <Button size="sm" variant="outline" onClick={() => openPass(v)}>
                            <QrCode className="w-3.5 h-3.5 mr-1" /> QR Pass
                          </Button>
                        )}
                        {tab === 'hosting' && v.status === 'pending_approval' && (
                          <>
                            <Button size="sm" disabled={actioningId === v.id} onClick={() => handleApproval(v, 'approve')} className="bg-green-600 hover:bg-green-700">
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" disabled={actioningId === v.id} onClick={() => handleApproval(v, 'reject')} className="border-red-300 text-red-700">
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                        {tab === 'mine' && ['pending_approval', 'approved'].includes(v.status) && (
                          <Button size="sm" variant="outline" disabled={actioningId === v.id} onClick={() => handleCancel(v)} className="border-gray-300 text-gray-600">
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {qrVisitor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={closePass}>
          <div className="bg-white rounded-xl p-5 max-w-sm w-full text-center space-y-3" onClick={e => e.stopPropagation()}>
            <p className="font-semibold">{qrVisitor.visitor_name}'s Visitor Pass</p>
            <div className="flex justify-center">
              {passLoading ? (
                <div className="w-full h-80 bg-gray-100 rounded-lg animate-pulse flex items-center justify-center text-gray-400 text-sm">Generating pass...</div>
              ) : passImageUrl ? (
                <img src={passImageUrl} alt="Visitor Pass" className="w-full rounded-lg border" />
              ) : (
                <VisitorQRCode value={qrVisitor.qr_code} size={220} />
              )}
            </div>
            <div className="flex gap-2 justify-center">
              <Button size="sm" disabled={!passBlob} onClick={handleDownloadPass} className="bg-blue-600 hover:bg-blue-700">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Download
              </Button>
              <Button size="sm" variant="outline" disabled={!passBlob} onClick={handleSharePass}>
                <Share2 className="w-3.5 h-3.5 mr-1.5" /> Share
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={closePass}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
