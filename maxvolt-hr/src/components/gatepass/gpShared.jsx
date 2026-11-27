// Shared look and behaviour of every gate pass screen: statuses, summary cards, tabs, search / filters / sorting and the
// list card. The server (gp_board / gp_detail) decides what each viewer may do; screens only render `pass.can`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { Search, LogOut, LogIn, ArrowRight, Clock, Inbox, ClipboardList, Hourglass, DoorOpen, Plane, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';

export const TRAVEL = 'travelling_to_another_office';
export const OUTING_LABELS = {
  official_outing: 'Official Outing', unofficial_outing: 'Unofficial Outing', half_day: 'Half Day', short_break: 'Short Break',
  early_leave: 'Early Leave', [TRAVEL]: 'Travelling to Another Office',
};
export const outingLabel = (t) => OUTING_LABELS[t] || String(t || 'Gate pass').replace(/_/g, ' ');
export const isTravel = (p) => p?.outing_type === TRAVEL && !!p?.destination_location;

export const STAGES = {
  pending_approval: { label: 'Pending Approval', cls: 'bg-amber-100 text-amber-800 border-amber-200', bar: 'border-l-amber-400', dot: 'bg-amber-500' },
  approved: { label: 'Approved', cls: 'bg-blue-100 text-blue-800 border-blue-200', bar: 'border-l-blue-500', dot: 'bg-blue-500' },
  outside: { label: 'Outside', cls: 'bg-orange-100 text-orange-800 border-orange-200', bar: 'border-l-orange-500', dot: 'bg-orange-500' },
  in_transit: { label: 'In Transit', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200', bar: 'border-l-indigo-500', dot: 'bg-indigo-500' },
  completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  returned: { label: 'Returned', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', bar: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  auto_closed: { label: 'Auto-Closed', cls: 'bg-purple-100 text-purple-800 border-purple-200', bar: 'border-l-purple-400', dot: 'bg-purple-500' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-200', bar: 'border-l-red-400', dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-700 border-gray-200', bar: 'border-l-gray-300', dot: 'bg-gray-400' },
};
export const stageOf = (p) => (p.status === 'departed' ? (isTravel(p) ? 'in_transit' : 'outside') : p.status);
export const stageLabel = (p) => (p.travel_outcome === 'not_arrived' ? 'Did Not Arrive' : STAGES[stageOf(p)]?.label || p.status);
export function StageBadge({ pass }) {
  return <Badge variant="outline" className={`border whitespace-nowrap ${STAGES[stageOf(pass)]?.cls || ''}`}>{stageLabel(pass)}</Badge>;
}

export const GROUPS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'pending', label: 'Pending', test: (s) => s === 'pending_approval' },
  { key: 'approved', label: 'Approved', test: (s) => s === 'approved' },
  { key: 'outside', label: 'Outside', test: (s) => s === 'outside' },
  { key: 'in_transit', label: 'In Transit', test: (s) => s === 'in_transit' },
  { key: 'completed', label: 'Completed', test: (s) => s === 'completed' || s === 'returned' },
];
const inGroup = (p, key) => (GROUPS.find((g) => g.key === key) || GROUPS[0]).test(stageOf(p));

export const passDay = (p) => p.request_date || String(p.requested_at || p.created_date || '').slice(0, 10);

// Loads gp_board and keeps it fresh (every 30s, and when the tab becomes visible again).
export function useGateBoard(params) {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const key = JSON.stringify(params || {});
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setRefreshing(true);
    try {
      const r = await base44.functions.invoke('gp_board', JSON.parse(key));
      if (mine === seq.current) { setBoard(r.data); setError(''); }
    } catch (e) { if (mine === seq.current) setError(e.message || 'Could not load gate passes'); }
    if (mine === seq.current) setRefreshing(false);
  }, [key]);
  useEffect(() => {
    reload();
    const t = setInterval(() => { if (!document.hidden) reload(); }, 30000);
    const onShow = () => { if (!document.hidden) reload(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [reload]);
  return { board, error, refreshing, reload };
}

const CARDS = [
  { key: 'all', label: 'Total Gate Passes', icon: ClipboardList, tone: 'text-slate-600 bg-slate-100' },
  { key: 'pending', label: 'Pending Approvals', icon: Hourglass, tone: 'text-amber-700 bg-amber-100' },
  { key: 'outside', label: 'Currently Outside', icon: DoorOpen, tone: 'text-orange-700 bg-orange-100' },
  { key: 'in_transit', label: 'Travelling Between Offices', icon: Plane, tone: 'text-indigo-700 bg-indigo-100' },
  { key: 'completed', label: 'Completed', icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-100' },
];
export function SummaryCards({ passes, active, onPick }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARDS.map((c) => (
        <button key={c.key} type="button" onClick={() => onPick(c.key)} aria-pressed={active === c.key}
          className={`text-left rounded-xl border bg-white dark:bg-gray-900 dark:border-gray-700 p-3 sm:p-4 shadow-sm hover:shadow-md transition ${active === c.key ? 'ring-2 ring-blue-500' : ''}`}>
          <span className={`inline-flex p-1.5 rounded-lg ${c.tone}`}><c.icon className="w-4 h-4" /></span>
          <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{passes.filter((p) => inGroup(p, c.key)).length}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">{c.label}</p>
        </button>
      ))}
    </div>
  );
}

const EMPTY = { group: 'all', search: '', department: '', office: '', from: '', to: '', sort: 'newest' };
const SORTS = {
  newest: ['Newest first', (a, b) => String(b.requested_at || b.created_date || '').localeCompare(String(a.requested_at || a.created_date || ''))],
  oldest: ['Oldest first', (a, b) => String(a.requested_at || a.created_date || '').localeCompare(String(b.requested_at || b.created_date || ''))],
  name: ['Employee name', (a, b) => String(a.employee?.name || '').localeCompare(String(b.employee?.name || ''))],
  departure: ['Latest departure', (a, b) => String(b.departure_time || '').localeCompare(String(a.departure_time || ''))],
  status: ['Status', (a, b) => stageLabel(a).localeCompare(stageLabel(b))],
};

// passes must carry employee {name, code, department}
export function usePassFilters(passes, initial) {
  const [f, setF] = useState({ ...EMPTY, ...initial });
  const set = (patch) => setF((prev) => ({ ...prev, ...patch }));
  const base = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return passes.filter((p) => (!q || [p.employee?.name, p.employee?.code, p.pass_no, p.reason].some((x) => String(x || '').toLowerCase().includes(q)))
      && (!f.department || p.employee?.department === f.department)
      && (!f.office || p.current_location === f.office || p.destination_location === f.office)
      && (!f.from || passDay(p) >= f.from) && (!f.to || passDay(p) <= f.to));
  }, [passes, f.search, f.department, f.office, f.from, f.to]);
  const rows = useMemo(() => base.filter((p) => inGroup(p, f.group)).sort(SORTS[f.sort][1]), [base, f.group, f.sort]);
  const dirty = ['search', 'department', 'office', 'from', 'to'].some((k) => f[k]);
  return { f, set, rows, base, dirty, clear: () => set({ search: '', department: '', office: '', from: '', to: '' }) };
}

const selectCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0';
export function FilterBar({ filters, passes, onRefresh, refreshing, tabs = true }) {
  const { f, set, base, dirty, clear } = filters;
  const departments = [...new Set(passes.map((p) => p.employee?.department).filter(Boolean))].sort();
  const offices = [...new Set(passes.flatMap((p) => [p.current_location, p.destination_location]).filter(Boolean))].sort();
  return (
    <div className="space-y-3">
      {tabs && (
        <div className="flex gap-1 overflow-x-auto border-b dark:border-gray-700" role="tablist">
          {GROUPS.map((g) => {
            const count = base.filter((p) => g.test(stageOf(p))).length;
            const on = f.group === g.key;
            return (
              <button key={g.key} type="button" role="tab" aria-selected={on} onClick={() => set({ group: g.key })}
                className={`shrink-0 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${on ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                {g.label} <span className={`ml-1 rounded-full px-1.5 text-xs ${on ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2">
        <div className="relative col-span-2 md:flex-1 md:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9 h-9" placeholder="Search name, employee ID, pass no…" aria-label="Search gate passes" value={f.search} onChange={(e) => set({ search: e.target.value })} />
        </div>
        <select className={selectCls} aria-label="Department" value={f.department} onChange={(e) => set({ department: e.target.value })}><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
        <select className={selectCls} aria-label="Office" value={f.office} onChange={(e) => set({ office: e.target.value })}><option value="">All offices</option>{offices.map((o) => <option key={o}>{o}</option>)}</select>
        <Input type="date" className="h-9 md:w-36" aria-label="From date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
        <Input type="date" className="h-9 md:w-36" aria-label="To date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        <select className={selectCls} aria-label="Sort by" value={f.sort} onChange={(e) => set({ sort: e.target.value })}>{Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}</select>
        {dirty && <Button size="sm" variant="ghost" className="h-9" onClick={clear}>Clear</Button>}
        {onRefresh && <Button size="sm" variant="outline" className="h-9" onClick={onRefresh} disabled={refreshing} aria-label="Refresh"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>}
      </div>
    </div>
  );
}

export function Empty({ title = 'No gate passes', hint, icon: Icon = Inbox }) {
  return (
    <div className="text-center py-14 border border-dashed rounded-xl text-gray-400 dark:border-gray-700">
      <Icon className="w-9 h-9 mx-auto mb-2 opacity-40" />
      <p className="font-medium text-gray-500">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  );
}

export function Loading() {
  return <div className="space-y-3" aria-busy="true" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />)}</div>;
}

export function Route({ pass }) {
  if (!pass.current_location) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${isTravel(pass) ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-500'}`}>
      {pass.current_location}{isTravel(pass) && <><ArrowRight className="w-3.5 h-3.5" />{pass.destination_location}</>}
    </span>
  );
}

export function PassCard({ pass, onOpen, actions, showEmployee = true }) {
  const e = pass.employee || {};
  return (
    <Card className={`border-l-4 ${STAGES[stageOf(pass)]?.bar || ''} hover:shadow-md transition-shadow`}>
      <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <button type="button" onClick={() => onOpen(pass)} className="flex-1 min-w-0 text-left flex items-start gap-3">
          {showEmployee && <span className="w-10 h-10 shrink-0 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center">{(e.name || '?').charAt(0)}</span>}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">{showEmployee ? e.name : outingLabel(pass.outing_type)}</span>
              <StageBadge pass={pass} />
            </span>
            {showEmployee && <span className="block text-xs text-gray-500 truncate">{[e.code, e.designation, e.department].filter(Boolean).join(' · ')}</span>}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
              {showEmployee && <span className="text-xs rounded border px-1.5 py-0.5 text-gray-600 dark:text-gray-300 dark:border-gray-700">{outingLabel(pass.outing_type)}</span>}
              <Route pass={pass} />
            </span>
            {pass.reason && <span className="block text-xs text-gray-500 truncate mt-0.5">{pass.reason}</span>}
            <span className="flex flex-wrap gap-x-3 text-xs text-gray-500 mt-1">
              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(passDay(pass), 'dd MMM yyyy')}</span>
              {pass.departure_time && <span className="inline-flex items-center gap-1 text-orange-700"><LogOut className="w-3 h-3" />Out {safeTime(pass.departure_time)}</span>}
              {pass.arrival_time && <span className="inline-flex items-center gap-1 text-emerald-700"><LogIn className="w-3 h-3" />Arrived {safeTime(pass.arrival_time)}</span>}
              {pass.return_time && <span className="inline-flex items-center gap-1 text-emerald-700"><LogIn className="w-3 h-3" />In {safeTime(pass.return_time)}</span>}
              {!pass.arrival_time && pass.expected_arrival_time && <span>Expected {safeDate(pass.expected_arrival_time, 'hh:mm a')}</span>}
              {pass.overdue_notified_at && pass.status === 'departed' && <span className="text-red-600 font-medium">Arrival not confirmed</span>}
            </span>
          </span>
        </button>
        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          {actions}
          <Button size="icon" variant="ghost" className="ml-auto" onClick={() => onOpen(pass)} aria-label="View details"><ChevronRight className="w-4 h-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
