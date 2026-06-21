import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import MobileSelect from '@/components/MobileSelect';
import {
  ScanSearch, AlertTriangle, Clock, CreditCard, Search, Filter,
  RefreshCw, ShieldCheck, CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';

const SEV = {
  high:   { chip: 'bg-red-100 text-red-700 border-red-200',     dot: 'bg-red-500' },
  medium: { chip: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  low:    { chip: 'bg-gray-100 text-gray-600 border-gray-200',   dot: 'bg-gray-400' },
};

export default function AnomalyDetection() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [sev, setSev] = useState('all');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getAnomalies', {});
      const d = res.data || res;
      if (d.success) { setSummary(d.summary || {}); setRows(d.anomalies || []); }
      else toast.error(d.error || 'Failed to scan');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const filtered = rows.filter(r => {
    if (cat !== 'all' && r.category !== cat) return false;
    if (sev !== 'all' && r.severity !== sev) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.name?.toLowerCase().includes(q) && !r.description?.toLowerCase().includes(q) && !r.department?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ScanSearch className="w-6 h-6 text-rose-600" /> Anomaly Detection
          </h1>
          <p className="text-gray-500 text-sm mt-1">Automated scan of attendance and payroll for errors, irregularities, and data-quality issues.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Re-scan
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={AlertTriangle} color="red" label="High severity" value={summary.high || 0} />
        <Stat icon={AlertTriangle} color="amber" label="Medium severity" value={summary.medium || 0} />
        <Stat icon={Clock} color="blue" label="Attendance issues" value={summary.attendance || 0} />
        <Stat icon={CreditCard} color="indigo" label="Payroll issues" value={summary.payroll || 0} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input className="pl-9" placeholder="Search employee or issue…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <MobileSelect value={cat} onValueChange={setCat} label="Category" className="w-40"
            options={[{ value: 'all', label: 'All categories' }, { value: 'attendance', label: 'Attendance' }, { value: 'payroll', label: 'Payroll' }]} />
        </div>
        <MobileSelect value={sev} onValueChange={setSev} label="Severity" className="w-36"
          options={[{ value: 'all', label: 'All severities' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} />
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} found</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /> Scanning…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
          <p className="text-gray-600 font-medium">{rows.length === 0 ? 'No anomalies detected — all clear!' : 'No anomalies match the filters.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => {
            const s = SEV[r.severity] || SEV.low;
            const Icon = r.category === 'payroll' ? CreditCard : Clock;
            return (
              <Card key={i} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-3.5 flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${s.dot} flex-shrink-0`} />
                  <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{r.description}</p>
                    <p className="text-xs text-gray-400">{r.name}{r.department ? ` · ${r.department}` : ''}{r.when ? ` · ${r.when}` : ''}</p>
                  </div>
                  <Badge variant="outline" className={`flex-shrink-0 ${s.chip}`}>{r.severity}</Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ icon: Icon, color, label, value }) {
  const colors = { red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600', blue: 'bg-blue-100 text-blue-600', indigo: 'bg-indigo-100 text-indigo-600' };
  return (
    <Card><CardContent className="pt-5 flex items-center gap-4">
      <div className={`p-3 rounded-full ${colors[color]}`}><Icon className="w-6 h-6" /></div>
      <div><p className="text-sm text-gray-500">{label}</p><p className="text-2xl font-bold text-gray-800">{value}</p></div>
    </CardContent></Card>
  );
}
