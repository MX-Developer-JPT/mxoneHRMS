import React, { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, FunnelChart, Funnel, LabelList,
} from 'recharts';
import {
  Loader2, TrendingUp, Users, Briefcase, Target, CheckCircle2, Send,
  Clock, BarChart3, ArrowRight, ArrowDown, AlertTriangle, Star,
  Building2, Filter, Calendar, UserCheck, Zap, Award
} from 'lucide-react';

const STAGE_LABELS = {
  applied:              'Applied',
  screening:            'Screening',
  interview_scheduled:  'Interview Sched.',
  interviewed:          'Interviewed',
  selected:             'Selected',
  offered:              'Offer Sent',
  offer_accepted:       'Offer Accepted',
  joined:               'Joined',
};

const STAGE_COLORS = [
  '#3b82f6','#6366f1','#8b5cf6','#d946ef','#ec4899','#f59e0b','#22c55e','#10b981'
];

const SOURCE_LABELS = {
  job_portal:       'Job Portal',
  referral:         'Referral',
  company_website:  'Company Website',
  linkedin:         'LinkedIn',
  walk_in:          'Walk-in',
  campus:           'Campus',
  headhunter:       'Headhunter',
  other:            'Other',
};

const PIE_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16'];

const PRIORITY_COLORS = { urgent: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-600' };

function KpiCard({ icon: Icon, label, value, sub, color = 'blue', trend }) {
  const bg = { blue:'bg-blue-50', green:'bg-green-50', amber:'bg-amber-50', purple:'bg-purple-50', red:'bg-red-50', teal:'bg-teal-50' };
  const ic = { blue:'text-blue-600', green:'text-green-600', amber:'text-amber-600', purple:'text-purple-600', red:'text-red-600', teal:'text-teal-600' };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-3 rounded-xl flex-shrink-0 ${bg[color]}`}>
          <Icon className={`w-5 h-5 ${ic[color]}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-gray-500 truncate">{label}</p>
          <p className={`text-2xl font-bold ${ic[color]}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }

const CustomFunnelBar = ({ data }) => (
  <div className="space-y-2">
    {data.map((item, i) => {
      const maxCount = data[0]?.count || 1;
      const width = Math.max(10, Math.round(item.count / maxCount * 100));
      return (
        <div key={item.stage} className="flex items-center gap-3">
          <div className="w-28 text-right text-xs text-gray-500 flex-shrink-0">{STAGE_LABELS[item.stage] || item.stage}</div>
          <div className="flex-1 relative">
            <div className="h-8 rounded-md flex items-center px-3" style={{ width: `${width}%`, minWidth: 60, backgroundColor: STAGE_COLORS[i] }}>
              <span className="text-white text-xs font-semibold">{item.count}</span>
            </div>
          </div>
          {i < data.length - 1 && data[i+1] && (
            <div className="w-16 text-xs text-gray-400 flex-shrink-0">
              → {pct(data[i+1].count, item.count)}%
            </div>
          )}
        </div>
      );
    })}
  </div>
);

export default function RecruitmentAnalytics() {
  const [loading, setLoading]   = useState(true);
  const [data, setData]         = useState(null);
  const [days, setDays]         = useState('180');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { loadData(); }, [days]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getRecruitmentMIS', { days: Number(days) });
      setData(result?.data || result);
    } catch (e) {
      toast.error('Failed to load recruitment data');
      setData(null);
    }
    setLoading(false);
  };

  const kpis      = data?.kpis || {};
  const funnel    = data?.stage_funnel || [];
  const sources   = data?.by_source || [];
  const depts     = data?.by_department || [];
  const monthly   = data?.monthly_trend || [];
  const reqHealth = data?.requisition_health || [];
  const convs     = data?.stage_conversions || [];
  const offerBd   = data?.offer_breakdown || {};

  // Chart-ready monthly data
  const monthlyChart = monthly.map(m => ({
    month: m.month?.slice(5),
    Applied: m.applied,
    Selected: m.selected,
    Joined: m.joined,
  }));

  // Source pie data
  const sourcePie = sources.slice(0, 6).map((s, i) => ({
    name: SOURCE_LABELS[s.source] || s.source,
    value: s.applied,
    color: PIE_COLORS[i],
  }));

  const tabs = [
    { id: 'overview',    label: 'Overview',         icon: BarChart3 },
    { id: 'funnel',      label: 'Hiring Funnel',    icon: Filter },
    { id: 'sources',     label: 'Source Analysis',  icon: Zap },
    { id: 'departments', label: 'By Department',    icon: Building2 },
    { id: 'positions',   label: 'Open Positions',   icon: Briefcase },
    { id: 'trends',      label: 'Monthly Trends',   icon: TrendingUp },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <BarChart3 className="w-7 h-7 text-blue-600" />Recruitment MIS
            </h1>
            <p className="text-gray-500 text-sm mt-1">End-to-end hiring analytics — requisition to joining</p>
          </div>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard icon={Briefcase}    label="Open Positions"    value={kpis.open_requisitions ?? '—'}      color="blue" />
          <KpiCard icon={Users}        label="Total Candidates"  value={kpis.total_candidates ?? '—'}       color="purple" />
          <KpiCard icon={Target}       label="In Pipeline"       value={kpis.in_pipeline ?? '—'}            color="amber" />
          <KpiCard icon={Send}         label="Offers Sent"       value={kpis.total_offers ?? '—'}           color="teal" />
          <KpiCard icon={CheckCircle2} label="Offer Accept Rate" value={`${kpis.offer_accept_rate ?? 0}%`}  color="green" />
          <KpiCard icon={UserCheck}    label="Joined"            value={kpis.joined ?? '—'}                 color="green" sub={`${pct(kpis.joined, kpis.total_candidates)}% of applicants`} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>

        {/* ═══ OVERVIEW ═══ */}
        {activeTab === 'overview' && (
          <div className="grid md:grid-cols-2 gap-5">
            {/* Funnel quick view */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Hiring Funnel</CardTitle></CardHeader>
              <CardContent>
                <CustomFunnelBar data={funnel} />
              </CardContent>
            </Card>

            {/* Stage conversion rates */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Stage Conversion Rates</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {convs.map((c, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs w-48 flex-shrink-0">
                        <span className="font-medium text-gray-600">{STAGE_LABELS[c.from] || c.from}</span>
                        <ArrowRight className="w-3 h-3 text-gray-400" />
                        <span className="font-medium text-gray-600">{STAGE_LABELS[c.to] || c.to}</span>
                      </div>
                      <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                        <div className="h-2.5 rounded-full bg-blue-500" style={{ width: `${c.rate}%` }} />
                      </div>
                      <span className={`text-xs font-bold w-10 text-right ${c.rate >= 50 ? 'text-green-600' : c.rate >= 25 ? 'text-amber-600' : 'text-red-600'}`}>{c.rate}%</span>
                    </div>
                  ))}
                  {convs.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No conversion data yet</p>}
                </div>
              </CardContent>
            </Card>

            {/* Offer breakdown */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Offer Outcomes</CardTitle></CardHeader>
              <CardContent>
                {offerBd.offered > 0 ? (
                  <div className="space-y-3">
                    {[
                      { label: 'Accepted', value: offerBd.accepted, color: '#22c55e' },
                      { label: 'Pending', value: offerBd.pending, color: '#f59e0b' },
                      { label: 'Declined', value: offerBd.declined, color: '#ef4444' },
                      { label: 'Joined', value: offerBd.joined, color: '#10b981' },
                    ].map(o => (
                      <div key={o.label} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 w-20">{o.label}</span>
                        <div className="flex-1 bg-gray-100 rounded-full h-3">
                          <div className="h-3 rounded-full" style={{ width: `${pct(o.value, offerBd.offered)}%`, backgroundColor: o.color }} />
                        </div>
                        <span className="text-xs font-bold w-8 text-right">{o.value}</span>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 text-right">Total offers: {offerBd.offered}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No offers data in period</p>
                )}
              </CardContent>
            </Card>

            {/* Source distribution */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Candidate Sources</CardTitle></CardHeader>
              <CardContent>
                {sourcePie.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="50%" height={160}>
                      <PieChart>
                        <Pie data={sourcePie} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value">
                          {sourcePie.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                        </Pie>
                        <Tooltip formatter={(v) => [v, 'Candidates']} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1.5">
                      {sourcePie.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                          <span className="text-gray-600">{s.name}</span>
                          <span className="font-bold text-gray-800 ml-auto">{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-8">No source data</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ FUNNEL ═══ */}
        {activeTab === 'funnel' && (
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>Recruitment Funnel — Cumulative Drop-off</CardTitle></CardHeader>
              <CardContent>
                <div className="py-4">
                  <CustomFunnelBar data={funnel} />
                </div>
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-gray-600">Stage</th>
                        <th className="text-right py-2 text-gray-600">Cumulative</th>
                        <th className="text-right py-2 text-gray-600">At Stage</th>
                        <th className="text-right py-2 text-gray-600">vs Applied</th>
                        <th className="text-right py-2 text-gray-600">vs Prev Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.map((row, i) => {
                        const prevCount = i > 0 ? funnel[i-1].count : row.count;
                        const vsApplied = pct(row.count, funnel[0]?.count || 1);
                        const vsPrev    = pct(row.count, prevCount);
                        return (
                          <tr key={row.stage} className="border-b hover:bg-gray-50">
                            <td className="py-2 font-medium">{STAGE_LABELS[row.stage] || row.stage}</td>
                            <td className="py-2 text-right font-bold" style={{ color: STAGE_COLORS[i] }}>{row.count}</td>
                            <td className="py-2 text-right text-gray-600">{row.at_stage}</td>
                            <td className="py-2 text-right">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${vsApplied >= 50 ? 'bg-green-100 text-green-700' : vsApplied >= 20 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{vsApplied}%</span>
                            </td>
                            <td className="py-2 text-right">
                              {i > 0 && <span className={`text-xs px-2 py-0.5 rounded-full ${vsPrev >= 60 ? 'bg-green-100 text-green-700' : vsPrev >= 30 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{vsPrev}%</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ SOURCES ═══ */}
        {activeTab === 'sources' && (
          <Card>
            <CardHeader><CardTitle>Source Quality Matrix</CardTitle></CardHeader>
            <CardContent>
              {sources.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No source data available</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Source</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Applied</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Screened</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Screen %</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Interviewed</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Selected</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Offered</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Joined</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Join %</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Quality Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sources.map((s, i) => {
                          const joinRate = pct(s.joined, s.applied);
                          const qualityScore = Math.round((pct(s.screened, s.applied) * 0.2) + (pct(s.interviewed, s.applied) * 0.3) + (pct(s.joined, s.applied) * 0.5));
                          return (
                            <tr key={s.source} className="border-b hover:bg-gray-50">
                              <td className="px-3 py-2.5 font-medium">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  {SOURCE_LABELS[s.source] || s.source}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right font-bold text-blue-600">{s.applied}</td>
                              <td className="px-3 py-2.5 text-right">{s.screened}</td>
                              <td className="px-3 py-2.5 text-right text-xs">{pct(s.screened, s.applied)}%</td>
                              <td className="px-3 py-2.5 text-right">{s.interviewed}</td>
                              <td className="px-3 py-2.5 text-right">{s.selected}</td>
                              <td className="px-3 py-2.5 text-right">{s.offered}</td>
                              <td className="px-3 py-2.5 text-right font-medium text-green-700">{s.joined}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${joinRate >= 10 ? 'bg-green-100 text-green-700' : joinRate >= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>{joinRate}%</span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {[1,2,3,4,5].map(star => <Star key={star} className={`w-3 h-3 ${star <= Math.round(qualityScore/20) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'}`} />)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-5">
                    <p className="text-xs text-gray-500 mb-3 font-medium">Source vs Join Quality</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={sources.slice(0, 8).map(s => ({ name: SOURCE_LABELS[s.source] || s.source, Applied: s.applied, Joined: s.joined }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="Applied" fill="#3b82f6" />
                        <Bar dataKey="Joined" fill="#22c55e" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ DEPARTMENTS ═══ */}
        {activeTab === 'departments' && (
          <Card>
            <CardHeader><CardTitle>Department-wise Hiring Pipeline</CardTitle></CardHeader>
            <CardContent>
              {depts.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">No department data</p>
              ) : (
                <>
                  <div className="overflow-x-auto mb-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Department</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Applied</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">In Pipeline</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Selected</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Offered</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Joined</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Rejected</th>
                          <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Hire Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {depts.map(d => {
                          const hireRate = pct(d.joined, d.applied);
                          return (
                            <tr key={d.department} className="border-b hover:bg-gray-50">
                              <td className="px-3 py-2.5 font-medium">{d.department}</td>
                              <td className="px-3 py-2.5 text-right text-blue-600 font-bold">{d.applied}</td>
                              <td className="px-3 py-2.5 text-right">{d.in_progress}</td>
                              <td className="px-3 py-2.5 text-right text-green-600">{d.selected}</td>
                              <td className="px-3 py-2.5 text-right text-teal-600">{d.offered}</td>
                              <td className="px-3 py-2.5 text-right font-semibold text-green-700">{d.joined}</td>
                              <td className="px-3 py-2.5 text-right text-red-600">{d.rejected}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={`text-xs px-1.5 py-0.5 rounded ${hireRate >= 10 ? 'bg-green-100 text-green-700' : hireRate >= 5 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>{hireRate}%</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={depts.slice(0, 10).map(d => ({ name: d.department, Applied: d.applied, Selected: d.selected, Joined: d.joined }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Applied" fill="#3b82f6" />
                      <Bar dataKey="Selected" fill="#22c55e" />
                      <Bar dataKey="Joined" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ OPEN POSITIONS ═══ */}
        {activeTab === 'positions' && (
          <Card>
            <CardHeader><CardTitle>Open Position Health — Requisition Tracker</CardTitle></CardHeader>
            <CardContent>
              {reqHealth.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Briefcase className="w-12 h-12 mx-auto mb-3" />
                  <p>No open positions</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Position</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Dept</th>
                        <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Priority</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Days Open</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Vacancies</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Candidates</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Interviews</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Offers</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-gray-600">Joined</th>
                        <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Aging</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reqHealth.map(r => {
                        const agingColor = r.days_open > 60 ? 'bg-red-100 text-red-700' : r.days_open > 30 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
                        return (
                          <tr key={r.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">{r.position}</td>
                            <td className="px-3 py-2.5 text-gray-600 text-xs">{r.department}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${PRIORITY_COLORS[r.priority] || 'bg-gray-100 text-gray-600'}`}>{r.priority}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold">{r.days_open}</td>
                            <td className="px-3 py-2.5 text-right">{r.positions}</td>
                            <td className="px-3 py-2.5 text-right text-blue-600 font-medium">{r.candidates}</td>
                            <td className="px-3 py-2.5 text-right">{r.interviews}</td>
                            <td className="px-3 py-2.5 text-right text-teal-600">{r.offers}</td>
                            <td className="px-3 py-2.5 text-right text-green-700 font-semibold">{r.joined}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${agingColor}`}>
                                {r.days_open > 60 ? 'Critical' : r.days_open > 30 ? 'Aging' : 'Fresh'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ TRENDS ═══ */}
        {activeTab === 'trends' && (
          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle>Monthly Hiring Trend — Last 12 Months</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={monthlyChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Applied" fill="#3b82f6" />
                    <Bar dataKey="Selected" fill="#22c55e" />
                    <Bar dataKey="Joined" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-5">
              {/* Department pipeline bar */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Dept Pipeline Snapshot</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart layout="vertical" data={depts.slice(0, 8).map(d => ({ name: d.department?.slice(0,12), In_Pipeline: d.in_progress, Selected: d.selected }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="In_Pipeline" fill="#8b5cf6" />
                      <Bar dataKey="Selected" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Source quality comparison */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Source → Joining Rate</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {sources.slice(0, 7).map((s, i) => {
                      const joinRate = pct(s.joined, s.applied);
                      return (
                        <div key={s.source} className="flex items-center gap-3">
                          <span className="text-xs text-gray-600 w-28 flex-shrink-0 truncate">{SOURCE_LABELS[s.source] || s.source}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-3">
                            <div className="h-3 rounded-full" style={{ width: `${Math.max(joinRate, 2)}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          </div>
                          <span className="text-xs font-semibold w-12 text-right">{s.applied} appl.</span>
                          <span className="text-xs text-green-700 font-bold w-12 text-right">{joinRate}% join</span>
                        </div>
                      );
                    })}
                    {sources.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No source data</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
