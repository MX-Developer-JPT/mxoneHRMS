import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Navigation, RefreshCw, Search, Route, AlertTriangle, ShieldCheck, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { EmployeeRouteMap, LiveMap } from '@/components/maps/GeoMaps';
import { fenceOf } from '@/lib/geofenceShape';

const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }); };
const fmtKm = (n) => `${(Number(n) || 0).toFixed(2)} km`;
const GAP_LABEL = {
  silent: 'Phone silent (off, permission revoked or no network)',
  signal_lost_moving: 'Signal lost while moving',
  offline_now: 'No signal right now',
};

// The rules HR can tune. Defaults are strict; the server clamps every value to a safe range.
const PROBLEM_LABEL = {
  location_denied: 'Location permission off', gps_off: 'GPS switched off',
  background_location_denied: 'Not "Allow all the time"', battery_restricted: 'Battery optimisation on',
};
const RULE_FIELDS_GEOFENCE = [
  ['first_fix_accuracy_m', 'First fix max error (m)', 'The start of a session may be a little rougher'],
  ['geofence_max_accuracy_m', 'Geofence entry max error (m)', 'Attendance IN is refused when less accurate'],
  ['geofence_exit_accuracy_m', 'Geofence exit max error (m)', 'Looser: refusing an exit leaves a day open'],
  ['geofence_max_event_age_h', 'Geofence event max age (h)', 'Older queued events are refused'],
  ['device_report_minutes', 'Phone status report (min)', 'How often the app reports permission / GPS / battery'],
];
const RULE_FIELDS_CORE = [
  ['max_accuracy_m', 'Max GPS error (m)', 'Fixes less accurate than this are dropped'],
  ['min_interval_s', 'Min seconds between fixes', 'Closer fixes are dropped'],
  ['max_speed_kmh', 'Max speed (km/h)', 'Faster jumps between fixes are rejected'],
  ['max_point_age_h', 'Max fix age (hours)', 'Older fixes are rejected as stale'],
  ['gap_minutes', 'Tracking gap after (min)', 'Silence this long is flagged on the route'],
  ['live_stale_minutes', 'Offline after (min)', 'A live dot turns grey after this'],
  ['max_session_hours', 'Max session length (h)', 'A session left open longer is closed automatically'],
];
const RULE_FIELDS = [...RULE_FIELDS_CORE, ...RULE_FIELDS_GEOFENCE];

function RulesEditor({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { base44.functions.invoke('getFieldTrackingConfig', {}).then(r => setCfg((r.data || r).config)).catch(() => toast.error('Could not load the rules')); }, []);
  if (!cfg) return <p className="text-sm text-gray-400 py-4">Loading rules…</p>;
  const save = async () => {
    setSaving(true);
    try {
      const r = await base44.functions.invoke('setFieldTrackingConfig', { config: cfg }); const d = r.data || r;
      if (d.success) { setCfg(d.config); toast.success('Tracking rules saved'); onClose?.(); } else toast.error(d.error || 'Could not save');
    } catch (e) { toast.error(e.message || 'Could not save'); }
    setSaving(false);
  };
  return (
    <div className="rounded-lg border bg-gray-50 p-3 space-y-3">
      <p className="text-xs text-gray-500">These rules are enforced on the server for every upload — the phone cannot bypass them. Values outside the safe range are clamped automatically.</p>
      <div className="grid sm:grid-cols-3 gap-3">
        {RULE_FIELDS.map(([k, label, hint]) => (
          <div key={k}><Label className="text-xs">{label}</Label><Input type="number" value={cfg[k] ?? ''} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} /><p className="text-[10px] text-gray-400 mt-0.5">{hint}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.reject_mock} onCheckedChange={v => setCfg({ ...cfg, reject_mock: v })} /> Reject mock / fake-GPS locations</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.require_background_permission} onCheckedChange={v => setCfg({ ...cfg, require_background_permission: v })} /> Require "Allow all the time" location</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.require_battery_exemption} onCheckedChange={v => setCfg({ ...cfg, require_battery_exemption: v })} /> Require battery optimisation off (Android)</label>
        <label className="flex items-center gap-2 text-sm">Guide to enable location (never blocks) for
          <select className="border rounded px-2 py-1 text-sm" value={cfg.guide_location_permission || 'tracked'} onChange={e => setCfg({ ...cfg, guide_location_permission: e.target.value })}>
            <option value="tracked">field-duty / geofence employees</option><option value="all">everyone</option><option value="off">nobody</option>
          </select></label>
        <label className="flex items-center gap-2 text-sm">Block the app without location for
          <select className="border rounded px-2 py-1 text-sm" value={cfg.require_location_permission || 'tracked'} onChange={e => setCfg({ ...cfg, require_location_permission: e.target.value })}>
            <option value="tracked">field-duty / geofence employees</option><option value="all">everyone</option><option value="off">nobody</option>
          </select></label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.snap_to_roads} onCheckedChange={v => setCfg({ ...cfg, snap_to_roads: v })} /> Draw routes along roads (needs the road-matching service)</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={!!cfg.require_duty_day} onCheckedChange={v => setCfg({ ...cfg, require_duty_day: v })} /> Track only on an approved field-duty day (OD attendance or official gate pass)</label>
      </div>
      <div className="flex gap-2"><Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" disabled={saving} onClick={save}>Save rules</Button><Button size="sm" variant="outline" onClick={onClose}>Cancel</Button></div>
    </div>
  );
}

export default function FieldTrackingPanel({ isHR }) {
  const [employees, setEmployees] = useState([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);       // user_id
  const [date, setDate] = useState(todayIST());
  const [mode, setMode] = useState('employee');          // 'employee' | 'live'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [livePeople, setLivePeople] = useState([]);
  const [liveSel, setLiveSel] = useState(null);
  const [fences, setFences] = useState([]);
  const [rulesOpen, setRulesOpen] = useState(false);

  const loadEmployees = useCallback(async () => {
    try { const r = await base44.functions.invoke('getFieldEmployees', {}); const d = r.data || r; if (d.success) setEmployees(d.employees || []); } catch { /* keep the list */ }
  }, []);
  useEffect(() => { loadEmployees(); const t = setInterval(loadEmployees, 30000); return () => clearInterval(t); }, [loadEmployees]);
  useEffect(() => { base44.entities.AppLocation.list().then(ls => setFences((ls || []).filter(l => l.is_active !== false && l.latitude != null && Number(l.geofence_radius) > 0).map(fenceOf))).catch(() => {}); }, []);

  useEffect(() => {
    if (mode !== 'employee' || !selected) { setData(null); return undefined; }
    let dead = false;
    const pull = async (spin) => {
      if (spin) setLoading(true);
      try {
        const r = await base44.functions.invoke('getFieldRoute', { user_id: selected, date }); const d = r.data || r;
        if (!dead) setData(d.success ? d : { error: d.error || 'Could not load the route' });
      } catch (e) { if (!dead) setData({ error: e.message || 'Could not load the route' }); }
      if (!dead) setLoading(false);
    };
    pull(true);
    const t = date === todayIST() ? setInterval(() => pull(false), 10000) : null;
    return () => { dead = true; if (t) clearInterval(t); };
  }, [mode, selected, date]);

  useEffect(() => {
    if (mode !== 'live') return undefined;
    let dead = false;
    const pull = async () => { try { const r = await base44.functions.invoke('getFieldLive', {}); const d = r.data || r; if (!dead && d.success) setLivePeople(d.people || []); } catch { /* keep */ } };
    pull(); const t = setInterval(pull, 10000);
    return () => { dead = true; clearInterval(t); };
  }, [mode]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees.filter(e => !s || [e.name, e.code, e.department].some(x => String(x || '').toLowerCase().includes(s)));
  }, [employees, q]);
  const route = data?.route;
  const onDuty = employees.filter(e => e.on_duty).length;

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2"><Navigation className="w-4 h-4 text-orange-600" />Field tracking — employee route</h2>
            <p className="text-xs text-gray-500">Only employees enabled under Field Duty Eligibility are tracked or listed. Location is recorded only during an active field-duty session. {isHR ? 'You see everyone; managers see only their own team.' : 'You see your reporting team.'}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={mode === 'employee' ? 'default' : 'outline'} className={mode === 'employee' ? 'bg-orange-600 hover:bg-orange-700 text-white' : ''} onClick={() => setMode('employee')}><Route className="w-4 h-4 mr-1" />Employee & date</Button>
            <Button size="sm" variant={mode === 'live' ? 'default' : 'outline'} className={mode === 'live' ? 'bg-orange-600 hover:bg-orange-700 text-white' : ''} onClick={() => setMode('live')}><Navigation className="w-4 h-4 mr-1" />All on duty now ({onDuty})</Button>
            {isHR && <Button size="sm" variant="outline" onClick={() => setRulesOpen(o => !o)}><Settings2 className="w-4 h-4 mr-1" />Rules</Button>}
          </div>
        </div>

        {rulesOpen && isHR && <RulesEditor onClose={() => setRulesOpen(false)} />}

        {mode === 'live' ? (
          <div className="grid lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2"><LiveMap people={livePeople} fences={fences} selected={liveSel} onSelect={setLiveSel} trail={[]} /></div>
            <div className="space-y-2 max-h-[460px] overflow-y-auto">
              {livePeople.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No eligible employee is on field duty right now.</p>}
              {livePeople.map(p => (
                <div key={p.trip_id} onClick={() => setLiveSel(p.trip_id)} className={`cursor-pointer rounded-lg border p-3 ${liveSel === p.trip_id ? 'border-orange-400 bg-orange-50' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-gray-800">{p.employee?.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.stale ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>{p.position ? (p.age_minutes < 1 ? 'live' : `${p.age_minutes} min ago`) : 'no fix yet'}</span></div>
                  <p className="text-xs text-gray-500">{p.employee?.department} · {fmtKm(p.distance_km)} today</p>
                  <button className="text-xs text-orange-600 underline" onClick={(e) => { e.stopPropagation(); setSelected(p.user_id); setDate(todayIST()); setMode('employee'); }}>View full route</button>
                </div>))}
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-4 gap-3">
            <div className="space-y-2">
              <div className="relative"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" /><Input className="pl-8" placeholder="Search employee" value={q} onChange={e => setQ(e.target.value)} /></div>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {list.length === 0 && <p className="text-sm text-gray-400 text-center py-6">{employees.length ? 'No match.' : 'No employee is enabled for Field Duty Tracking in your team.'}</p>}
                {list.map(e => (
                  <div key={e.user_id} onClick={() => setSelected(e.user_id)} className={`cursor-pointer rounded-lg border px-3 py-2 ${selected === e.user_id ? 'border-orange-400 bg-orange-50' : 'hover:bg-gray-50'}`}>
                    <span className="block text-sm font-medium text-gray-800 leading-tight">{e.name}</span>
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {e.device_problems?.length > 0 && <span title={e.device_problems.map(k => PROBLEM_LABEL[k] || k).join(', ')} className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 shrink-0">phone issue</span>}
                      {e.on_duty ? <span className={`text-[10px] px-2 py-0.5 rounded-full ${e.live?.state === 'live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{e.live?.state === 'live' ? 'on duty · live' : e.live?.state === 'offline' ? `offline ${e.live.age_minutes} min` : 'on duty'}</span> : null}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{e.code} · {e.department}</p>
                  </div>))}
              </div>
            </div>
            <div className="lg:col-span-3 space-y-3">
              {!selected ? <p className="text-sm text-gray-400 text-center py-24">Pick an employee to see their route.</p> : (
                <>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div><Label className="text-xs">Date</Label><Input type="date" value={date} max={todayIST()} onChange={e => e.target.value && setDate(e.target.value)} className="w-44" /></div>
                    {data?.employee && <div className="text-sm"><p className="font-semibold text-gray-800">{data.employee.name} <span className="text-gray-400 font-normal">{data.employee.code}</span></p><p className="text-xs text-gray-500">{data.employee.designation} · {data.employee.department}</p></div>}
                    {loading && <RefreshCw className="w-4 h-4 animate-spin text-gray-400 mb-2" />}
                  </div>
                  {data?.error ? <p className="text-sm text-red-600">{data.error}</p> : route && (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="rounded-lg border p-2.5"><p className="text-[11px] text-gray-500">Distance travelled</p><p className="text-lg font-bold text-gray-800">{fmtKm(route.distance_km)}</p>{route.estimated_km > 0 && <p className="text-[10px] text-amber-700">incl. ~{fmtKm(route.estimated_km)} estimated across signal gaps</p>}</div>
                        <div className="rounded-lg border p-2.5"><p className="text-[11px] text-gray-500">Live status</p>
                          {route.live ? <p className={`text-sm font-semibold ${route.live.state === 'live' ? 'text-green-700' : 'text-gray-600'}`}>{route.live.state === 'live' ? 'Live now' : route.on_duty_now ? `Offline ${route.live.age_minutes} min` : 'Last position'}</p> : <p className="text-sm text-gray-400">No location</p>}
                          {route.live && <p className="text-[10px] text-gray-500">{fmtTime(route.live.t)}{route.live.acc ? ` · ±${Math.round(route.live.acc)} m` : ''}</p>}</div>
                        <div className="rounded-lg border p-2.5"><p className="text-[11px] text-gray-500">Tracking gaps</p><p className={`text-lg font-bold ${route.gaps.length ? 'text-red-600' : 'text-green-700'}`}>{route.gaps.length}</p><p className="text-[10px] text-gray-500">{route.gap_minutes_total} min without data</p></div>
                        <div className="rounded-lg border p-2.5"><p className="text-[11px] text-gray-500">GPS points</p><p className="text-lg font-bold text-gray-800">{route.points_accepted}</p><p className="text-[10px] text-gray-500">{route.points_rejected} rejected by rules</p></div>
                      </div>
                      {route.segments.length === 0
                        ? <p className="text-sm text-gray-400 text-center py-16 border rounded-lg">No field-duty tracking was recorded for this employee on {data.date}.</p>
                        : <EmployeeRouteMap route={route} fences={fences} />}
                      {route.segments.length > 0 && <p className="text-[11px] text-gray-500">{route.snap?.enabled && route.snap.matched_pct != null ? `Drawn along roads (${route.snap.matched_pct}% of the path matched to the road network); the rest follows the raw GPS line. Distance always comes from the GPS points.` : 'Drawn from the raw GPS points (road matching is not active).'}{date === todayIST() ? ' Refreshes every 10 seconds.' : ''}</p>}
                      {(data.device?.problems?.length > 0 || data.device?.events?.length > 0) && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                          <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Phone status {data.device.reported_at ? <span className="text-xs font-normal text-amber-700">(last report {fmtTime(data.device.reported_at)})</span> : null}</p>
                          {data.device.problems.length > 0 && <p className="text-xs text-amber-800">Now: {data.device.problems.map(k => PROBLEM_LABEL[k] || k).join(' · ')}</p>}
                          {data.device.events.map((ev, i) => <p key={i} className="text-xs text-amber-800">{fmtTime(ev.at)} · {ev.kind === 'mock_location' ? `Fake / mock location rejected (${ev.where === 'geofence' ? 'attendance' : 'field duty'})` : ev.problems.length ? ev.problems.map(k => PROBLEM_LABEL[k] || k).join(' · ') : 'Phone settings OK again'}</p>)}
                        </div>)}
                      {route.gaps.length > 0 && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                          <p className="text-sm font-medium text-red-800 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Tracking gaps (dashed red on the map)</p>
                          {route.gaps.map((g, i) => (
                            <p key={i} className="text-xs text-red-700">{fmtTime(g.from)} → {g.open ? 'now' : fmtTime(g.to)} · {g.minutes} min · {GAP_LABEL[g.kind] || g.kind}{g.moved_m ? ` · moved ~${(g.moved_m / 1000).toFixed(2)} km` : ''}</p>))}
                        </div>)}
                      {route.segments.length > 0 && (
                        <div className="text-xs text-gray-600 space-y-0.5">
                          {route.segments.map(s => <p key={s.trip_id}><ShieldCheck className="w-3 h-3 inline mr-1 text-gray-400" />{fmtTime(s.start_time)} – {s.status === 'active' ? 'in progress' : fmtTime(s.end_time)} · {fmtKm(s.distance_km)} · {s.vehicle_type === '4_wheeler' ? '4-wheeler' : '2-wheeler'}{s.purpose ? ` · ${s.purpose}` : ''} <Badge className="ml-1 bg-gray-100 text-gray-600">{s.points.length} pts</Badge></p>)}
                        </div>)}
                    </>)}
                </>)}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
