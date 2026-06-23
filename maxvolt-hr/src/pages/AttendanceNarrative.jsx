import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const YEARS  = [2024, 2025, 2026];

export default function AttendanceNarrative() {
  const [user, setUser]           = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedUser, setSelectedUser] = useState('__self');
  const [month, setMonth]         = useState(new Date().getMonth() + 1);
  const [year, setYear]           = useState(new Date().getFullYear());
  const [result, setResult]       = useState(null);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    base44.auth.me()
      .then(u => {
        setUser(u);
        if (u?.role === 'admin' || u?.role === 'hr') {
          base44.entities.Employee.list('-created_date', 500)
            .then(data => setEmployees(Array.isArray(data) ? data.filter(e => e.user_id) : []))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const generate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const uid = selectedUser === '__self' ? undefined : selectedUser;
      const r = await base44.functions.invoke('getAttendanceNarrative', { user_id: uid, month, year });
      const d = r?.data;
      if (!d || d.error) throw new Error(d?.error || 'No response from server');
      setResult(d);
    } catch (e) {
      toast.error('Failed to generate: ' + (e.message || 'Unknown error'));
    }
    setLoading(false);
  };

  const isHR = user?.role === 'admin' || user?.role === 'hr';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-purple-100 p-2 rounded-lg">
          <Sparkles className="w-6 h-6 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Attendance Insights</h1>
          <p className="text-sm text-gray-500">AI-generated narrative summary of attendance patterns</p>
        </div>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 items-end">
            {isHR && employees.length > 0 && (
              <div className="flex-1 min-w-44">
                <label className="text-xs text-gray-500 mb-1 block">Employee</label>
                <Select value={selectedUser} onValueChange={setSelectedUser}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__self">My Attendance</SelectItem>
                    {employees.map(e => (
                      <SelectItem key={e.user_id} value={String(e.user_id)}>
                        {e.display_name || e.user_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Month</label>
              <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Year</label>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={generate} disabled={loading} className="bg-purple-600 hover:bg-purple-700 gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {loading ? 'Generating...' : 'Generate Insight'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Present',  value: result.stats?.present  ?? 0, color: 'bg-green-50 text-green-700'  },
              { label: 'Absent',   value: result.stats?.absent   ?? 0, color: 'bg-red-50 text-red-700'    },
              { label: 'Late',     value: result.stats?.late     ?? 0, color: 'bg-amber-50 text-amber-700' },
              { label: 'WFH',      value: result.stats?.wfh      ?? 0, color: 'bg-blue-50 text-blue-700'  },
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-lg p-4 text-center`}>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs mt-1">{s.label} days</p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                AI Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 leading-relaxed">{result.narrative}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
