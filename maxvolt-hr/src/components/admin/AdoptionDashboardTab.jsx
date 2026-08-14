import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import {
  Users, UserCheck, Activity, TrendingUp, Clock, AlertTriangle,
  RefreshCw, Send, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

// Suggested management targets from "MaxVolt One — Go-Live Marketing,
// Employee Adoption & Engagement Plan" (section 11). Not contractual
// figures — a reference the dashboard checks live numbers against.
const TARGETS = [
  { key: 'activation_pct',   label: 'Employee activation',           target: 95, unit: '%', note: '≥95% of eligible employees' },
  { key: 'active_7d_pct',    label: '7-day active rate',              target: 80, unit: '%', note: '≥80% of activated employees' },
  { key: 'active_30d_pct',   label: 'Monthly active rate',            target: 90, unit: '%', note: '≥90% of activated employees' },
  { key: 'dormant_pct',      label: 'Dormant user rate',              target: 10, unit: '%', note: '<10% of activated employees', lowerIsBetter: true },
];

function StatCard({ icon: Icon, label, value, sub, color = 'text-blue-600' }) {
  return (
    <div className="bg-card border rounded-xl p-4 flex items-center gap-3">
      <Icon className={`w-8 h-8 ${color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-2xl font-bold truncate">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70">{sub}</p>}
      </div>
    </div>
  );
}

export default function AdoptionDashboardTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.functions.invoke('getAdoptionDashboard', { days: 30 });
      const d = r?.data || r;
      if (d.success) setData(d);
      else toast.error(d.error || 'Failed to load adoption dashboard');
    } catch (e) {
      toast.error('Failed to load adoption dashboard: ' + e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const dormantPct = useMemo(() => {
    if (!data) return 0;
    return data.summary.activated ? Math.round((data.summary.dormant_count / data.summary.activated) * 100) : 0;
  }, [data]);

  const targetValues = useMemo(() => {
    if (!data) return {};
    return {
      activation_pct: data.summary.activation_pct,
      active_7d_pct: data.summary.active_7d_pct,
      active_30d_pct: data.summary.active_30d_pct,
      dormant_pct: dormantPct,
    };
  }, [data, dormantPct]);

  const toggleSelect = (userId) => {
    setSelected(prev => { const n = new Set(prev); n.has(userId) ? n.delete(userId) : n.add(userId); return n; });
  };
  const selectAllDormant = () => {
    if (!data) return;
    const allIds = data.dormant_watchlist.map(d => d.user_id);
    setSelected(new Set(selected.size === allIds.length ? [] : allIds));
  };

  const sendReminders = async () => {
    if (!selected.size) return;
    setSending(true);
    try {
      const r = await base44.functions.invoke('sendAdoptionReminder', { user_ids: [...selected] });
      const d = r?.data || r;
      if (d.success) { toast.success(`Reminder sent to ${d.sent} of ${d.total} employee(s)`); setSelected(new Set()); }
      else toast.error(d.error || 'Failed to send reminders');
    } catch (e) { toast.error('Failed to send reminders: ' + e.message); }
    setSending(false);
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading adoption dashboard...</div>;
  }
  if (!data) return null;

  const s = data.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Login, activation and feature-usage analytics — owned per the Go-Live Adoption Plan. Last 30 days.
        </p>
        <button onClick={load} className="p-1.5 rounded border hover:bg-muted"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {/* Executive Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={Users} label="Total Employees" value={s.total_employees} color="text-blue-600" />
        <StatCard icon={UserCheck} label="Activated" value={`${s.activated} (${s.activation_pct}%)`} color="text-emerald-600" />
        <StatCard icon={Activity} label="Active Today" value={s.active_today} color="text-violet-600" />
        <StatCard icon={TrendingUp} label="7-Day Active" value={`${s.active_7d} (${s.active_7d_pct}%)`} color="text-indigo-600" />
        <StatCard icon={Clock} label="Avg. Time / User" value={`${s.avg_minutes_per_active_user}m`} sub="estimated, last 30 days" color="text-amber-600" />
        <StatCard icon={AlertTriangle} label="Dormant Users" value={s.dormant_count} sub="14+ days inactive" color="text-red-600" />
      </div>

      {/* Targets vs Actual */}
      <div className="border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">Adoption Targets</div>
        <div className="divide-y">
          {TARGETS.map(t => {
            const actual = targetValues[t.key] ?? 0;
            const met = t.lowerIsBetter ? actual <= t.target : actual >= t.target;
            return (
              <div key={t.key} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.note}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">{actual}{t.unit}</span>
                  <span className="text-xs text-muted-foreground">target {t.lowerIsBetter ? '<' : '≥'}{t.target}{t.unit}</span>
                  {met ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <XCircle className="w-5 h-5 text-red-500" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Department Adoption */}
        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">Department Adoption</div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-right">Eligible</th>
                  <th className="px-3 py-2 text-right">Activated</th>
                  <th className="px-3 py-2 text-right">7d Active</th>
                  <th className="px-3 py-2 text-right">Dormant</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.department_adoption.map(d => (
                  <tr key={d.department}>
                    <td className="px-3 py-2 font-medium">{d.department}</td>
                    <td className="px-3 py-2 text-right">{d.eligible}</td>
                    <td className="px-3 py-2 text-right">{d.activated} <span className="text-muted-foreground">({d.activation_pct}%)</span></td>
                    <td className="px-3 py-2 text-right">{d.active7d} <span className="text-muted-foreground">({d.active_pct}%)</span></td>
                    <td className="px-3 py-2 text-right">{d.dormant > 0 ? <span className="text-red-600 font-medium">{d.dormant}</span> : 0}</td>
                  </tr>
                ))}
                {!data.department_adoption.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No data yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Feature Adoption */}
        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">Feature / Module Adoption</div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Module</th>
                  <th className="px-3 py-2 text-right">Unique Users</th>
                  <th className="px-3 py-2 text-right">Total Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.feature_adoption.map(f => (
                  <tr key={f.module}>
                    <td className="px-3 py-2 font-medium">{f.module}</td>
                    <td className="px-3 py-2 text-right">{f.unique_users}</td>
                    <td className="px-3 py-2 text-right">{f.actions}</td>
                  </tr>
                ))}
                {!data.feature_adoption.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No usage recorded yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Dormant User Watchlist */}
      <div className="border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold">Inactive User Watchlist ({data.dormant_watchlist.length})</span>
          <div className="flex items-center gap-2">
            <button onClick={selectAllDormant} className="text-xs px-2 py-1 rounded border hover:bg-muted">
              {selected.size === data.dormant_watchlist.length && data.dormant_watchlist.length > 0 ? 'Deselect all' : 'Select all'}
            </button>
            <button
              onClick={sendReminders}
              disabled={!selected.size || sending}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-40 flex items-center gap-1.5"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Reminder ({selected.size})
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-muted-foreground uppercase sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Employee Code</th>
                <th className="px-3 py-2 text-right">Days Inactive</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.dormant_watchlist.map(d => (
                <tr key={d.user_id} className="hover:bg-muted/20">
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(d.user_id)} onChange={() => toggleSelect(d.user_id)} /></td>
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2">{d.department}</td>
                  <td className="px-3 py-2">{d.employee_code}</td>
                  <td className="px-3 py-2 text-right text-red-600 font-medium">{d.days_inactive}</td>
                </tr>
              ))}
              {!data.dormant_watchlist.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No dormant users — great adoption!</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Not Yet Activated */}
      {data.not_activated.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-sm font-semibold">Never Logged In ({data.not_activated.length})</div>
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground uppercase sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-left">Employee Code</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.not_activated.map(d => (
                  <tr key={d.user_id}>
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2">{d.department}</td>
                    <td className="px-3 py-2">{d.employee_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
