import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { format, isToday } from 'date-fns';
import { safeDate, safeTime } from '@/lib/dateUtils';
import {
  LogOut, LogIn, User, Clock, CheckCircle2, ShieldCheck,
  Search, Calendar, ArrowRightLeft, History
} from 'lucide-react';

const STATUS_COLORS = {
  approved: 'bg-blue-100 text-blue-800',
  departed: 'bg-orange-100 text-orange-800',
  returned: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const STATUS_LABELS = {
  approved: 'Awaiting Departure',
  departed: 'Currently Out',
  returned: 'Returned',
  rejected: 'Rejected',
  pending_approval: 'Pending Approval',
  cancelled: 'Cancelled',
};

const OUTING_LABELS = {
  official_outing: 'Official Outing',
  unofficial_outing: 'Unofficial Outing',
  half_day: 'Half Day',
  short_break: 'Short Break',
  early_leave: 'Early Leave',
};

function calculateLOP(outingType, departureTime, returnTime) {
  // official_outing: no LOP, full day present
  if (outingType === 'official_outing') return { lopDays: 0, status: 'present' };

  // short_break: within 3 hours = no deduction, else half day
  if (outingType === 'short_break') {
    if (!returnTime || !departureTime) return { lopDays: 0.5, status: 'half_day' };
    const durationMs = new Date(returnTime) - new Date(departureTime);
    const durationHrs = durationMs / (1000 * 60 * 60);
    if (durationHrs <= 3) return { lopDays: 0, status: 'present' };
    return { lopDays: 0.5, status: 'half_day' };
  }

  // unofficial_outing, half_day, early_leave: half day LOP
  return { lopDays: 0.5, status: 'half_day' };
}

export default function GateAdminDashboard() {
  const [passes, setPasses] = useState([]);
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [statusFilter, setStatusFilter] = useState(null);
  const [search, setSearch] = useState('');
  const [historyDate, setHistoryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [user, setUser] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [currentUser, allPasses, allEmployees] = await Promise.all([
        base44.auth.me(),
        base44.entities.GatePass.list('-created_date', 500),
        base44.entities.Employee.list(),
      ]);
      const empMap = {};
      allEmployees.forEach(e => { empMap[e.user_id] = e; });
      setUser(currentUser);
      setEmployees(empMap);
      setPasses(allPasses.filter(p => p.status !== 'pending_approval'));
    } catch (e) {
      console.error('GateAdminDashboard loadData:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const markDeparture = async () => {
    setActionLoading(true);
    await base44.entities.GatePass.update(selected.id, {
      departure_time: new Date().toISOString(),
      status: 'departed',
      gate_admin_notes: notes,
    });
    setSelected(null);
    setNotes('');
    await loadData();
    setActionLoading(false);
  };

  const markReturn = async () => {
    setActionLoading(true);
    const now = new Date();
    const nowISO = now.toISOString();
    const todayStr = now.toISOString().split('T')[0];

    // Calculate LOP based on outing type and duration
    const lop = calculateLOP(selected.outing_type, selected.departure_time, nowISO);

    // Update gate pass
    await base44.entities.GatePass.update(selected.id, {
      return_time: nowISO,
      status: 'returned',
      gate_admin_notes: notes,
      lop_deduction_days: lop.lopDays,
    });

    // Update/create attendance record for today
    const existing = await base44.entities.Attendance.filter({ user_id: selected.employee_user_id, date: todayStr });
    if (existing.length > 0) {
      await base44.entities.Attendance.update(existing[0].id, {
        status: lop.status,
        lop_applicable: lop.lopDays > 0,
        lop_deduction_days: lop.lopDays,
        notes: `Gate pass: ${OUTING_LABELS[selected.outing_type] || selected.outing_type} — ${lop.lopDays > 0 ? 'LOP deducted' : 'No LOP'}`,
      });
    } else {
      await base44.entities.Attendance.create({
        user_id: selected.employee_user_id,
        date: todayStr,
        status: lop.status,
        lop_applicable: lop.lopDays > 0,
        lop_deduction_days: lop.lopDays,
        notes: `Gate pass: ${OUTING_LABELS[selected.outing_type] || selected.outing_type} — ${lop.lopDays > 0 ? 'LOP deducted' : 'No LOP'}`,
        auto_marked: true,
      });
    }

    setSelected(null);
    setNotes('');
    await loadData();
    setActionLoading(false);
  };

  const activePasses = passes.filter(p => ['approved', 'departed'].includes(p.status));
  const historyPasses = passes.filter(p => {
    const d = p.request_date || p.created_date?.slice(0, 10);
    return d === historyDate;
  });

  const filteredActive = activePasses.filter(p => {
    const emp = employees[p.employee_user_id];
    if (statusFilter && p.status !== statusFilter) return false;
    return !search || emp?.display_name?.toLowerCase().includes(search.toLowerCase());
  });

  const filteredHistory = historyPasses.filter(p => {
    const emp = employees[p.employee_user_id];
    return !search || emp?.display_name?.toLowerCase().includes(search.toLowerCase());
  });

  const awaitingCount = passes.filter(p => p.status === 'approved').length;
  const departedCount = passes.filter(p => p.status === 'departed').length;
  const returnedTodayCount = passes.filter(p => p.status === 'returned' && p.return_time && isToday(new Date(p.return_time))).length;
  const pendingApprovalCount = passes.filter(p => p.status === 'pending_approval').length;

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-600 rounded-xl">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gate Admin Dashboard</h1>
          <p className="text-gray-500 text-sm">{format(new Date(), 'EEEE, dd MMMM yyyy')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Pending Mgr Approval', count: pendingApprovalCount, status: 'pending_approval', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', sub: 'text-yellow-600' },
          { label: 'Awaiting Departure', count: awaitingCount, status: 'approved', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', sub: 'text-blue-600' },
          { label: 'Currently Outside', count: departedCount, status: 'departed', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', sub: 'text-orange-600' },
          { label: 'Returned Today', count: returnedTodayCount, status: 'returned', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', sub: 'text-green-600' },
        ].map(card => (
          <Card key={card.status} className={`${card.bg} ${card.border} cursor-pointer hover:shadow-md transition-all ${statusFilter === card.status ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}
            onClick={() => {
              setStatusFilter(prev => prev === card.status ? null : card.status);
              if (['approved', 'departed'].includes(card.status)) setActiveTab('active');
            }}>
            <CardContent className="p-4 text-center">
              <p className={`text-3xl font-bold ${card.text}`}>{card.count}</p>
              <p className={`text-xs ${card.sub} mt-1`}>{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2 mb-5 border-b pb-2">
        <button onClick={() => setActiveTab('active')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'active' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
          <ArrowRightLeft className="w-4 h-4" /> Active Passes
          {activePasses.length > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs ${activeTab === 'active' ? 'bg-white text-blue-600' : 'bg-blue-100 text-blue-700'}`}>{activePasses.length}</span>}
        </button>
        <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
          <History className="w-4 h-4" /> Gate Pass History
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {activeTab === 'history' && <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-auto" />}
      </div>

      {activeTab === 'active' && (
        <div className="space-y-3">
          {filteredActive.length === 0 && (
            <div className="text-center py-16 text-gray-400"><ArrowRightLeft className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No active gate passes right now.</p></div>
          )}
          {filteredActive.map(pass => {
            const emp = employees[pass.employee_user_id];
            const isOut = pass.status === 'departed';
            return (
              <Card key={pass.id} className={`hover:shadow-md transition-all cursor-pointer border-l-4 ${isOut ? 'border-l-orange-500' : 'border-l-blue-500'}`}
                onClick={() => { setSelected(pass); setNotes(''); }}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${isOut ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                        {emp?.display_name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{emp?.display_name || 'Unknown'}</p>
                        <p className="text-xs text-gray-400">{emp?.designation} · {emp?.department}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {pass.outing_type && <Badge variant="outline" className="text-[10px]">{OUTING_LABELS[pass.outing_type] || pass.outing_type}</Badge>}
                          {pass.reason && <p className="text-xs text-gray-500 max-w-xs truncate">{pass.reason}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="text-right text-xs text-gray-500">
                        <p>Req: {safeTime(pass.created_date)}</p>
                        {pass.expected_return_time && <p>Exp: {safeTime(pass.expected_return_time)}</p>}
                        {pass.departure_time && <p className="text-orange-600 font-medium">Out: {safeTime(pass.departure_time)}</p>}
                      </div>
                      <Badge className={STATUS_COLORS[pass.status]}>{STATUS_LABELS[pass.status]}</Badge>
                      {pass.status === 'approved' && (
                        <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white" onClick={(e) => { e.stopPropagation(); setSelected(pass); setNotes(''); }}>
                          <LogOut className="w-3 h-3 mr-1" /> Mark Out
                        </Button>
                      )}
                      {pass.status === 'departed' && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={(e) => { e.stopPropagation(); setSelected(pass); setNotes(''); }}>
                          <LogIn className="w-3 h-3 mr-1" /> Mark In
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-2">
          {filteredHistory.length === 0 && (
            <div className="text-center py-16 text-gray-400"><History className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>No gate passes for selected date.</p></div>
          )}
          {filteredHistory.map(pass => {
            const emp = employees[pass.employee_user_id];
            return (
              <Card key={pass.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-sm">{emp?.display_name?.charAt(0) || '?'}</div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{emp?.display_name || 'Unknown'}</p>
                        <p className="text-xs text-gray-400">{emp?.designation} · {emp?.department}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {pass.outing_type && <Badge variant="outline" className="text-[10px]">{OUTING_LABELS[pass.outing_type] || pass.outing_type}</Badge>}
                          {pass.reason && <p className="text-xs text-gray-500">{pass.reason}</p>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="text-xs text-gray-500 space-y-0.5">
                        {pass.departure_time && <p className="text-orange-600 flex items-center gap-1"><LogOut className="w-3 h-3" /> Out: {safeTime(pass.departure_time)}</p>}
                        {pass.return_time && <p className="text-green-600 flex items-center gap-1"><LogIn className="w-3 h-3" /> In: {safeTime(pass.return_time)}</p>}
                        {pass.departure_time && pass.return_time && (
                          <p className="text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Duration: {Math.round((new Date(pass.return_time) - new Date(pass.departure_time)) / 60000)} min</p>
                        )}
                        {pass.lop_deduction_days > 0 && <p className="text-red-600 font-medium">LOP: {pass.lop_deduction_days} day(s)</p>}
                      </div>
                      <Badge className={STATUS_COLORS[pass.status]}>{STATUS_LABELS[pass.status]}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setNotes(''); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-blue-600" /> Gate Pass Action</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700">
                    {employees[selected.employee_user_id]?.display_name?.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold">{employees[selected.employee_user_id]?.display_name}</p>
                    <p className="text-xs text-gray-500">{employees[selected.employee_user_id]?.designation} · {employees[selected.employee_user_id]?.department}</p>
                  </div>
                </div>
                {selected.outing_type && <p><span className="font-medium text-gray-600">Type:</span> <Badge variant="outline">{OUTING_LABELS[selected.outing_type] || selected.outing_type}</Badge></p>}
                <p><span className="font-medium text-gray-600">Reason:</span> {selected.reason || '—'}</p>
                <p><span className="font-medium text-gray-600">Requested:</span> {safeDate(selected.created_date, 'dd MMM yyyy, h:mm a')}</p>
                {selected.expected_return_time && <p><span className="font-medium text-gray-600">Expected Return:</span> {safeDate(selected.expected_return_time, 'dd MMM yyyy, h:mm a')}</p>}
                {selected.departure_time && <p className="text-orange-700 font-medium"><LogOut className="w-3.5 h-3.5 inline mr-1" /> Departed At: {safeTime(selected.departure_time)}</p>}
                {selected.return_time && <p className="text-green-700 font-medium"><LogIn className="w-3.5 h-3.5 inline mr-1" /> Returned At: {safeTime(selected.return_time)}</p>}
                {selected.lop_deduction_days > 0 && <p className="text-red-700 font-medium">LOP Deduction: {selected.lop_deduction_days} day(s)</p>}
              </div>

              {(selected.status === 'approved' || selected.status === 'departed') && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add gate notes..." rows={2} />
                </div>
              )}

              <div className="flex gap-3">
                {selected.status === 'approved' && (
                  <Button className="flex-1 bg-orange-600 hover:bg-orange-700" onClick={markDeparture} disabled={actionLoading}>
                    <LogOut className="w-4 h-4 mr-2" />{actionLoading ? 'Recording...' : 'Mark as DEPARTED (Out)'}
                  </Button>
                )}
                {selected.status === 'departed' && (
                  <Button className="flex-1 bg-green-600 hover:bg-green-700" onClick={markReturn} disabled={actionLoading}>
                    <LogIn className="w-4 h-4 mr-2" />{actionLoading ? 'Recording...' : 'Mark as RETURNED (In)'}
                  </Button>
                )}
                {selected.status === 'returned' && (
                  <p className="text-green-700 font-medium flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Employee has returned to office.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}