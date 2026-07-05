import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Route, Play, Square, RefreshCw, IndianRupee, MapPin, Navigation, Wallet, Settings2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const fmtKm = (n) => `${(n || 0).toFixed(2)} km`;
const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');

export default function FieldDuty() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState([]);
  const [rate, setRate] = useState(0);
  const [isHR, setIsHR] = useState(false);
  const [scope, setScope] = useState('mine');

  const [activeTrip, setActiveTrip] = useState(null);
  const [liveKm, setLiveKm] = useState(0);
  const [purpose, setPurpose] = useState('');
  const [startDialog, setStartDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateDialog, setRateDialog] = useState(false);
  const [newRate, setNewRate] = useState('');

  const watchRef = useRef(null);
  const bufferRef = useRef([]);
  const flushTimerRef = useRef(null);
  const wakeLockRef = useRef(null);

  useEffect(() => { load(); return stopWatching; }, [scope]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getFieldTrips', { scope });
      const d = res.data || res;
      if (d.success) {
        setTrips(d.trips || []);
        setRate(d.rate_per_km || 0);
        setIsHR(!!d.is_hr);
        const act = (d.trips || []).find(t => t.status === 'active' && !t.employee?.code);
        const myActive = (d.trips || []).find(t => t.status === 'active');
        const mine = scope === 'mine' ? myActive : act;
        if (mine) { setActiveTrip(mine); setLiveKm(mine.distance_km || 0); startWatching(mine.id); }
      }
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  // ── GPS watcher: buffer points, flush to server every 20s ──
  const startWatching = (tripId) => {
    if (watchRef.current != null || !navigator.geolocation) return;
    // Keep the screen awake while tracking (best-effort)
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(wl => { wakeLockRef.current = wl; }).catch(() => {});
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        bufferRef.current.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: new Date().toISOString() });
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
      const res = await base44.functions.invoke('startFieldTrip', { purpose });
      const d = res.data || res;
      if (d.success) {
        setActiveTrip(d.trip); setLiveKm(0); setStartDialog(false); setPurpose('');
        startWatching(d.trip.id);
        toast.success('Trip started — keep the app open while travelling. Distance is being recorded.');
      } else toast.error(d.error || 'Could not start trip');
    } catch (e) { toast.error('Error: ' + e.message); }
    setBusy(false);
  };

  const endTrip = async () => {
    if (!activeTrip) return;
    setBusy(true);
    try {
      // Flush any buffered points first
      if (bufferRef.current.length) {
        const points = bufferRef.current.splice(0, bufferRef.current.length);
        await base44.functions.invoke('logFieldPoints', { trip_id: activeTrip.id, points }).catch(() => {});
      }
      const res = await base44.functions.invoke('endFieldTrip', { trip_id: activeTrip.id });
      const d = res.data || res;
      if (d.success) {
        stopWatching();
        setActiveTrip(null);
        toast.success(`Trip ended — ${fmtKm(d.trip.distance_km)} recorded`);
        load();
      } else toast.error(d.error || 'Could not end trip');
    } catch (e) { toast.error('Error: ' + e.message); }
    setBusy(false);
  };

  const claim = async (trip) => {
    try {
      const res = await base44.functions.invoke('claimFieldTrip', { trip_id: trip.id });
      const d = res.data || res;
      if (d.success) { toast.success(`Claim submitted: ${fmt(d.amount)} (${fmtKm(d.distance_km)} × ₹${d.rate_per_km}/km) — routed for approval`); load(); }
      else toast.error(d.error || 'Claim failed');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const saveRate = async () => {
    try {
      const res = await base44.functions.invoke('setFieldRate', { rate_per_km: Number(newRate) });
      const d = res.data || res;
      if (d.success) { toast.success(`Rate set to ₹${d.rate_per_km}/km`); setRateDialog(false); load(); }
      else toast.error(d.error || 'Failed');
    } catch (e) { toast.error('Error: ' + e.message); }
  };

  const todayKm = trips.filter(t => t.date === new Date().toISOString().slice(0, 10) && (scope === 'mine' || !t.employee?.code)).reduce((s, t) => s + (t.distance_km || 0), 0) + (activeTrip ? 0 : 0);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Route className="w-6 h-6 text-orange-600" /> Field Duty
          </h1>
          <p className="text-gray-500 text-sm mt-1">GPS-tracked out-duty travel for sales & marketing — claim reimbursement at {rate > 0 ? `₹${rate}/km` : 'the HR-configured rate'}.</p>
        </div>
        <div className="flex gap-2">
          {isHR && (
            <>
              <Button variant="outline" size="sm" onClick={() => { setNewRate(String(rate || '')); setRateDialog(true); }}>
                <Settings2 className="w-4 h-4 mr-1" /> Rate: {rate > 0 ? `₹${rate}/km` : 'not set'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setScope(scope === 'mine' ? 'all' : 'mine')}>
                {scope === 'mine' ? 'View Team Trips' : 'View My Trips'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Active trip / start */}
      {activeTrip ? (
        <Card className="border-orange-300 bg-gradient-to-br from-orange-50 to-amber-50">
          <CardContent className="py-6 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-orange-600">
              <Navigation className="w-5 h-5 animate-pulse" />
              <span className="font-semibold">Trip in progress{activeTrip.purpose ? ` — ${activeTrip.purpose}` : ''}</span>
            </div>
            <p className="text-5xl font-bold text-gray-800">{fmtKm(liveKm)}</p>
            {rate > 0 && <p className="text-sm text-gray-500">≈ {fmt(liveKm * rate)} claimable at ₹{rate}/km</p>}
            <p className="text-xs text-gray-400">Keep the app open (screen stays awake). Points sync every 20 seconds.</p>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={endTrip} disabled={busy}>
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
                  <th className="px-4 py-2.5 text-left">Purpose</th>
                  <th className="px-4 py-2.5 text-right">Distance</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                  <th className="px-4 py-2.5 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {trips.map(t => (
                  <tr key={t.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">{t.date}</td>
                    {scope === 'all' && <td className="px-4 py-2.5"><p className="font-medium text-gray-800">{t.employee?.name}</p><p className="text-xs text-gray-400">{t.employee?.department}</p></td>}
                    <td className="px-4 py-2.5 text-gray-600 max-w-[200px] truncate">{t.purpose || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{fmtKm(t.distance_km)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700">{t.claimed ? fmt(t.claim_amount) : rate > 0 ? fmt((t.distance_km || 0) * rate) : '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {t.status === 'active' ? <Badge className="bg-orange-100 text-orange-700">LIVE</Badge>
                        : t.claimed ? <Badge className="bg-green-100 text-green-700"><CheckCircle2 className="w-3 h-3 mr-1" />CLAIMED</Badge>
                        : <Badge variant="outline">COMPLETED</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {scope === 'mine' && t.status === 'completed' && !t.claimed && (t.distance_km || 0) > 0 && (
                        <Button size="sm" variant="outline" onClick={() => claim(t)}>
                          <Wallet className="w-3.5 h-3.5 mr-1" /> Claim
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Start dialog */}
      <Dialog open={startDialog} onOpenChange={setStartDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Route className="w-5 h-5 text-orange-600" /> Start Field Trip</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
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

      {/* Rate dialog (HR) */}
      <Dialog open={rateDialog} onOpenChange={setRateDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><IndianRupee className="w-5 h-5 text-orange-600" /> Per-KM Rate</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <Label className="text-xs text-gray-500">Reimbursement rate (₹ per km)</Label>
              <Input type="number" className="mt-1" placeholder="e.g. 8" value={newRate} onChange={e => setNewRate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRateDialog(false)}>Cancel</Button>
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={saveRate} disabled={!newRate}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
