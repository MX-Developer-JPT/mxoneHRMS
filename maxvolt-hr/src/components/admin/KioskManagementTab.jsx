import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Copy, Power, KeyRound, ShieldOff, ScrollText, Pencil, MonitorSmartphone, MapPin, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

const TOKEN_KEY = 'base44_access_token';
async function kfetch(path, opts = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`/api/kiosk-admin${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}

const when = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
};
const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`;
};
const ACTION_LABEL = {
  login: 'Kiosk signed in', login_failed: 'Failed sign-in', logout: 'Kiosk signed out', invite_lookup: 'Invitation checked', check_in: 'Visitor check-in', check_out: 'Visitor check-out',
  walkin_register: 'Walk-in registered', kiosk_created: 'Kiosk created', kiosk_updated: 'Kiosk updated', credentials_reset: 'Credentials reset', sessions_revoked: 'Sessions revoked',
};
const RESULT_TONE = (r) => (['ok', 'valid', 'pending_approval'].includes(r) ? 'bg-green-100 text-green-700' : r ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600');

function Stat({ label, value, tone = '' }) {
  return <div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div></div>;
}

function KioskForm({ open, onClose, kiosk, locations, onSaved, onCreated }) {
  const editing = !!kiosk;
  const [f, setF] = useState({ name: '', username: '', location_name: '', device_id: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF(kiosk ? { name: kiosk.name, username: kiosk.username, location_name: kiosk.location_name, device_id: kiosk.device_id || '' } : { name: '', username: '', location_name: '', device_id: '' }); }, [open, kiosk]);
  const save = async () => {
    setBusy(true);
    try {
      const r = editing ? await kfetch(`/${kiosk.id}`, { method: 'PATCH', body: f }) : await kfetch('', { method: 'POST', body: f });
      if (!r.success) throw new Error(r.error || 'Could not save');
      if (editing) { toast.success('Kiosk updated'); onSaved(); } else onCreated(r);
      onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const locChanged = editing && f.location_name !== kiosk.location_name;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>{editing ? `Edit ${kiosk.kiosk_code}` : 'New kiosk'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Kiosk name</Label><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Duhai Reception Kiosk" /></div>
          <div><Label>Office location <span className="text-red-500">*</span></Label>
            <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={f.location_name} onChange={e => setF({ ...f, location_name: e.target.value })}>
              <option value="">Select a location…</option>{locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <p className="text-xs text-muted-foreground mt-1">A kiosk serves exactly one location. Visitors it registers are always assigned to it.</p>
          </div>
          {locChanged && <p className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 p-2">Changing the location signs this kiosk out immediately. It must be signed in again and will then serve {f.location_name}.</p>}
          <div><Label>Username</Label><Input value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase() })} placeholder="duhai-reception" autoCapitalize="none" /></div>
          <div><Label>Device identification (optional)</Label><Input value={f.device_id} onChange={e => setF({ ...f, device_id: e.target.value })} placeholder="e.g. Tablet TAB-01, serial or asset tag" /></div>
          {!editing && <p className="text-xs text-muted-foreground">A strong password is generated and shown once after you create the kiosk.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !f.name || !f.username || !f.location_name}>{busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}{editing ? 'Save' : 'Create kiosk'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialDialog({ data, onClose }) {
  if (!data) return null;
  const url = `${window.location.origin}/kiosk`;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader><DialogTitle>Kiosk credentials</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 p-2">This password is shown only once. Copy it now and enter it on the kiosk device.</p>
          {[['Kiosk', `${data.kiosk.name} (${data.kiosk.kiosk_code})`, false], ['Location', data.kiosk.location_name, false], ['Kiosk address', url, true], ['Username', data.kiosk.username, true], ['Password', data.password, true]].map(([k, v, c]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b pb-2"><span className="text-muted-foreground">{k}</span><span className="font-mono text-right break-all">{v}</span>{c && <button onClick={() => copy(v)} className="text-muted-foreground hover:text-foreground"><Copy className="w-4 h-4" /></button>}</div>
          ))}
          <p className="text-xs text-muted-foreground">Open the address on the tablet or touchscreen, sign in once, and leave the browser in full-screen. For a locked-down device, also use the tablet’s kiosk mode (Android screen pinning / iPad Guided Access / Chrome <code>--kiosk</code>).</p>
        </div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogsPanel({ kiosks, initialKiosk }) {
  const [kioskId, setKioskId] = useState(initialKiosk || ''); const [logs, setLogs] = useState([]); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setLogs((await kfetch(`/logs?limit=300${kioskId ? `&kiosk_id=${kioskId}` : ''}`)).logs || []); } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [kioskId]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={kioskId} onChange={e => setKioskId(e.target.value)}><option value="">All kiosks</option>{kiosks.map(k => <option key={k.id} value={k.id}>{k.kiosk_code} · {k.name}</option>)}</select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
      </div>
      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{['When', 'Kiosk', 'Location', 'Action', 'Result', 'Visitor', 'Detail'].map(h => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              : logs.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No activity yet</td></tr>
                : logs.map(l => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap">{when(l.at)}</td><td className="px-3 py-2 whitespace-nowrap">{l.kiosk_code || '—'}<div className="text-xs text-muted-foreground">{l.kiosk_name}</div></td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.location_name || '—'}</td><td className="px-3 py-2 whitespace-nowrap">{ACTION_LABEL[l.action] || l.action}{l.actor && l.actor !== 'kiosk' && <div className="text-xs text-muted-foreground">by {l.actor}</div>}</td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${RESULT_TONE(l.result)}`}>{(l.result || '—').replace(/_/g, ' ')}</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{l.visitor_id ? l.visitor_id.slice(0, 8).toUpperCase() : '—'}</td><td className="px-3 py-2 text-xs text-muted-foreground max-w-xs">{l.detail}</td>
                  </tr>))}
          </tbody></table>
      </div>
    </div>
  );
}

function ReportPanel({ locations }) {
  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() + 5.5 * 3600000 - 29 * 86400000).toISOString().slice(0, 10)); const [to, setTo] = useState(today);
  const [loc, setLoc] = useState('all'); const [kioskOnly, setKioskOnly] = useState(false); const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await kfetch(`/report?from=${from}&to=${to}&location=${encodeURIComponent(loc)}${kioskOnly ? '&kiosk_only=1' : ''}`)); } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, [from, to, loc, kioskOnly]);
  useEffect(() => { load(); }, [load]);
  const cols = [['invited', 'Invited'], ['walk_in', 'Walk-in'], ['total', 'Total'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['inside', 'Inside now'], ['checked_out', 'Checked out'], ['via_kiosk', 'Via kiosk']];
  const csv = () => {
    if (!data) return;
    const rows = [['Location', ...cols.map(c => c[1])], ...data.by_location.map(r => [r.location, ...cols.map(([k]) => r[k])]), ['All locations', ...cols.map(([k]) => data.total[k] || 0)]];
    const blob = new Blob([rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Visitor_Report_${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3 flex-wrap">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9" /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9" /></div>
        <div><Label className="text-xs">Location</Label><select className="h-9 rounded-md border bg-background px-3 text-sm block" value={loc} onChange={e => setLoc(e.target.value)}><option value="all">All locations</option>{locations.map(l => <option key={l}>{l}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm h-9"><input type="checkbox" checked={kioskOnly} onChange={e => setKioskOnly(e.target.checked)} />Only visits handled by a kiosk</label>
        <Button variant="outline" size="sm" onClick={csv} disabled={!data}><Download className="w-4 h-4 mr-2" />CSV</Button>
      </div>
      <div className="rounded-xl border overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Location</th>{cols.map(c => <th key={c[0]} className="px-3 py-2 font-medium text-right whitespace-nowrap">{c[1]}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={cols.length + 1} className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              : !data?.by_location?.length ? <tr><td colSpan={cols.length + 1} className="p-6 text-center text-muted-foreground">No visitors in this period</td></tr>
                : <>{data.by_location.map(r => <tr key={r.location} className="border-t"><td className="px-3 py-2 font-medium">{r.location}</td>{cols.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums">{r[k]}</td>)}</tr>)}
                  <tr className="border-t bg-muted/30 font-semibold"><td className="px-3 py-2">All locations</td>{cols.map(([k]) => <td key={k} className="px-3 py-2 text-right tabular-nums">{data.total[k] || 0}</td>)}</tr></>}
          </tbody></table>
      </div>
      <p className="text-xs text-muted-foreground">Counts every visitor record in the Visitor Management register for the period (by visit date). “Via kiosk” = registered, checked in or checked out at a kiosk. Approved includes visitors who have since checked in or out.</p>
    </div>
  );
}

export default function KioskManagementTab() {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [view, setView] = useState('kiosks');
  const [form, setForm] = useState({ open: false, kiosk: null }); const [creds, setCreds] = useState(null); const [logFor, setLogFor] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setData(await kfetch('/overview')); } catch (e) { toast.error('Failed to load kiosks: ' + e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const act = async (k, what) => {
    const text = { toggle: k.is_active ? `Deactivate ${k.name}? It is signed out immediately and cannot be used until reactivated.` : null, revoke: `Sign ${k.name} out everywhere? The device will need the kiosk password again.`, reset: `Reset the password for ${k.name}? The current password stops working and the device is signed out.` }[what];
    if (text && !window.confirm(text)) return;
    setBusy(k.id + what);
    try {
      if (what === 'toggle') { await kfetch(`/${k.id}`, { method: 'PATCH', body: { is_active: !k.is_active } }); toast.success(k.is_active ? 'Kiosk deactivated' : 'Kiosk activated'); }
      if (what === 'revoke') { await kfetch(`/${k.id}/revoke-sessions`, { method: 'POST' }); toast.success('Kiosk signed out'); }
      if (what === 'reset') { const r = await kfetch(`/${k.id}/reset-credentials`, { method: 'POST', body: {} }); setCreds({ kiosk: r.kiosk, password: r.password }); }
      await load();
    } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (loading) return <div className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>;
  if (!data) return null;
  const { stats, kiosks, locations } = data;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h2 className="text-lg font-semibold flex items-center gap-2"><MonitorSmartphone className="w-5 h-5" />Visitor Kiosks</h2><p className="text-sm text-muted-foreground">Self-service check-in and walk-in registration screens, each tied to one office location.</p></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button><Button size="sm" onClick={() => setForm({ open: true, kiosk: null })}><Plus className="w-4 h-4 mr-2" />New kiosk</Button></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Total kiosks" value={stats.total} /><Stat label="Active" value={stats.active} tone="text-green-600" /><Stat label="Inactive" value={stats.inactive} tone={stats.inactive ? 'text-amber-600' : ''} /><Stat label="Online now" value={stats.online} tone="text-blue-600" />
      </div>
      {stats.by_location.length > 0 && <div className="flex flex-wrap gap-2">{stats.by_location.map(l => <span key={l.location} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"><MapPin className="w-3.5 h-3.5" />{l.location}<span className="text-muted-foreground">· {l.active}/{l.total} active</span></span>)}</div>}

      <div className="flex gap-1 border-b">{[['kiosks', 'Kiosks'], ['logs', 'Activity log'], ['report', 'Location report']].map(([id, l]) => <button key={id} onClick={() => { setView(id); if (id !== 'logs') setLogFor(''); }} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${view === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{l}</button>)}</div>

      {view === 'kiosks' && (
        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>{['Kiosk', 'Location', 'Username', 'Status', 'Last active', 'Last login', 'Created', ''].map(h => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {kiosks.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No kiosks yet. Create one to get started.</td></tr>}
              {kiosks.map(k => (
                <tr key={k.id} className="border-t align-top">
                  <td className="px-3 py-2"><div className="font-medium">{k.name}</div><div className="text-xs text-muted-foreground font-mono">{k.kiosk_code}{k.device_id ? ` · ${k.device_id}` : ''}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap">{k.location_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.username}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{k.is_active ? <Badge className={k.online ? 'bg-green-100 text-green-700 hover:bg-green-100' : 'bg-gray-100 text-gray-700 hover:bg-gray-100'}>{k.online ? 'Online' : 'Active · offline'}</Badge> : <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Inactive</Badge>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{ago(k.last_active_at)}<div className="text-xs text-muted-foreground">{k.last_ip}</div></td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{when(k.last_login_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{when(k.created_at)}<div className="text-muted-foreground">{k.created_by_name}</div></td>
                  <td className="px-3 py-2"><div className="flex gap-1">
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setForm({ open: true, kiosk: k })}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title={k.is_active ? 'Deactivate' : 'Activate'} disabled={busy === k.id + 'toggle'} onClick={() => act(k, 'toggle')}><Power className={`w-4 h-4 ${k.is_active ? 'text-green-600' : 'text-amber-600'}`} /></Button>
                    <Button variant="ghost" size="icon" title="Reset credentials" onClick={() => act(k, 'reset')}><KeyRound className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title="Revoke sessions" onClick={() => act(k, 'revoke')}><ShieldOff className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" title="Activity log" onClick={() => { setLogFor(k.id); setView('logs'); }}><ScrollText className="w-4 h-4" /></Button>
                  </div></td>
                </tr>))}
            </tbody></table>
        </div>
      )}
      {view === 'logs' && <LogsPanel kiosks={kiosks} initialKiosk={logFor} key={logFor} />}
      {view === 'report' && <ReportPanel locations={locations} />}

      <KioskForm open={form.open} kiosk={form.kiosk} locations={locations} onClose={() => setForm({ open: false, kiosk: null })} onSaved={load} onCreated={(r) => { setCreds({ kiosk: r.kiosk, password: r.password }); load(); }} />
      <CredentialDialog data={creds} onClose={() => setCreds(null)} />
    </div>
  );
}
