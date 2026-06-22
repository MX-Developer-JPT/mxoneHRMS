import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from 'sonner';
import { Loader2, HeartHandshake, Users, TrendingUp, PieChart } from 'lucide-react';

export default function DIMetrics() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getDIMetrics', {});
      setData(result);
    } catch (e) {
      toast.error('Failed to load D&I metrics');
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

  const total = data?.total_employees ?? 0;
  const femalePct = data?.female_percentage ?? 0;
  const malePct = data?.male_percentage ?? 0;
  const payGap = data?.pay_gap_percentage ?? 0;
  const deptBreakdown = data?.department_breakdown || [];
  const avgMaleSalary = data?.avg_male_salary ?? 0;
  const avgFemaleSalary = data?.avg_female_salary ?? 0;

  const fmt = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <HeartHandshake className="w-7 h-7 text-pink-500" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Diversity & Inclusion</h1>
          <p className="text-gray-500 text-sm mt-0.5">Organization-wide diversity metrics and pay equity analysis</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <Users className="w-5 h-5 text-blue-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500 mb-1">Total Employees</p>
            <p className="text-2xl font-bold text-gray-900">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <PieChart className="w-5 h-5 text-pink-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500 mb-1">% Female</p>
            <p className="text-2xl font-bold text-pink-600">{femalePct.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <PieChart className="w-5 h-5 text-blue-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500 mb-1">% Male</p>
            <p className="text-2xl font-bold text-blue-600">{malePct.toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-5 h-5 text-orange-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500 mb-1">Pay Gap %</p>
            <p className={`text-2xl font-bold ${payGap > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {payGap > 0 ? '+' : ''}{payGap.toFixed(1)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Gender Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-400 inline-block" /> Male {malePct.toFixed(1)}%</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-pink-400 inline-block" /> Female {femalePct.toFixed(1)}%</span>
          </div>
          <div className="h-6 bg-gray-100 rounded-full overflow-hidden flex">
            <div className="h-full bg-blue-400" style={{ width: `${malePct}%` }} />
            <div className="h-full bg-pink-400" style={{ width: `${femalePct}%` }} />
          </div>
        </CardContent>
      </Card>

      {deptBreakdown.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Gender by Department</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Male</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Female</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">% Female</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Visual</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deptBreakdown.map((dept, i) => {
                    const dTotal = (dept.male || 0) + (dept.female || 0);
                    const fPct = dTotal > 0 ? ((dept.female || 0) / dTotal) * 100 : 0;
                    const mPct = 100 - fPct;
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900">{dept.department}</td>
                        <td className="px-4 py-3 text-center text-blue-600">{dept.male || 0}</td>
                        <td className="px-4 py-3 text-center text-pink-600">{dept.female || 0}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{fPct.toFixed(1)}%</td>
                        <td className="px-4 py-3">
                          <div className="h-3 w-24 bg-gray-100 rounded-full overflow-hidden flex">
                            <div className="h-full bg-blue-300" style={{ width: `${mPct}%` }} />
                            <div className="h-full bg-pink-300" style={{ width: `${fPct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Pay Equity Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">Avg Male CTC</p>
              <p className="text-xl font-bold text-blue-700">{fmt(avgMaleSalary)}</p>
            </div>
            <div className="text-center p-4 bg-pink-50 rounded-lg">
              <p className="text-xs text-pink-600 font-medium uppercase tracking-wide mb-1">Avg Female CTC</p>
              <p className="text-xl font-bold text-pink-700">{fmt(avgFemaleSalary)}</p>
            </div>
            <div className={`text-center p-4 rounded-lg ${payGap > 0 ? 'bg-orange-50' : 'bg-green-50'}`}>
              <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${payGap > 0 ? 'text-orange-600' : 'text-green-600'}`}>Pay Gap</p>
              <p className={`text-xl font-bold ${payGap > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                {payGap > 0 ? '+' : ''}{payGap.toFixed(1)}%
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Pay gap is calculated on average CTC. A positive gap means male avg is higher.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
