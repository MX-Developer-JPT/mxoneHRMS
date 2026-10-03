import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Fingerprint, Search, Download, Loader2, ChevronLeft, ChevronRight, Clock, Users, AlarmClock, AlertTriangle, Cpu, Info, Moon, ShieldAlert } from 'lucide-react';
import { safeDate } from '@/lib/dateUtils';
import { toast } from 'sonner';

const OT_AFTER = 9;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hm = (mins) => `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
const hrs = (mins) => (mins / 60).toFixed(2);
const nowIst = () => new Date(Date.now() + 5.5 * 3600000);

function downloadBase64Xlsx(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const Stat = ({ icon: Icon, label, value, sub, cls }) => (
  <Card><CardContent className="p-3">
    <div className="flex items-center gap-2 text-xs text-gray-500"><Icon className={`w-4 h-4 ${cls}`} />{label}</div>
    <p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p>
    {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
  </CardContent></Card>
);

export default function OffRoleAttendance() {
  const init = nowIst();
  const [year, setYear] = useState(init.getUTCFullYear());
  const [month, setMonth] = useState(init.getUTCMonth() + 1);
  const [device, setDevice] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('daily');   // daily | people
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [role, setRole] = useState(undefined); // undefined = still checking

  useEffect(() => {
    base44.auth.me().then(u => setRole(u?.custom_role || u?.role || '')).catch(() => setRole(''));
  }, []);
  const allowed = role === 'hr' || role === 'admin';

  const range = useMemo(() => {
    const dim = new Date(year, month, 0).getDate();
    const p = (n) => String(n).padStart(2, '0');
    return { from: `${year}-${p(month)}-01`, to: `${year}-${p(month)}-${p(dim)}` };
  }, [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getOffRoleAttendance', { ...range, device, search });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || 'Could not load off-role attendance');
      setData(d); setError('');
    } catch (e) {
      setError(e.message || 'Could not load off-role attendance');
    }
    setLoading(false);
  }, [range, device, search]);

  // search is debounced so typing doesn't fire a request per keystroke
  useEffect(() => { if (!allowed) return; const t = setTimeout(load, search ? 350 : 0); return () => clearTimeout(t); }, [load, search, allowed]);

  const shift = (delta) => {
    let m = month + delta, y = year;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await base44.functions.invoke('exportOffRoleAttendance', { year, month, device, search });
      const d = res?.data || res;
      if (!d?.success || !d.base64) throw new Error(d?.error || 'Export failed');
      downloadBase64Xlsx(d.base64, d.filename);
      toast.success(`Exported ${d.people} code${d.people === 1 ? '' : 's'} · ${d.days} person-day${d.days === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e.message || 'Export failed');
    }
    setExporting(false);
  };

  const s = data?.summary;
  const devices = data?.devices || [];

  if (role === undefined) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;
  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-screen p-6">
        <div className="text-center max-w-sm">
          <ShieldAlert className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="font-semibold text-gray-700">HR or admin access required</p>
          <p className="text-sm text-gray-500 mt-1">Off role attendance is available to HR and admin only.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2"><Fingerprint className="w-7 h-7 text-amber-500" /> Off role attendance</h1>
            <p className="text-gray-600 mt-1 text-sm max-w-2xl">
              Biometric punches received from codes that are <strong>not mapped to any employee</strong>. Shows each person's first and last punch of the shift
              and the machine it came from; night shifts that cross midnight are handled as one shift. Overtime is calculated automatically after {OT_AFTER} hours a day.
            </p>
          </div>
          <Button onClick={handleExport} disabled={exporting || !data?.days?.length} className="bg-neutral-900 text-amber-400 hover:bg-neutral-800">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export {MONTHS[month - 1]} {year} (Excel muster)
          </Button>
        </div>

        {/* Controls */}
        <Card><CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-white">
            <button className="p-2 hover:bg-gray-50 rounded-l-lg" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
            <span className="px-3 text-sm font-semibold w-36 text-center">{MONTHS[month - 1]} {year}</span>
            <button className="p-2 hover:bg-gray-50 rounded-r-lg" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <select value={device} onChange={e => setDevice(e.target.value)} aria-label="Biometric machine" className="border border-input rounded-md px-2.5 h-9 text-sm bg-background min-w-[170px]">
            <option value="all">All biometric machines</option>
            {devices.map(d => <option key={d.name} value={d.name}>{d.name}{d.location ? ` — ${d.location}` : ''}</option>)}
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-9" placeholder="Search biometric code…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex rounded-lg border overflow-hidden text-sm">
            {[['daily', 'Daily punches'], ['people', 'By person']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 ${view === k ? 'bg-neutral-900 text-amber-400' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l}</button>
            ))}
          </div>
        </CardContent></Card>

        {error && <Card className="border-red-200 bg-red-50"><CardContent className="p-4 text-sm text-red-700">{error}</CardContent></Card>}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat icon={Users} label="Unmapped codes" value={s?.people ?? '—'} cls="text-gray-800" />
          <Stat icon={Clock} label="Person-days" value={s?.person_days ?? '—'} cls="text-blue-600" />
          <Stat icon={Clock} label="Total hours" value={s ? hrs(s.total_minutes) : '—'} sub="first → last punch" cls="text-green-600" />
          <Stat icon={AlarmClock} label={`Overtime (>${OT_AFTER}h)`} value={s ? hrs(s.ot_minutes) : '—'} sub="auto-calculated" cls="text-orange-600" />
          <Stat icon={AlertTriangle} label="Single-punch days" value={s?.single_punch_days ?? '—'} sub="no out punch" cls="text-amber-600" />
          <Stat icon={Moon} label="Night shifts" value={s?.overnight_shifts ?? '—'} sub="cross midnight" cls="text-indigo-600" />
        </div>

        {/* Machines */}
        {devices.length > 0 && (
          <Card><CardContent className="p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> Biometric machines sending unmapped punches</p>
            <div className="flex flex-wrap gap-2">
              {devices.map(d => (
                <button key={d.name} onClick={() => setDevice(device === d.name ? 'all' : d.name)}
                  className={`text-xs rounded-full border px-3 py-1.5 flex items-center gap-2 transition-colors ${device === d.name ? 'bg-neutral-900 text-amber-400 border-neutral-900' : 'bg-white hover:bg-gray-50'}`}>
                  <span className="font-semibold">{d.name}</span>
                  {d.location && <span className="opacity-70">{d.location}</span>}
                  <span className="opacity-60">{d.punches} punch{d.punches === 1 ? "" : "es"}</span>
                </button>
              ))}
            </div>
          </CardContent></Card>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : !data?.days?.length ? (
          <Card><CardContent className="p-12 text-center text-gray-400">
            <Fingerprint className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No off-role punches for {MONTHS[month - 1]} {year}{device !== 'all' || search ? ' with these filters' : ''}.</p>
          </CardContent></Card>
        ) : view === 'daily' ? (
          <>
            <Card className="hidden md:block"><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>{['Date', 'Biometric code', 'First punch', 'Last punch', 'Punches', 'Total hrs', 'Regular', `OT (>${OT_AFTER}h)`, 'Location'].map(h => <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.days.map(d => (
                    <tr key={`${d.code}-${d.date}`} className={`border-t hover:bg-amber-50/40 ${d.single_punch ? 'bg-yellow-50/50' : ''}`}>
                      <td className="px-3 py-2.5 whitespace-nowrap"><span className="font-medium">{safeDate(d.date, 'dd MMM yyyy')}</span> <span className="text-xs text-gray-400">{d.dow}</span>{d.overnight && <Badge className="ml-1.5 bg-indigo-100 text-indigo-700 gap-1"><Moon className="w-3 h-3" />Night</Badge>}</td>
                      <td className="px-3 py-2.5 font-semibold">{d.code}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><p className="font-medium text-green-700">{safeDate(d.first_punch, 'hh:mm a')}</p><p className="text-[11px] text-gray-500 flex items-center gap-1"><Cpu className="w-3 h-3" />{d.first_device}</p></td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {d.last_punch
                          ? <><p className="font-medium text-orange-700">{safeDate(d.last_punch, 'hh:mm a')}{d.overnight && <span className="ml-1 text-[10px] font-semibold text-indigo-600">+1 day</span>}</p><p className="text-[11px] text-gray-500 flex items-center gap-1"><Cpu className="w-3 h-3" />{d.last_device}</p></>
                          : <Badge className="bg-yellow-100 text-yellow-800">Single punch</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-center">{d.punch_count}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-medium">{d.single_punch ? '—' : `${hm(d.total_minutes)} h`}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{d.single_punch ? '—' : `${hm(d.regular_minutes)} h`}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{d.ot_minutes > 0 ? <Badge className="bg-orange-100 text-orange-800">{hm(d.ot_minutes)} h</Badge> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{d.location || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent></Card>

            <div className="md:hidden space-y-2">
              {data.days.map(d => (
                <Card key={`${d.code}-${d.date}`}><CardContent className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{d.code}</p>
                    <span className="text-xs text-gray-500">{safeDate(d.date, 'dd MMM')} · {d.dow}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-gray-400">First punch</p><p className="font-medium text-green-700">{safeDate(d.first_punch, 'hh:mm a')}</p><p className="text-gray-500">{d.first_device}</p></div>
                    <div><p className="text-gray-400">Last punch</p>{d.last_punch ? <><p className="font-medium text-orange-700">{safeDate(d.last_punch, 'hh:mm a')}{d.overnight && <span className="ml-1 text-[10px] font-semibold text-indigo-600">+1 day</span>}</p><p className="text-gray-500">{d.last_device}</p></> : <p className="text-yellow-700 font-medium">Single punch</p>}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {!d.single_punch && <Badge variant="outline">{hm(d.total_minutes)} h</Badge>}
                    {d.ot_minutes > 0 && <Badge className="bg-orange-100 text-orange-800">OT {hm(d.ot_minutes)} h</Badge>}
                  </div>
                </CardContent></Card>
              ))}
            </div>
          </>
        ) : (
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>{['Biometric code', 'Machine(s)', 'Days present', 'Total hrs', 'Regular hrs', 'OT hrs', 'Single-punch days'].map(h => <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.people.map(p => (
                  <tr key={p.code} className="border-t hover:bg-amber-50/40">
                    <td className="px-3 py-2.5 font-semibold">{p.code}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-600">{p.devices.join(', ')}</td>
                    <td className="px-3 py-2.5">{p.days}</td>
                    <td className="px-3 py-2.5 font-medium">{hrs(p.total_minutes)}</td>
                    <td className="px-3 py-2.5">{hrs(p.regular_minutes)}</td>
                    <td className="px-3 py-2.5">{p.ot_minutes > 0 ? <Badge className="bg-orange-100 text-orange-800">{hrs(p.ot_minutes)}</Badge> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2.5">{p.single_days || <span className="text-gray-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        )}

        <Card className="border-dashed"><CardContent className="p-3 text-xs text-gray-500 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
          <p>
            Punches arrive through the normal biometric sync, or can be sent to the dedicated receiver <code className="bg-gray-100 px-1 rounded">POST /api/attendance-log/off-role</code> (same API key and record format).
            A code disappears from this page automatically once it is mapped to an employee. Working hours run from the first to the last punch of a shift (a break of more than 12 hours starts a new shift), so a night shift 10 PM → 6 AM counts once, on the day it starts.
          </p>
        </CardContent></Card>
      </div>
    </div>
  );
}
