import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { nowIST } from '@/lib/dateUtils';
import { LogOut, Plus, History, Car, Bike, Route as RouteIcon, MapPin, ArrowRight, Loader2 } from 'lucide-react';
import GatePassHistory from '@/components/gatepass/GatePassHistory';
import { startTracking as startFieldTripTracking } from '@/lib/fieldTripTracker';
import { toast } from 'sonner';
import { useGateBoard, usePassFilters, SummaryCards, FilterBar, PassCard, Empty, Loading } from '@/components/gatepass/gpShared';
import { ActionButton, ConfirmAction } from '@/components/gatepass/GatePassActions';
import GatePassDetail from '@/components/gatepass/GatePassDetail';

const OUTING_TYPES = [
  { value: 'official_outing', label: 'Official Outing', desc: 'No LOP deduction — full day present' },
  { value: 'unofficial_outing', label: 'Unofficial Outing', desc: 'No deduction if returned within 3 hours, else half day LOP' },
  { value: 'half_day', label: 'Half Day', desc: 'No deduction if returned within 3 hours, else half day LOP' },
  { value: 'short_break', label: 'Short Break', desc: 'No deduction if returned within 3 hours, else half day LOP' },
  // 'early_leave' removed as a selectable option per explicit request — the
  // getOutingLabel()/OUTING_LABELS-style maps elsewhere (GateAdminDashboard,
  // GatePassApproval, the muster/report exports) still recognize it so any
  // already-submitted pass with this outing_type keeps displaying correctly.
  { value: 'travelling_to_another_office', label: 'Travelling to Another Office', desc: 'No LOP deduction — marked Out at your office and Arrived at the destination office' },
];

const selectCls = 'mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm';

export default function GatePassRequest() {
  const [user, setUser] = useState(null);
  const [locations, setLocations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ outing_type: 'unofficial_outing', reason: '', expected_return_time: '', expected_arrival_time: '', vehicle_type: '2_wheeler', current_location: '', destination_location: '' });
  const [view, setView] = useState('passes');
  const [openId, setOpenId] = useState(null);
  const [request, setRequest] = useState(null);
  const { board, error, refreshing, reload } = useGateBoard({ scope: 'mine' });
  const passes = board?.passes || [];
  const filters = usePassFilters(passes);

  useEffect(() => {
    (async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      const [locs, empRecords] = await Promise.all([
        base44.entities.AppLocation.filter({ is_active: true }),
        base44.entities.Employee.filter({ user_id: currentUser.id }),
      ]);
      setLocations(locs);
      // Pre-fill the departure office with the employee's own assigned office — still editable.
      const homeLocation = empRecords?.[0]?.work_location || '';
      if (locs.some(l => l.name === homeLocation)) setForm(f => ({ ...f, current_location: f.current_location || homeLocation }));
    })().catch(err => toast.error(err.message || 'Could not load offices'));
  }, []);

  const isTravelForm = form.outing_type === 'travelling_to_another_office';
  const openTrip = passes.find(p => p.outing_type === 'travelling_to_another_office' && p.destination_location && ['pending_approval', 'approved', 'departed'].includes(p.status));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isTravelling = form.outing_type === 'travelling_to_another_office';
    // Departure location is required for EVERY outing type now, not just
    // "travelling to another office" — it's how the request gets routed to
    // the right office's gate admin (see GateAdminDashboard/entities.js).
    if (!form.current_location) {
      toast.error('Select which office you are departing from');
      return;
    }
    if (isTravelling && !form.destination_location) {
      toast.error('Select where you are travelling to');
      return;
    }
    if (isTravelling && form.current_location === form.destination_location) {
      toast.error('Departure location and destination must be different');
      return;
    }
    setSubmitting(true);
    const isOfficial = form.outing_type === 'official_outing';
    let gatePass;
    try {
      const empRecords = await base44.entities.Employee.filter({ user_id: user.id });
      const emp = empRecords?.[0];
      gatePass = await base44.entities.GatePass.create({
        user_id: user.id,
        employee_user_id: user.id,
        outing_type: form.outing_type,
        reason: form.reason,
        expected_return_time: isTravelling ? null : form.expected_return_time || null,
        request_date: format(new Date(), 'yyyy-MM-dd'),
        requested_at: nowIST(),
        status: 'pending_approval',
        manager_approval_status: 'pending',
        manager_user_id: emp?.reporting_manager_id || null,
        lop_deduction_days: 0,
        current_location: form.current_location,
        ...(isOfficial ? { vehicle_type: form.vehicle_type } : {}),
        ...(isTravelling ? { destination_location: form.destination_location, expected_arrival_time: form.expected_arrival_time || null } : {}),
      });
    } catch (err) {
      toast.error(err.message || 'Could not submit the gate pass');
      setSubmitting(false);
      return;
    }

    // Official outing: start Field Duty GPS tracking immediately, without waiting for
    // manager approval — best-effort, never blocks the gate pass request itself.
    if (isOfficial) {
      try {
        const res = await base44.functions.invoke('startFieldTrip', {
          purpose: form.reason || 'Official outing', vehicle_type: form.vehicle_type, gate_pass_id: gatePass?.id,
        });
        const d = res.data || res;
        if (d.success) {
          startFieldTripTracking(d.trip.id, 0);
          if (gatePass?.id) base44.entities.GatePass.update(gatePass.id, { field_trip_id: d.trip.id }).catch(() => {});
          toast.success('Gate pass submitted — Field Duty tracking started automatically.');
        } else if (d.code === 'ALREADY_ACTIVE') {
          toast.info('Gate pass submitted. A Field Duty trip is already in progress — distance is already being tracked.');
        } else {
          toast.success('Gate pass submitted.');
        }
      } catch {
        toast.success('Gate pass submitted.'); // tracking is a bonus; the request itself already succeeded
      }
    } else {
      toast.success('Gate pass submitted for approval.');
    }

    // Keep the departure office for the next request.
    setForm({ outing_type: 'unofficial_outing', reason: '', expected_return_time: '', expected_arrival_time: '', vehicle_type: '2_wheeler', current_location: form.current_location, destination_location: '' });
    setShowForm(false);
    await reload();
    setSubmitting(false);
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <LogOut className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 flex-shrink-0" /> My Gate Passes
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Request permission to leave the office or travel to another office</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2 self-start sm:self-auto">
          <Plus className="w-4 h-4" /> New Request
        </Button>
      </div>

      {showForm && (
        <Card className="border-blue-200">
          <CardHeader className="pb-3"><CardTitle className="text-lg">New gate pass request</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="gp-type">Outing type *</Label>
                <select id="gp-type" className={selectCls} value={form.outing_type} onChange={e => setForm(f => ({ ...f, outing_type: e.target.value }))}>
                  {OUTING_TYPES.map(ot => <option key={ot.value} value={ot.value}>{ot.label}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-1">{OUTING_TYPES.find(o => o.value === form.outing_type)?.desc}</p>
              </div>

              {isTravelForm && openTrip && (
                <p role="alert" className="text-sm text-amber-800 bg-amber-50 rounded-md px-3 py-2">
                  You already have an open trip ({openTrip.current_location} → {openTrip.destination_location}). It must be completed or cancelled before you can request another.
                </p>
              )}

              {/* The departure office decides which gate admin handles the pass */}
              <div className={`grid grid-cols-1 gap-3 ${isTravelForm ? 'sm:grid-cols-[1fr_auto_1fr] sm:items-end' : ''}`}>
                <div>
                  <Label htmlFor="gp-from" className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-blue-600" /> {isTravelForm ? 'Departing from *' : 'Office you are leaving *'}</Label>
                  <select id="gp-from" className={selectCls} value={form.current_location} onChange={e => setForm(f => ({ ...f, current_location: e.target.value, destination_location: f.destination_location === e.target.value ? '' : f.destination_location }))}>
                    <option value="">Select office…</option>
                    {locations.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
                {isTravelForm && <>
                  <ArrowRight className="hidden sm:block w-5 h-5 mb-2.5 text-indigo-500" />
                  <div>
                    <Label htmlFor="gp-to" className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-indigo-600" /> Destination office *</Label>
                    <select id="gp-to" className={selectCls} value={form.destination_location} onChange={e => setForm(f => ({ ...f, destination_location: e.target.value }))}>
                      <option value="">Select office…</option>
                      {locations.filter(l => l.name !== form.current_location).map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                </>}
              </div>
              {form.outing_type === 'official_outing' && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <Label className="flex items-center gap-1.5 text-orange-800">
                    <RouteIcon className="w-4 h-4" /> Field Duty tracking will start automatically
                  </Label>
                  <p className="text-xs text-orange-700 mt-1 mb-2">Since this is an official outing, GPS distance tracking begins the moment you submit — for a fair km-based travel reimbursement per the Travel Policy.</p>
                  <Label className="text-xs text-gray-600 mb-1.5 block">Vehicle you'll be using</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setForm(f => ({ ...f, vehicle_type: '2_wheeler' }))}
                      className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${form.vehicle_type === '2_wheeler' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 hover:border-orange-300'}`}>
                      <Bike className="w-4 h-4" /> 2-Wheeler
                    </button>
                    <button type="button" onClick={() => setForm(f => ({ ...f, vehicle_type: '4_wheeler' }))}
                      className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${form.vehicle_type === '4_wheeler' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 hover:border-orange-300'}`}>
                      <Car className="w-4 h-4" /> 4-Wheeler
                    </button>
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="gp-eta">{isTravelForm ? 'Expected arrival time (optional)' : 'Expected return time (optional)'}</Label>
                <Input id="gp-eta" type="datetime-local" className="mt-1"
                  value={isTravelForm ? form.expected_arrival_time : form.expected_return_time}
                  onChange={e => setForm(f => ({ ...f, [isTravelForm ? 'expected_arrival_time' : 'expected_return_time']: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="gp-reason">Reason (optional)</Label>
                <Textarea id="gp-reason" className="mt-1" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Enter reason or details..." rows={3} />
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={submitting || !user || (isTravelForm && !!openTrip)}>
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{submitting ? 'Submitting…' : 'Submit request'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Close</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant={view === 'passes' ? 'default' : 'outline'} onClick={() => setView('passes')}>My passes</Button>
        <Button size="sm" variant={view === 'history' ? 'default' : 'outline'} onClick={() => setView('history')}><History className="w-4 h-4 mr-1.5" />Month & calendar history</Button>
      </div>

      {view === 'passes' && <>
        {error && <p role="alert" className="text-sm text-red-600">{error} <button className="underline" onClick={reload}>Try again</button></p>}
        {!board ? !error && <Loading /> : <>
          <SummaryCards passes={passes} active={filters.f.group} onPick={(group) => filters.set({ group })} />
          <FilterBar filters={filters} passes={passes} onRefresh={reload} refreshing={refreshing} />
          <div className="space-y-3">
            {filters.rows.length === 0
              ? <Empty title={passes.length ? 'Nothing matches' : 'You have no gate passes yet'} hint={passes.length ? 'Try another tab or clear the filters.' : 'Use New Request to raise one.'} />
              : filters.rows.map(p => (
                <PassCard key={p.id} pass={p} showEmployee={false} onOpen={(x) => setOpenId(x.id)}
                  actions={p.status === 'pending_approval' ? <ActionButton action="cancel_request" onClick={() => setRequest({ action: 'cancel_request', pass: p })} />
                    : p.status === 'approved' && p.can.cancel_trip ? <ActionButton action="cancel_trip" onClick={() => setRequest({ action: 'cancel_trip', pass: p })} /> : null} />
              ))}
          </div>
        </>}
      </>}

      {view === 'history' && user && <GatePassHistory filterUserId={user.id} showEmployeeName={false} />}

      <ConfirmAction request={request} offices={board?.offices} onClose={() => setRequest(null)} onDone={reload} />
      <GatePassDetail passId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
