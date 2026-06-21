import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MobileSelect from '@/components/MobileSelect';
import {
  AlertTriangle, TrendingUp, Users, ShieldAlert, Search, Filter,
  Sparkles, RefreshCw, ChevronRight, Activity
} from 'lucide-react';
import { toast } from 'sonner';

const BAND_STYLES = {
  High:   { bar: 'bg-red-500',    chip: 'bg-red-100 text-red-700 border-red-200',       ring: 'text-red-600' },
  Medium: { bar: 'bg-amber-500',  chip: 'bg-amber-100 text-amber-700 border-amber-200', ring: 'text-amber-600' },
  Low:    { bar: 'bg-emerald-500',chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', ring: 'text-emerald-600' },
};

const SEV_DOT = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-gray-400' };

export default function AttritionRisk() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ total: 0, high: 0, medium: 0, low: 0 });
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [departments, setDepartments] = useState([]);

  const [planFor, setPlanFor] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getAttritionRisk', {});
      const data = res.data || res;
      if (data.success) {
        setSummary(data.summary || {});
        setRows(data.employees || []);
        setDepartments([...new Set((data.employees || []).map(e => e.department).filter(Boolean))]);
      } else {
        toast.error(data.error || 'Failed to compute attrition risk');
      }
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setLoading(false);
  };

  const generatePlan = async (row) => {
    setPlanFor(row);
    setPlan(null);
    setPlanLoading(true);
    try {
      const res = await base44.functions.invoke('getRetentionPlan', {
        user_id: row.user_id,
        risk_score: row.risk_score,
        risk_band: row.risk_band,
        tenure_months: row.tenure_months,
        factors: row.factors,
      });
      const data = res.data || res;
      if (data.success) setPlan(data.plan);
      else toast.error(data.error || 'AI could not generate a plan');
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
    setPlanLoading(false);
  };

  const filtered = rows.filter(r => {
    if (bandFilter !== 'all' && r.risk_band !== bandFilter) return false;
    if (deptFilter !== 'all' && r.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name?.toLowerCase().includes(q) && !r.employee_code?.toLowerCase().includes(q) && !r.department?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-red-500" /> Attrition Risk Intelligence
          </h1>
          <p className="text-gray-500 text-sm mt-1">Predictive flight-risk scoring across the active workforce, with AI retention plans.</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Recompute
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} color="blue" label="Employees analysed" value={summary.total || 0} />
        <StatCard icon={AlertTriangle} color="red" label="High risk" value={summary.high || 0} />
        <StatCard icon={Activity} color="amber" label="Medium risk" value={summary.medium || 0} />
        <StatCard icon={TrendingUp} color="emerald" label="Low risk" value={summary.low || 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search name, code, department…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <MobileSelect value={bandFilter} onValueChange={setBandFilter} label="Risk band" className="w-36"
            options={[{ value: 'all', label: 'All bands' }, { value: 'High', label: 'High' }, { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }]} />
        </div>
        {departments.length > 0 && (
          <MobileSelect value={deptFilter} onValueChange={setDeptFilter} label="Department" className="w-44"
            options={[{ value: 'all', label: 'All departments' }, ...departments.map(d => ({ value: d, label: d }))]} />
        )}
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} shown</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" /> Crunching workforce signals…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <ShieldAlert className="w-10 h-10 mx-auto mb-2 text-gray-300" /> No employees match the current filters.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(row => {
            const style = BAND_STYLES[row.risk_band] || BAND_STYLES.Low;
            return (
              <Card key={row.user_id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Score ring */}
                    <div className="flex flex-col items-center justify-center w-16 flex-shrink-0">
                      <span className={`text-2xl font-extrabold ${style.ring}`}>{row.risk_score}</span>
                      <Badge variant="outline" className={`text-[10px] mt-1 ${style.chip}`}>{row.risk_band}</Badge>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-800 truncate">{row.name}</p>
                        {row.employee_code && <span className="text-xs text-gray-400">{row.employee_code}</span>}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">
                        {row.designation || '—'} · {row.department || '—'}
                        {row.tenure_months != null && ` · ${row.tenure_months} mo tenure`}
                      </p>
                      {/* Risk bar */}
                      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden mb-2">
                        <div className={`h-full ${style.bar} rounded-full`} style={{ width: `${row.risk_score}%` }} />
                      </div>
                      {/* Top factors */}
                      <div className="flex flex-wrap gap-1.5">
                        {row.factors.slice(0, 4).map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 text-gray-600">
                            <span className={`w-1.5 h-1.5 rounded-full ${SEV_DOT[f.severity] || 'bg-gray-400'}`} />
                            {f.label}
                          </span>
                        ))}
                        {row.factors.length === 0 && <span className="text-[11px] text-gray-400">No elevated risk signals</span>}
                      </div>
                    </div>

                    {/* Action */}
                    <Button size="sm" variant="outline" className="flex-shrink-0 border-orange-300 text-orange-600 hover:bg-orange-50"
                      onClick={() => generatePlan(row)}>
                      <Sparkles className="w-3.5 h-3.5 mr-1" /> Retention plan
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Retention plan dialog */}
      <Dialog open={!!planFor} onOpenChange={() => { setPlanFor(null); setPlan(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-orange-500" /> AI Retention Plan — {planFor?.name}
            </DialogTitle>
          </DialogHeader>
          {planLoading ? (
            <div className="py-12 text-center text-gray-400">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" /> Generating plan…
            </div>
          ) : plan ? (
            <div className="space-y-4 text-sm">
              <p className="text-gray-700 bg-orange-50 border border-orange-100 rounded-lg p-3">{plan.summary}</p>
              <PlanSection title="Immediate actions (this week)" items={plan.immediate_actions} color="red" />
              <PlanSection title="Medium-term actions (1–3 months)" items={plan.medium_term_actions} color="amber" />
              <PlanSection title="1:1 talking points" items={plan.talking_points} color="blue" />
              <PlanSection title="Retention levers" items={plan.retention_levers} color="emerald" />
            </div>
          ) : (
            <div className="py-10 text-center text-gray-400">No plan available.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ icon: Icon, color, label, value }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600', red: 'bg-red-100 text-red-600',
    amber: 'bg-amber-100 text-amber-600', emerald: 'bg-emerald-100 text-emerald-600',
  };
  return (
    <Card>
      <CardContent className="pt-5 flex items-center gap-4">
        <div className={`p-3 rounded-full ${colors[color]}`}><Icon className="w-6 h-6" /></div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanSection({ title, items, color }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const dot = { red: 'bg-red-400', amber: 'bg-amber-400', blue: 'bg-blue-400', emerald: 'bg-emerald-400' }[color];
  return (
    <div>
      <p className="font-semibold text-gray-800 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-gray-600">
            <span className={`w-1.5 h-1.5 rounded-full ${dot} mt-1.5 flex-shrink-0`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
