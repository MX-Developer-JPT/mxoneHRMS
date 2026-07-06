import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Route, Play, Square, RefreshCw, IndianRupee, MapPin, Navigation, Settings2,
  CheckCircle2, Car, Bike, FileText, Printer, Download, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

const fmtKm = (n) => `${(n || 0).toFixed(2)} km`;
const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

function printHtml(html, title) {
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>${title || 'Reimbursement Form'}</title></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

export default function FieldDuty() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState([]);
  const [rates, setRates] = useState({ two_wheeler: 0, four_wheeler: 0 });
  const [canManage, setCanManage] = useState(false);
  const [scope, setScope] = useState('mine');

  const [activeTrip, setActiveTrip] = useState(null);
  const [liveKm, setLiveKm] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [purpose, setPurpose] = useState('');
  const [vehicleType, setVehicleType] = useState('2_wheeler');
  const [startDialog, setStartDialog] = useState(false);
  const [endDialog, setEndDialog] = useState(false);
  const [tollAmount, setTollAmount] = useState('');
  const [endNotes, setEndNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [rateDialog, setRateDialog] = useState(false);
  const [new2w, setNew2w] = useState('');
  const [new4w, setNew4w] = useState('');

  // Consolidated reimbursement form
  const [formOpen, setFormOpen] = useState(false);
  const [targetUser, setTargetUser] = useState(null); // { id, name } — null = self
  const [periodType, setPeriodType] = useState('week');
  const [periodDate, setPeriodDate] = useState(new Date().toISOString().slice(0, 10));
  const [formPreview, setFormPreview] = useState(null);
  const [formLoading, setFormLoading] = useState(false);
  const [mealAllowance, setMealAllowance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pickEmployeeOpen, setPickEmployeeOpen] = useState(false);

  const watchRef = useRef(null);
  const bufferRef = useRef([]);
  const flushTimerRef = useRef(null);
  const wakeLockRef = useRef(null);

  useEffect(() => { load(); return stopWatching; }, [scope]);
  useEffect(() => { if (formOpen) loadFormPreview(); }, [formOpen, periodType, periodDate, targetUser]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getFieldTrips', { scope });
      const d = res.data || res;
      if (d.success) {
        setTrips(d.trips || []);
        setRates(d.rates || { two_wheeler: 0, four_wheeler: 0 });
        setCanManage(!!d.can_manage);
        const myActive = (d.trips || []).find(t => t.status === 'active' && (scope === 'mine' || !t.employee?.code));
        if (myActive) { setActiveTrip(myActive); setLiveKm(myActive.distance_km || 0); startWatching(myActive.id); }
      }
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  // ── GPS watcher: buffer points, flush to server every 20s ──
  const startWatching = (tripId) => {
    if (watchRef.current != null || !navigator.geolocation) return;
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(wl => { wakeLockRef.current = wl; }).catch(() => {});
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsAccuracy(Math.round(pos.coords.accuracy));
        if (pos.coords.accuracy > 60) return;
        const q = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: new Date().toISOString() };
        const prev = bufferRef.current[bufferRef.current.length - 1];
        if (prev) {
          const R = 6371000, la1 = prev.lat * Math.PI / 180, la2 = q.lat * Math.PI / 180;
          const dLa = la2 - la1, dLo = (q.lng - prev.lng) * Math.PI / 180;
          const dM = 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2));
          if (dM < Math.max(15, Math.min(50, (prev.acc + q.acc) / 2))) return;
        }
        bufferRef.current.push(q);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
    flushTimerRef.current = setInterval(async () => {
      if (!bufferRef.current.length) return;
      const points = bufferRef.current.splice(0, bufferRef.current.length);
      try {
        const res = await base44.functions.invoke('logFieldPoints', { trip_id: tripId, points });
        const d = res.data || res;
        if (d.success) setLiveKm(d.distance_km || 0);
      } catch { /* retry next flush with new points */ }
    }, 20000);
  };

  const stopWatching = () => {
    if (watchRef.current != null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
    if (flushTimerRef.current) { clearInterval(flushTimerRef.current); flushTimerRef.current = null; }
    if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null; }
    bufferRef.current = [];
  };

  const startTrip = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke('startFieldTrip', { purpose, vehicle_type: vehicleType });
      const d = res.data || res;
      if (d.success) {
        setActiveTrip(d.trip); setLiveKm(0); setStartDialog(false); setPurpose('');
        startWatching(d.trip.id);
        toast.success('Trip started — keep the app open while travelling. Distance is being recorded.');
      } else toast.error(d.error || 'Could not start trip');
    } catch (e) { toast.error('Error: ' + e.message); }
    setBusy(false);
  };

  const openEndDialog = () => { setTollAmount(''); setEndNotes(''); setEndDialog(true); };

  const endTrip = async () => {
    if (!activeTrip) return;
    setBusy(true);
    try {
      if (bufferRef.current.length) {
        const points = bufferRef.current.splice(0, bufferRef.current.length);
        await base44.functions.invoke('logFieldPoints', { trip_id: activeTrip.id, points }).catch(() => {});
      }
      const res = await base44.functions.invoke('endFieldTrip', {
        trip_id: activeTrip.id, toll_parking_amount: Number(tollAmount) || 0, notes: endNotes,
      });
      const d = res.data || res;
      if (d.success) {
        stopWatching();
        setActiveTrip(null);
        setEndDialog(false);
        toast.success(`Trip ended — ${fmtKm(d.trip.distance_km)} recorded`);
        load();
      } else toast.error(d.error || 'Could not end trip');
    } catch (e) { toast.error('Error: ' + e.message); }
    setBusy(false);
  };

  const saveRates = async () => {
    try {
      const payload = {};
      if (new2w !== '') payload.rate_2w = Number(new2w);
      if (new4w !== '') payload.rate_4w = Number(new4w);
      const res = await base44.functions.invoke('setFieldRate', payload);
      const d = res.data || res;
      if (d.success) { toast.success('Rates updated'); setRates(d.rates); setRateDialog(false); }
      else toast.error(d.error || 'Failed');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  // ── Consolidated reimbursement form ──
  const shiftPeriod = (dir) => {
    const d = new Date(periodDate + 'T00:00:00Z');
    if (periodType === 'week') d.setUTCDate(d.getUTCDate() + dir * 7);
    else d.setUTCMonth(d.getUTCMonth() + dir);
    setPeriodDate(d.toISOString().slice(0, 10));
  };

  const loadFormPreview = async () => {
    setFormLoading(true);
    setFormPreview(null);
    try {
      const res = await base44.functions.invoke('previewFieldReimbursementForm', { period_type: periodType, period_date: periodDate, user_id: targetUser?.id });
      const d = res.data || res;
      if (d.success) setFormPreview(d);
      else toast.error(d.error || 'Could not load period');
    } catch (e) { toast.error('Error: ' + e.message); }
    setFormLoading(false);
  };

  const downloadPreview = () => {
    if (formPreview?.html) printHtml(formPreview.html, 'Local Conveyance Expense Reimbursement Form');
  };

  const submitForm = async () => {
    if (!formPreview?.rows?.length) return;
    setSubmitting(true);
    try {
      const res = await base44.functions.invoke('submitFieldReimbursementForm', {
        period_type: periodType, period_date: periodDate, meal_allowance_total: Number(mealAllowance) || 0, user_id: targetUser?.id,
      });
      const d = res.data || res;
      if (d.success) {
        toast.success(`Reimbursement form submitted: ${fmt(d.amount)} — routed for manager approval`);
        setFormOpen(false); setMealAllowance('');
        load();
      } else toast.error(d.error || 'Submission failed');
    } catch (e) { toast.error('Error: ' + e.message); }
    setSubmitting(false);
  };

  const openFormFor = (user) => { setTargetUser(user); setFormOpen(true); setPickEmployeeOpen(false); };

  // Distinct employees among team trips, for HR/Management to generate a form on their behalf
  const distinctEmployees = React.useMemo(() => {
    const map = new Map();
    for (const t of trips) if (t.user_id && t.employee?.name && !map.has(t.user_id)) map.set(t.user_id, { id: t.user_id, name: t.employee.name, department: t.employee.department });
    return [...map.values()];
  }, [trips]);

  const downloadSubmittedForm = async (claimId) => {
    try {
      const res = await base44.functions.invoke('getFieldReimbursementFormByClaimId', { claim_id: claimId });
      const d = res.data || res;
      if (d.success) printHtml(d.html, 'Local Conveyance Expense Reimbursement Form');
      else toast.error(d.error || 'Could not load form');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const unclaimedCompletedCount = trips.filter(t => scope === 'mine' && t.status === 'completed' && !t.claimed).length;
  // Distinct claim ids among my trips, for "download submitted form" per claim
  const myClaims = [...new Set(trips.filter(t => t.claimed && t.claim_id).map(t => t.claim_id))];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Route className="w-6 h-6 text-orange-600" /> Field Duty
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            GPS-tracked out-duty travel for sales & marketing — 4-Wheeler ₹{rates.four_wheeler || '—'}/km, 2-Wheeler ₹{rates.two_wheeler || '—'}/km (Maxvolt Travel Policy).
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setNew2w(String(rates.two_wheeler || '')); setNew4w(String(rates.four_wheeler || '')); setRateDialog(true); }}>
                <Settings2 className="w-4 h-4 mr-1" /> Set Rates
              </Button>
              <Button variant="outline" size="sm" onClick={() => setScope(scope === 'mine' ? 'all' : 'mine')}>
                {scope === 'mine' ? 'View Team Trips' : 'View My Trips'}
              </Button>
            </>
          )}
          {scope === 'mine' && (
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => openFormFor(null)}>
              <FileText className="w-4 h-4 mr-1" /> Reimbursement Form
              {unclaimedCompletedCount > 0 && <Badge className="ml-1.5 bg-white/20 text-white">{unclaimedCompletedCount}</Badge>}
            </Button>
          )}
          {scope === 'all' && canManage && distinctEmployees.length > 0 && (
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => setPickEmployeeOpen(true)}>
              <FileText className="w-4 h-4 mr-1" /> Generate Form for Employee
            </Button>
          )}
        </div>
      </div>

      {/* Active trip / start */}
      {activeTrip ? (
        <Card className="border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="py-6 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-orange-600">
              {activeTrip.vehicle_type === '4_wheeler' ? <Car className="w-5 h-5" /> : <Bike className="w-5 h-5" />}
              <Navigation className="w-5 h-5 animate-pulse" />
              <span className="font-semibold">Trip in progress{activeTrip.purpose ? ` — ${activeTrip.purpose}` : ''}</span>
            </div>
            <p className="text-5xl font-bold text-gray-800">{fmtKm(liveKm)}</p>
            {(() => { const r = activeTrip.vehicle_type === '4_wheeler' ? rates.four_wheeler : rates.two_wheeler; return r > 0 ? <p className="text-sm text-gray-500">≈ {fmt(liveKm * r)} claimable at ₹{r}/km ({activeTrip.vehicle_type === '4_wheeler' ? '4-Wheeler' : '2-Wheeler'})</p> : null; })()}
            {gpsAccuracy != null && (
              <p className={`text-xs font-medium ${gpsAccuracy <= 25 ? 'text-green-600' : gpsAccuracy <= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                GPS accuracy: {gpsAccuracy}m {gpsAccuracy > 60 ? '— weak signal, distance paused until it improves' : ''}
              </p>
            )}
            <p className="text-xs text-gray-400">Keep the app open (screen stays awake). Points sync every 20 seconds.</p>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={openEndDialog} disabled={busy}>
              <Square className="w-4 h-4 mr-2" /> End Trip
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center space-y-3">
            <MapPin className="w-10 h-10 mx-auto text-orange-400" />
            <p className="text-gray-600 text-sm">Start a trip when you leave for field work. Your route distance is measured by GPS.</p>
            <Button className="bg-orange-600 hover:bg-orange-700 text-white" onClick={() => setStartDialog(true)}>
              <Play className="w-4 h-4 mr-2" /> Start Field Trip
            </Button>
          </CardContent>
        </Card>
      )}

      {/* History */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-700">{scope === 'all' ? 'All trips (team)' : 'My trips'}</h2>
        {loading ? (
          <div className="text-center py-10 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></div>
        ) : trips.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-gray-400">No field trips yet.</CardContent></Card>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                <tr>
                  <th className="px-4 py-2.5 text-left">Date</th>
                  {scope === 'all' && <th className="px-4 py-2.5 text-left">Employee</th>}
                  <th className="px-4 py-2.5 text-left">Vehicle</th>
                  <th className="px-4 py-2.5 text-left">Purpose</th>
                  <th className="px-4 py-2.5 text-right">Distance</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {trips.map(t => {
                  const rate = t.vehicle_type === '4_wheeler' ? rates.four_wheeler : rates.two_wheeler;
                  return (
                    <tr key={t.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700">{t.date}</td>
                      {scope === 'all' && <td className="px-4 py-2.5"><p className="font-medium text-gray-800">{t.employee?.name}</p><p className="text-xs text-gray-400">{t.employee?.department}</p></td>}
                      <td className="px-4 py-2.5 text-gray-600">
                        <span className="inline-flex items-center gap-1">{t.vehicle_type === '4_wheeler' ? <Car className="w-3.5 h-3.5" /> : <Bike className="w-3.5 h-3.5" />} {t.vehicle_type === '4_wheeler' ? '4-Wheeler' : '2-Wheeler'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate">{t.purpose || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium">{fmtKm(t.distance_km)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{t.claimed ? fmt(t.claim_amount) : rate > 0 ? fmt((t.distance_km || 0) * rate + (t.toll_parking_amount || 0)) : '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {t.status === 'active' ? <Badge className="bg-orange-100 text-orange-700">LIVE</Badge>
                          : t.claimed ? <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3 mr-1" />CLAIMED</Badge>
                          : <Badge variant="outline">COMPLETED</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Submitted claims — download the form as it was submitted */}
      {scope === 'mine' && myClaims.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-gray-700">My submitted reimbursement forms</h2>
          <div className="flex flex-wrap gap-2">
            {myClaims.map(cid => (
              <Button key={cid} size="sm" variant="outline" onClick={() => downloadSubmittedForm(cid)}>
                <Download className="w-3.5 h-3.5 mr-1" /> Form {cid.slice(0, 8)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Start dialog */}
      <Dialog open={startDialog} onOpenChange={setStartDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Route className="w-5 h-5 text-orange-600" /> Start Field Trip</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <Label className="text-xs text-gray-500 mb-1.5 block">Vehicle used for this trip</Label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setVehicleType('2_wheeler')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${vehicleType === '2_wheeler' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 hover:border-orange-300'}`}>
                  <Bike className="w-4 h-4" /> 2-Wheeler {rates.two_wheeler > 0 ? `(₹${rates.two_wheeler}/km)` : ''}
                </button>
                <button type="button" onClick={() => setVehicleType('4_wheeler')}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${vehicleType === '4_wheeler' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-600 hover:border-orange-300'}`}>
                  <Car className="w-4 h-4" /> 4-Wheeler {rates.four_wheeler > 0 ? `(₹${rates.four_wheeler}/km)` : ''}
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500">Purpose / client visit (optional)</Label>
              <Input className="mt-1" placeholder="e.g. Dealer visits — Meerut route" value={purpose} onChange={e => setPurpose(e.target.value)} />
            </div>
            <p className="text-xs text-gray-400">Location permission is required. Keep the app open while travelling — the screen will stay awake and distance is recorded from GPS.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setStartDialog(false)}>Cancel</Button>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={startTrip} disabled={busy}>
                {busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />} Start
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* End trip dialog — toll/parking per policy (reimbursed at actual) */}
      <Dialog open={endDialog} onOpenChange={setEndDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Square className="w-5 h-5 text-red-600" /> End Field Trip</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">{fmtKm(liveKm)} recorded on this trip.</p>
            <div>
              <Label className="text-xs text-gray-500">Toll / Parking charges (₹, if any)</Label>
              <Input type="number" className="mt-1" placeholder="0" value={tollAmount} onChange={e => setTollAmount(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-500">Notes (optional)</Label>
              <Input className="mt-1" placeholder="e.g. Toll on NH24 both ways" value={endNotes} onChange={e => setEndNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEndDialog(false)}>Cancel</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={endTrip} disabled={busy}>
                {busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Square className="w-4 h-4 mr-2" />} End Trip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rate dialog (HR/Admin/Management) */}
      <Dialog open={rateDialog} onOpenChange={setRateDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><IndianRupee className="w-5 h-5 text-orange-600" /> Per-KM Rates by Vehicle</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <Label className="text-xs text-gray-500 flex items-center gap-1"><Bike className="w-3.5 h-3.5" /> 2-Wheeler rate (₹ per km)</Label>
              <Input type="number" className="mt-1" placeholder="e.g. 5" value={new2w} onChange={e => setNew2w(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-gray-500 flex items-center gap-1"><Car className="w-3.5 h-3.5" /> 4-Wheeler rate (₹ per km)</Label>
              <Input type="number" className="mt-1" placeholder="e.g. 9" value={new4w} onChange={e => setNew4w(e.target.value)} />
            </div>
            <p className="text-xs text-gray-400">Per Maxvolt Travel Policy (Annexure 2): ₹9/km for 4-Wheeler, ₹5/km for 2-Wheeler, petrol/diesel/CNG.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRateDialog(false)}>Cancel</Button>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={saveRates}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pick an employee to generate a form on their behalf (HR/Admin/Management) */}
      <Dialog open={pickEmployeeOpen} onOpenChange={setPickEmployeeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-orange-600" /> Generate Form for Employee</DialogTitle></DialogHeader>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {distinctEmployees.map(e => (
              <button key={e.id} onClick={() => openFormFor(e)}
                className="w-full text-left px-3 py-2 rounded-lg border hover:border-orange-300 hover:bg-orange-50 transition-colors">
                <p className="text-sm font-medium text-gray-800">{e.name}</p>
                <p className="text-xs text-gray-400">{e.department || ''}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Consolidated reimbursement form generator */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-orange-600" /> Local Conveyance Expense Reimbursement Form{targetUser ? ` — ${targetUser.name}` : ''}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <Tabs value={periodType} onValueChange={(v) => setPeriodType(v)}>
                <TabsList>
                  <TabsTrigger value="week">Weekly</TabsTrigger>
                  <TabsTrigger value="month">Monthly</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => shiftPeriod(-1)}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="text-sm font-medium text-gray-700 min-w-[160px] text-center">{formPreview?.period?.label || '…'}</span>
                <Button size="sm" variant="outline" onClick={() => shiftPeriod(1)}><ChevronRight className="w-4 h-4" /></Button>
              </div>
            </div>

            {formLoading ? (
              <div className="text-center py-10 text-gray-400"><RefreshCw className="w-5 h-5 mx-auto animate-spin" /></div>
            ) : !formPreview?.rows?.length ? (
              <Card><CardContent className="py-10 text-center text-gray-400">No unclaimed completed trips in this period.</CardContent></Card>
            ) : (
              <>
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-left">Vehicle</th>
                        <th className="px-3 py-2 text-left">Purpose</th>
                        <th className="px-3 py-2 text-right">Km</th>
                        <th className="px-3 py-2 text-right">Rate</th>
                        <th className="px-3 py-2 text-right">Toll/Parking</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formPreview.rows.map(r => (
                        <tr key={r.trip_id} className="border-t">
                          <td className="px-3 py-2">{r.date}</td>
                          <td className="px-3 py-2">{r.vehicle_label}</td>
                          <td className="px-3 py-2 max-w-[160px] truncate">{r.purpose || '—'}</td>
                          <td className="px-3 py-2 text-right">{r.distance_km.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">₹{r.rate_per_km}/km</td>
                          <td className="px-3 py-2 text-right">{fmt(r.toll_parking_amount)}</td>
                          <td className="px-3 py-2 text-right font-medium">{fmt(r.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold border-t">
                        <td colSpan={3} className="px-3 py-2">Sub-Total ({formPreview.rows.length} trips)</td>
                        <td className="px-3 py-2 text-right">{formPreview.totals.distance_km.toFixed(2)}</td>
                        <td></td>
                        <td className="px-3 py-2 text-right">{fmt(formPreview.totals.toll_parking_amount)}</td>
                        <td className="px-3 py-2 text-right">{fmt(formPreview.totals.km_amount + formPreview.totals.toll_parking_amount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <Label className="text-xs text-gray-500">Meal Allowance total (₹, optional)</Label>
                    <Input type="number" className="mt-1 w-40" placeholder="0" value={mealAllowance} onChange={e => setMealAllowance(e.target.value)} />
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xs text-gray-500">Grand Total</p>
                    <p className="text-xl font-bold text-orange-700">{fmt(formPreview.totals.km_amount + formPreview.totals.toll_parking_amount + (Number(mealAllowance) || 0))}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t flex-wrap">
                  <Button variant="outline" size="sm" onClick={downloadPreview}><Printer className="w-4 h-4 mr-1" /> Download / Print</Button>
                  <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={submitForm} disabled={submitting}>
                    {submitting ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />} Submit for Approval
                  </Button>
                </div>
                <p className="text-xs text-gray-400">Submitting combines all {formPreview.rows.length} trips above into a single expense claim, routed to your reporting manager for approval — matching the Maxvolt Local Conveyance Expense Reimbursement Form (Annexure 6).</p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
