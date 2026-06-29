import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, Filter, TrendingUp, Users, Briefcase, BarChart3 } from 'lucide-react';

const FUNNEL_STEPS = [
  { key: 'job_requisitions', label: 'Job Requisitions', color: 'bg-blue-500' },
  { key: 'total_candidates', label: 'Candidates', color: 'bg-indigo-500' },
  { key: 'interviews_scheduled', label: 'Interviews', color: 'bg-violet-500' },
  { key: 'offers_sent', label: 'Offers Sent', color: 'bg-purple-500' },
  { key: 'offers_accepted', label: 'Offers Accepted', color: 'bg-green-500' },
];

export default function RecruitmentAnalytics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [days, setDays] = useState('90');

  useEffect(() => { loadData(); }, [days]);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getRecruitmentFunnel', { days: Number(days) });
      setData(result?.data || result);
    } catch (e) {
      toast.error('Failed to load recruitment data');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  );

  const funnel = data?.funnel || {};
  const maxVal = Math.max(...FUNNEL_STEPS.map(s => funnel[s.key] || 0), 1);
  const candidates = funnel.total_candidates || 0;
  const accepted = funnel.offers_accepted || 0;
  const conversionRate = candidates > 0 ? ((accepted / candidates) * 100).toFixed(1) : '0.0';
  const sourceSummary = data?.by_source ? Object.entries(data.by_source).map(([source, count]) => ({ source, count })) : [];
  const statusSummary = data?.by_status ? Object.entries(data.by_status).map(([status, count]) => ({ status, count })) : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Recruitment Analytics</h1>
          <p className="text-gray-500 text-sm mt-1">Hiring funnel, conversion rates and pipeline health</p>
        </div>
        <div className="w-40">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 180 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Conversion Rate</p>
              <p className="text-xl font-bold text-gray-900">{conversionRate}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Filter className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg Time to Fill</p>
              <p className="text-xl font-bold text-gray-900">{data?.avg_time_to_fill_days ?? '—'} days</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Open Positions</p>
              <p className="text-xl font-bold text-gray-900">{data?.open_positions ?? 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Hiring Funnel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {FUNNEL_STEPS.map((step) => {
            const val = funnel[step.key] || 0;
            const widthPct = maxVal > 0 ? (val / maxVal) * 100 : 0;
            return (
              <div key={step.key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 font-medium">{step.label}</span>
                  <span className="text-gray-500 font-semibold">{val}</span>
                </div>
                <div className="h-7 bg-gray-100 rounded-md overflow-hidden">
                  <div
                    className={`h-full ${step.color} rounded-md flex items-center px-2 transition-all duration-300`}
                    style={{ width: `${widthPct}%` }}
                  >
                    {widthPct > 15 && <span className="text-white text-xs font-medium">{val}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sourceSummary.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Source Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Source</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sourceSummary.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700">{s.source}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
        {statusSummary.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Status Breakdown</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {statusSummary.map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-700 capitalize">{s.status?.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-right font-medium text-gray-900">{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
