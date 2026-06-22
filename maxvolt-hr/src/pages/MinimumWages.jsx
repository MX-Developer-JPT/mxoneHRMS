import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';

export default function MinimumWages() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const r = await base44.functions.invoke('getMinimumWagesReport', {});
      setResult(r.data);
    } catch (e) {
      toast.error('Failed to load: ' + e.message);
    }
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-amber-100 p-2 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Minimum Wages Compliance</h1>
            <p className="text-sm text-gray-500">Flags employees paid below central minimum wages (2025)</p>
          </div>
        </div>
        <Button variant="outline" onClick={load} className="gap-2">
          <RefreshCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-gray-800">{result?.total || 0}</p>
            <p className="text-sm text-gray-500 mt-1">Total Employees</p>
          </CardContent>
        </Card>
        <Card className="border-green-200">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-green-700">{result?.compliant || 0}</p>
            <p className="text-sm text-green-600 mt-1">Compliant</p>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="pt-6 text-center">
            <p className="text-3xl font-bold text-red-700">{result?.violations || 0}</p>
            <p className="text-sm text-red-600 mt-1">Below Min Wage</p>
          </CardContent>
        </Card>
      </div>

      {result?.violation_list?.length > 0 ? (
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-base text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Employees Below Minimum Wages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="text-left py-2 px-3">Employee</th>
                    <th className="text-left py-2 px-3">Code</th>
                    <th className="text-left py-2 px-3">Department</th>
                    <th className="text-right py-2 px-3">Gross/Month</th>
                    <th className="text-right py-2 px-3">Min Wage</th>
                    <th className="text-right py-2 px-3">Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {result.violation_list.map((v, i) => (
                    <tr key={i} className="border-b hover:bg-red-50">
                      <td className="py-2 px-3 font-medium">{v.name}</td>
                      <td className="py-2 px-3 text-gray-500">{v.code}</td>
                      <td className="py-2 px-3 text-gray-500">{v.department}</td>
                      <td className="py-2 px-3 text-right">₹{(v.gross_monthly || 0).toLocaleString('en-IN')}</td>
                      <td className="py-2 px-3 text-right text-amber-600">₹{(v.minimum_wage || 0).toLocaleString('en-IN')}</td>
                      <td className="py-2 px-3 text-right">
                        <Badge variant="destructive">-₹{(v.shortfall || 0).toLocaleString('en-IN')}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-green-200">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <p className="text-green-700 font-semibold">All employees are compliant</p>
            <p className="text-sm text-gray-400 mt-1">No salary below central minimum wages</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 bg-blue-50 rounded-lg p-4">
        <p className="text-xs text-blue-700 font-medium">Note on minimum wages</p>
        <p className="text-xs text-blue-600 mt-1">
          Uses central minimum wages (2025): Unskilled ₹9,360 · Semi-skilled ₹10,296 · Skilled ₹11,334 · Highly skilled ₹12,126.
          Assign skill_category to employees for accurate categorization. State-specific rates may vary.
        </p>
      </div>
    </div>
  );
}
