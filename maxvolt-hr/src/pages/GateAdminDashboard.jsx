import React, { useState } from 'react';
import { format } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { ShieldCheck, Plane, ListChecks, ArrowRight, LogOut } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useGateBoard, usePassFilters, SummaryCards, FilterBar, PassCard, Empty, Loading, isTravel } from '@/components/gatepass/gpShared';
import { ActionButton, ConfirmAction, actionsFor } from '@/components/gatepass/GatePassActions';
import GatePassDetail from '@/components/gatepass/GatePassDetail';

const GATE_KEYS = ['gate_out', 'gate_in', 'arrive'];
const elapsed = (from, now) => { const m = Math.max(0, Math.round((new Date(now) - new Date(from)) / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };

export default function GateAdminDashboard() {
  const { board, error, refreshing, reload } = useGateBoard();
  const passes = board?.passes || [];
  const mine = board?.my_offices ?? null;   // null = not restricted to particular offices
  const filters = usePassFilters(passes);
  const [tab, setTab] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [request, setRequest] = useState(null);

  // Travel on its way here. "Here" = the offices this gate admin is assigned to.
  const incoming = passes.filter((p) => isTravel(p) && p.status === 'departed' && (mine === null || mine.includes(p.destination_location)))
    .sort((a, b) => String(a.departure_time).localeCompare(String(b.departure_time)));
  const waiting = passes.filter((p) => actionsFor(p, ['gate_out', 'gate_in']).length)
    .sort((a, b) => String(b.requested_at || b.created_date).localeCompare(String(a.requested_at || a.created_date)));
  const view = tab || (incoming.length ? 'incoming' : 'gate');
  const buttons = (p) => actionsFor(p, GATE_KEYS).map((k) => <ActionButton key={k} action={k} className="flex-1 sm:flex-none" onClick={() => setRequest({ action: k, pass: p })} />);

  const TABS = [
    { key: 'incoming', label: 'Incoming Employees', icon: Plane, count: incoming.length },
    { key: 'gate', label: 'At My Gate', icon: LogOut, count: waiting.length },
    { key: 'all', label: 'All Gate Passes', icon: ListChecks },
  ];

  return (
    <div className="min-h-screen p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-600 rounded-xl"><ShieldCheck className="w-6 h-6 text-white" /></div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">Gate Admin Dashboard</h1>
          <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, dd MMMM yyyy')}{board && ` · ${mine === null ? 'All offices' : mine.join(', ') || 'No office assigned'}`}</p>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error} <button className="underline" onClick={reload}>Try again</button></p>}
      {!board ? !error && <Loading /> : <>
        <SummaryCards passes={passes} active={view === 'all' ? filters.f.group : ''} onPick={(g) => { filters.set({ group: g }); setTab('all'); }} />

        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${view === t.key ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <t.icon className="w-4 h-4" />{t.label}
              {t.count > 0 && <span className={`px-1.5 rounded-full text-xs ${view === t.key ? 'bg-white text-blue-700' : 'bg-blue-100 text-blue-700'}`}>{t.count}</span>}
            </button>
          ))}
        </div>

        {view === 'incoming' && (incoming.length === 0 ? <Empty icon={Plane} title="Nobody is travelling to your office right now" hint="You are notified when an employee is marked Out for your location." /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {incoming.map((p) => (
              <Card key={p.id} className="border-l-4 border-l-indigo-500">
                <CardContent className="p-4 space-y-3">
                  <button type="button" className="w-full text-left" onClick={() => setOpenId(p.id)}>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{p.employee.name} <span className="text-xs font-normal text-gray-500">{p.employee.code}</span></p>
                    <p className="text-xs text-gray-500">{[p.employee.designation, p.employee.department].filter(Boolean).join(' · ')}</p>
                    <p className="flex items-center gap-1.5 text-sm font-medium text-indigo-700 dark:text-indigo-300 mt-2">{p.current_location}<ArrowRight className="w-4 h-4" />{p.destination_location}</p>
                    <dl className="grid grid-cols-3 gap-2 mt-2 text-xs">
                      <div><dt className="text-gray-500">Departed</dt><dd className="font-medium">{safeTime(p.departure_time)}<span className="block font-normal text-gray-400">{safeDate(p.departure_time, 'dd MMM')}</span></dd></div>
                      <div><dt className="text-gray-500">Expected</dt><dd className="font-medium">{p.expected_arrival_time ? safeDate(p.expected_arrival_time, 'hh:mm a') : '—'}</dd></div>
                      <div><dt className="text-gray-500">Travelling for</dt><dd className={`font-medium ${p.overdue_notified_at ? 'text-red-600' : ''}`}>{elapsed(p.departure_time, board.now)}</dd></div>
                    </dl>
                    <p className="text-xs text-gray-400 mt-1">{p.pass_no} · In Transit{p.reason ? ` · ${p.reason}` : ''}</p>
                  </button>
                  {p.can.arrive ? <ActionButton action="arrive" size="default" className="w-full" onClick={() => setRequest({ action: 'arrive', pass: p })} />
                    : <p className="text-xs text-gray-500">Only a Gate Admin of {p.destination_location} can mark the arrival.</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

        {view === 'gate' && (waiting.length === 0 ? <Empty title="No one is waiting at your gate" hint="Approved passes to mark Out, and employees to mark back In, appear here." /> : (
          <div className="space-y-3">{waiting.map((p) => <PassCard key={p.id} pass={p} onOpen={(x) => setOpenId(x.id)} actions={buttons(p)} />)}</div>
        ))}

        {view === 'all' && <div className="space-y-3">
          <FilterBar filters={filters} passes={passes} onRefresh={reload} refreshing={refreshing} />
          {filters.rows.length === 0 ? <Empty hint="Try another tab or clear the filters." /> : filters.rows.slice(0, 200).map((p) => <PassCard key={p.id} pass={p} onOpen={(x) => setOpenId(x.id)} actions={buttons(p)} />)}
          {filters.rows.length > 200 && <p className="text-xs text-center text-gray-400">Showing the first 200 of {filters.rows.length}. Narrow the filters to see the rest.</p>}
          <p className="text-xs text-gray-400 text-center">Open passes, and passes raised since {safeDate(board.since, 'dd MMM yyyy')}. Updates every 30 seconds.</p>
        </div>}
      </>}

      <ConfirmAction request={request} offices={board?.offices} onClose={() => setRequest(null)} onDone={reload} />
      <GatePassDetail passId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
    </div>
  );
}
