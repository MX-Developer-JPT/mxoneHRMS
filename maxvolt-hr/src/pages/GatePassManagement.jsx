import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import GatePassHistory from '@/components/gatepass/GatePassHistory';
import { History, Download, Loader2, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { SummaryCards, FilterBar, PassCard, Empty, Loading, usePassFilters, OUTING_LABELS } from '@/components/gatepass/gpShared';
import GatePassDetail from '@/components/gatepass/GatePassDetail';
import { safeDate } from '@/lib/dateUtils';
import { requestedAt } from '@/components/gatepass/GatePassTimeline';
import { toast } from 'sonner';

const STATUS_LABELS = {
  pending_approval: 'Pending Approval', approved: 'Approved', rejected: 'Rejected', departed: 'Out / In Transit',
  returned: 'Returned', completed: 'Completed', auto_closed: 'Auto-Closed', cancelled: 'Cancelled',
};
const MONTH_KEYS = ['pending_approval', 'approved', 'departed', 'returned', 'completed', 'rejected', 'cancelled'];

const OUTING_TYPE_LABELS = OUTING_LABELS;

// The calendar day (India time, yyyy-MM-dd) a pass was raised on.
const dayOf = (d) => { const t = d ? new Date(d).getTime() : NaN; return Number.isNaN(t) ? '' : new Date(t + 5.5 * 3600000).toISOString().slice(0, 10); };
const todayIST = () => dayOf(Date.now());
const shiftDay = (day, delta) => { const t = new Date(day + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
const dayLabel = (day) => {
  if (!day) return 'Unknown date';
  const t = todayIST();
  const name = new Date(day + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return day === t ? `Today · ${name}` : day === shiftDay(t, -1) ? `Yesterday · ${name}` : name;
};

const monthOf = (d) => dayOf(d).slice(0, 7);
const monthLabel = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const lastDayOf = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };

export default function GatePassManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const [passes, setPasses] = useState([]);
  const [users, setUsers] = useState({});
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [activeTab, setActiveTab] = useState('live');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState('day'); // 'day' = one day at a time (default) · 'all' = every pass, grouped by day
  const [day, setDay] = useState(todayIST());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [me, allPasses, allUsers, allEmployees] = await Promise.all([
      base44.auth.me(),
      base44.entities.GatePass.list('-created_date'),   // every pass, no cap
      base44.entities.User.list(),
      base44.entities.Employee.list(),
    ]);
    setCurrentUser(me);
    const userMap = {};
    allUsers.forEach(u => { userMap[u.id] = u; });
    const empMap = {};
    allEmployees.forEach(e => { empMap[e.user_id] = e; });
    setUsers(userMap);
    setEmployees(empMap);
    setPasses(allPasses);
    setLoading(false);
  };

  // HR/admin may approve any employee's pass; the detail view offers whatever the server allows.
  const isHR = !!currentUser && ['hr', 'admin'].includes(currentUser.custom_role || currentUser.role);

  const enriched = useMemo(() => passes.map(p => {
    const emp = employees[p.employee_user_id];
    return { ...p, employee: { name: emp?.display_name || users[p.employee_user_id]?.full_name || 'Unknown', code: emp?.employee_code || '', department: emp?.department || '', designation: emp?.designation || '' } };
  }), [passes, users, employees]);
  const inPeriod = (p) => { const pd = dayOf(p.created_date); return view === 'day' ? pd === day : view === 'month' ? true : (!dateFrom || pd >= dateFrom) && (!dateTo || pd <= dateTo); };
  const scope = enriched.filter(inPeriod);
  const filters = usePassFilters(scope);
  const filtered = filters.rows;

  // people still out, or requests still waiting, from days other than the one being viewed
  const elsewhere = view === 'day' ? passes.filter(p => dayOf(p.created_date) !== day && ['pending_approval', 'departed'].includes(p.status)) : [];

  // one row per calendar month, counting every pass raised in it (not affected by the search / status filters)
  const months = [];
  { const byMonth = new Map();
    for (const p of passes) { const m = monthOf(p.created_date) || 'unknown'; if (!byMonth.has(m)) byMonth.set(m, { month: m, total: 0 }); const row = byMonth.get(m); row.total++; row[p.status] = (row[p.status] || 0) + 1; }
    months.push(...[...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month))); }

  // "All days": the same list, under a heading per day (newest first)
  const groups = [];
  if (view === 'all') { const byDay = new Map(); for (const p of filtered) { const d = dayOf(p.created_date); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(p); }
    groups.push(...[...byDay].sort((a, b) => (filters.f.sort === 'oldest' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]))).map(([d, items]) => ({ day: d, items }))); }

  // HR/admin only (isHR, checked at the call site) — exports exactly the
  // passes currently visible under the Live View filters/search/date range,
  // so what's on screen is what lands in the file. Every field on the
  // GatePass record is included, not just what's shown in the UI cards.
  const handleExport = async () => {
    setExporting(true);
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default || ExcelJSModule;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Gate Passes');
      ws.columns = [
        { header: 'Employee Name', key: 'name', width: 24 },
        { header: 'Employee Code', key: 'code', width: 14 },
        { header: 'Department', key: 'dept', width: 18 },
        { header: 'Designation', key: 'desig', width: 20 },
        { header: 'Outing Type', key: 'outingType', width: 22 },
        { header: 'Reason', key: 'reason', width: 28 },
        { header: 'Departed From (Office)', key: 'currentLocation', width: 20 },
        { header: 'Destination', key: 'destination', width: 20 },
        { header: 'Vehicle Type', key: 'vehicle', width: 14 },
        { header: 'Requested On', key: 'requestedOn', width: 20 },
        { header: 'Expected Return', key: 'expectedReturn', width: 20 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Manager/HR Decision', key: 'decision', width: 18 },
        { header: 'Decided By', key: 'decidedBy', width: 20 },
        { header: 'Decision Date', key: 'decisionDate', width: 20 },
        { header: 'Decision Comment', key: 'decisionComment', width: 26 },
        { header: 'Departure Time', key: 'departureTime', width: 20 },
        { header: 'Return Time', key: 'returnTime', width: 20 },
        { header: 'Arrival Time (Destination)', key: 'arrivalTime', width: 22 },
        { header: 'Marked Out By', key: 'outBy', width: 20 },
        { header: 'Arrival Marked By', key: 'arrivedBy', width: 20 },
        { header: 'Pass No', key: 'passNo', width: 18 },
        { header: 'Duration (min)', key: 'duration', width: 14 },
        { header: 'Gate Admin Notes', key: 'gateNotes', width: 26 },
        { header: 'Auto-Closed Reason', key: 'autoClosedReason', width: 26 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const fmt = d => (d ? safeDate(d, 'dd MMM yyyy, hh:mm a') : '');
      for (const p of filtered) {
        const u = users[p.employee_user_id];
        const emp = employees[p.employee_user_id];
        const decidedBy = employees[p.manager_user_id]?.display_name || users[p.manager_user_id]?.full_name || '';
        ws.addRow({
          name: emp?.display_name || u?.full_name || '',
          code: emp?.employee_code || '',
          dept: emp?.department || '',
          desig: emp?.designation || '',
          outingType: OUTING_TYPE_LABELS[p.outing_type] || p.outing_type || '',
          reason: p.reason || '',
          currentLocation: p.current_location || '',
          destination: p.destination_location || '',
          vehicle: p.vehicle_type ? p.vehicle_type.replace(/_/g, ' ') : '',
          requestedOn: fmt(requestedAt(p)),
          expectedReturn: fmt(p.expected_return_time),
          status: STATUS_LABELS[p.status] || p.status || '',
          decision: p.manager_approval_status || '',
          decidedBy,
          decisionDate: fmt(p.manager_approval_date),
          decisionComment: p.manager_comment || '',
          departureTime: fmt(p.departure_time),
          returnTime: fmt(p.return_time),
          arrivalTime: fmt(p.arrival_time),
          outBy: p.departed_by_name || '',
          arrivedBy: p.arrived_by_name || '',
          passNo: p.pass_no || '',
          duration: (p.departure_time && p.return_time) ? Math.round((new Date(p.return_time) - new Date(p.departure_time)) / 60000) : '',
          gateNotes: p.gate_admin_notes || '',
          autoClosedReason: p.auto_closed_reason || '',
        });
      }
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = view === 'day' ? `Gate_Passes_${day}.xlsx` : `Gate_Passes_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err.message || 'Failed to export gate passes');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="p-6 max-w-5xl mx-auto"><Loading /></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <h1 className="text-2xl font-bold text-gray-900">Gate Pass Management</h1>
        {isHR && activeTab === 'live' && (
          <Button variant="outline" onClick={handleExport} disabled={exporting || !filtered.length}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export to Excel
          </Button>
        )}
      </div>
      <p className="text-gray-500 text-sm mb-5">Track employee gate passes — one day at a time, or all days together</p>

      <div className="mb-6">
        <SummaryCards passes={activeTab === 'live' ? scope : enriched} active={activeTab === 'live' && view !== 'month' ? filters.f.group : ''}
          onPick={(group) => { filters.set({ group }); setActiveTab('live'); if (view === 'month') setView('all'); }} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 border-b pb-2">
        <button
          onClick={() => setActiveTab('live')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'live' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Live View
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          <History className="w-4 h-4" /> Full History
        </button>
      </div>

      {activeTab === 'live' && (
        <>
          {/* Day / all days */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="inline-flex rounded-lg border p-0.5 bg-gray-50">
              {[['day', 'Day-wise'], ['month', 'Month-wise'], ['all', 'All days']].map(([k, label]) => (
                <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === k ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
              ))}
            </div>
            {view === 'day' && (
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></Button>
                <Input type="date" className="w-40 text-sm" value={day} max={todayIST()} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Pick a day" />
                <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= todayIST()} aria-label="Next day"><ChevronRight className="w-4 h-4" /></Button>
                {day !== todayIST() && <Button size="sm" variant="ghost" onClick={() => setDay(todayIST())}>Today</Button>}
              </div>
            )}
            {view === 'day' && <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><CalendarDays className="w-4 h-4 text-blue-600" />{dayLabel(day)}</span>}
          </div>
          {view === 'month' && (
            <Card className="mb-5"><CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Month</th>
                  <th className="px-3 py-2.5 font-medium text-center">Total passes</th>
                  {MONTH_KEYS.map(k => <th key={k} className="px-3 py-2.5 font-medium text-center">{STATUS_LABELS[k]}</th>)}
                </tr></thead>
                <tbody>
                  {months.map(m => (
                    <tr key={m.month} className="border-t hover:bg-blue-50/40 cursor-pointer" onClick={() => { if (m.month === 'unknown') return; setDateFrom(`${m.month}-01`); setDateTo(lastDayOf(m.month)); filters.set({ group: 'all' }); setView('all'); }}>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{m.month === 'unknown' ? 'No date' : monthLabel(m.month)}</td>
                      <td className="px-3 py-2.5 text-center text-base font-bold text-blue-700 tabular-nums">{m.total}</td>
                      {MONTH_KEYS.map(k => <td key={k} className="px-3 py-2.5 text-center tabular-nums text-gray-600">{m[k] || <span className="text-gray-300">0</span>}</td>)}
                    </tr>
                  ))}
                  {months.length === 0 && <tr><td colSpan={9} className="text-center py-10 text-gray-400">No gate passes yet.</td></tr>}
                </tbody>
                {months.length > 0 && <tfoot><tr className="border-t-2 bg-gray-50 font-semibold"><td className="px-4 py-2.5">All months</td><td className="px-3 py-2.5 text-center text-base text-blue-700 tabular-nums">{passes.length}</td>
                  {MONTH_KEYS.map(k => <td key={k} className="px-3 py-2.5 text-center tabular-nums">{months.reduce((n, m) => n + (m[k] || 0), 0)}</td>)}</tr></tfoot>}
              </table>
            </CardContent></Card>
          )}
          {view === 'month' && <p className="text-xs text-gray-400 mb-4 -mt-2">Click a month to see its passes day by day.</p>}
          {elsewhere.length > 0 && (
            <button onClick={() => setView('all')} className="w-full text-left mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 hover:bg-yellow-100">
              {elsewhere.filter(p => p.status === 'pending_approval').length > 0 && <>{elsewhere.filter(p => p.status === 'pending_approval').length} request(s) from other days still waiting for approval. </>}
              {elsewhere.filter(p => p.status === 'departed').length > 0 && <>{elsewhere.filter(p => p.status === 'departed').length} employee(s) from other days have not been marked back. </>}
              <span className="underline">View all days</span>
            </button>
          )}

          {view !== 'month' && <div className="mb-5"><FilterBar filters={filters} passes={scope} onRefresh={loadData} /></div>}
          {view === 'all' && <div className="flex flex-wrap gap-2 items-center mb-4 text-sm text-gray-500">
            Period
            <Input type="date" className="w-36 text-sm" aria-label="Period from" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            –
            <Input type="date" className="w-36 text-sm" aria-label="Period to" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            {(dateFrom || dateTo) && <Button size="sm" variant="ghost" onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear</Button>}
          </div>}

          {view !== 'month' && <div className="space-y-2">
            {filtered.length === 0 && <Empty title={view === 'day' && !filters.dirty && filters.f.group === 'all' ? `No gate passes on ${dayLabel(day).replace(/^(Today|Yesterday) · /, '')}` : 'No gate passes found'} />}
            {(view === 'day' ? [{ day: null, items: filtered }] : groups).map((g, i) => (
              <React.Fragment key={g.day || `g${i}`}>
                {g.day !== null && <div className="flex items-center gap-2 pt-3 pb-1"><CalendarDays className="w-4 h-4 text-blue-600" /><h3 className="text-sm font-semibold text-gray-700">{dayLabel(g.day)}</h3><span className="text-xs text-gray-400">{g.items.length} pass{g.items.length === 1 ? '' : 'es'}</span><button className="ml-auto text-xs text-blue-600 hover:underline" onClick={() => { setDay(g.day); setView('day'); }}>Open this day</button></div>}
                {g.items.map(pass => <PassCard key={pass.id} pass={pass} onOpen={(x) => setOpenId(x.id)} />)}
              </React.Fragment>
            ))}
          </div>}
        </>
      )}

      {activeTab === 'history' && (
        <GatePassHistory showEmployeeName={true} />
      )}

      <GatePassDetail passId={openId} onClose={() => setOpenId(null)} onChanged={loadData} />
    </div>
  );
}
