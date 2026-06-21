import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MobileSelect from '@/components/MobileSelect';
import {
  ShieldCheck, IndianRupee, Users, Download, RefreshCw, FileText, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function StatutoryRegisters() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [tab, setTab] = useState('pf');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => { load(); }, [month, year]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke('getStatutoryRegisters', { month, year });
      const d = res.data || res;
      if (d.success) setData(d);
      else toast.error(d.error || 'Failed to load registers');
    } catch (e) { toast.error('Error: ' + e.message); }
    setLoading(false);
  };

  const downloadECR = () => {
    if (!data?.pf?.ecr_text) { toast.error('No PF members for this period'); return; }
    download(`ECR_${year}_${String(month).padStart(2, '0')}.txt`, data.pf.ecr_text);
    toast.success('ECR text file downloaded — upload to EPFO portal');
  };

  const downloadCSV = (kind) => {
    if (kind === 'pf') {
      const headers = ['UAN', 'Name', 'Gross Wages', 'EPF Wages', 'EPS Wages', 'EDLI Wages', 'EE EPF (12%)', 'ER EPS (8.33%)', 'ER EPF (3.67%)', 'NCP Days'];
      const lines = data.pf.rows.map(r => [r.uan, r.name, r.gross_wages, r.epf_wages, r.eps_wages, r.edli_wages, r.ee_epf, r.er_eps, r.er_epf, r.ncp_days].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      download(`PF_register_${year}_${month}.csv`, [headers.join(','), ...lines].join('\n'), 'text/csv');
    } else {
      const headers = ['ESI Number', 'Name', 'Gross Wages', 'EE ESI (0.75%)', 'ER ESI (3.25%)', 'Total'];
      const lines = data.esi.rows.map(r => [r.esi_number, r.name, r.gross_wages, r.ee_esi, r.er_esi, r.total].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      download(`ESI_register_${year}_${month}.csv`, [headers.join(','), ...lines].join('\n'), 'text/csv');
    }
  };

  const yearOpts = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) yearOpts.push({ value: String(y), label: String(y) });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" /> Statutory Registers — PF & ESI
          </h1>
          <p className="text-gray-500 text-sm mt-1">Monthly EPF ECR (v2.0) and ESI contribution registers, ready to file. {data?.period?.label || ''}</p>
        </div>
        <div className="flex gap-2 items-center">
          <MobileSelect value={String(month)} onValueChange={(v) => setMonth(Number(v))} label="Month" className="w-28"
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
          <MobileSelect value={String(year)} onValueChange={(v) => setYear(Number(v))} label="Year" className="w-24" options={yearOpts} />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-0">
        {[{ k: 'pf', label: `Provident Fund (${data?.pf?.member_count || 0})` }, { k: 'esi', label: `ESI (${data?.esi?.member_count || 0})` }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.k ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400"><RefreshCw className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : tab === 'pf' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat icon={Users} color="emerald" label="PF members" value={data?.pf?.member_count || 0} />
            <Stat icon={IndianRupee} color="blue" label="Employee EPF (12%)" value={fmt(data?.pf?.totals?.ee)} />
            <Stat icon={IndianRupee} color="indigo" label="Employer EPS+EPF" value={fmt((data?.pf?.totals?.erEPS || 0) + (data?.pf?.totals?.erEPF || 0))} />
            <Stat icon={IndianRupee} color="teal" label="Total PF remittance" value={fmt(data?.pf?.totals?.total)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={downloadECR} className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!data?.pf?.member_count}>
              <FileText className="w-4 h-4 mr-2" /> Download ECR (.txt for EPFO)
            </Button>
            <Button variant="outline" onClick={() => downloadCSV('pf')} disabled={!data?.pf?.member_count}><Download className="w-4 h-4 mr-2" /> CSV</Button>
          </div>
          <RegisterTable
            headers={['UAN', 'Name', 'Gross', 'EPF Wages', 'EE EPF', 'ER EPS', 'ER EPF', 'NCP']}
            rows={data?.pf?.rows || []}
            render={(r) => [r.uan || '—', r.name, fmt(r.gross_wages), fmt(r.epf_wages), fmt(r.ee_epf), fmt(r.er_eps), fmt(r.er_epf), r.ncp_days]}
            empty="No PF-eligible members for this period."
          />
          <p className="text-xs text-gray-400">ECR v2.0 format: UAN#~#Name#~#Gross#~#EPF#~#EPS#~#EDLI#~#EE-EPF#~#ER-EPS#~#ER-EPF#~#NCP#~#Refund. Members without a UAN are included — fill UAN on the employee record before filing.</p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat icon={Users} color="emerald" label="ESI members" value={data?.esi?.member_count || 0} />
            <Stat icon={IndianRupee} color="blue" label="Employee (0.75%)" value={fmt(data?.esi?.totals?.ee)} />
            <Stat icon={IndianRupee} color="indigo" label="Employer (3.25%)" value={fmt(data?.esi?.totals?.er)} />
            <Stat icon={IndianRupee} color="teal" label="Total ESI" value={fmt(data?.esi?.totals?.total)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => downloadCSV('esi')} disabled={!data?.esi?.member_count}><Download className="w-4 h-4 mr-2" /> CSV</Button>
          </div>
          <RegisterTable
            headers={['ESI Number', 'Name', 'Gross', 'EE (0.75%)', 'ER (3.25%)', 'Total']}
            rows={data?.esi?.rows || []}
            render={(r) => [r.esi_number || '—', r.name, fmt(r.gross_wages), fmt(r.ee_esi), fmt(r.er_esi), fmt(r.total)]}
            empty="No ESI-eligible members (gross ≤ ₹21,000) for this period."
          />
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, color, label, value }) {
  const colors = { emerald: 'bg-emerald-100 text-emerald-600', blue: 'bg-blue-100 text-blue-600', indigo: 'bg-indigo-100 text-indigo-600', teal: 'bg-teal-100 text-teal-600' };
  return (
    <Card><CardContent className="pt-5 flex items-center gap-4">
      <div className={`p-3 rounded-full ${colors[color]}`}><Icon className="w-6 h-6" /></div>
      <div className="min-w-0"><p className="text-sm text-gray-500">{label}</p><p className="text-xl font-bold text-gray-800 truncate">{value}</p></div>
    </CardContent></Card>
  );
}

function RegisterTable({ headers, rows, render, empty }) {
  return (
    <div className="rounded-lg border overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
          <tr>{headers.map((h, i) => <th key={i} className={`px-4 py-3 ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="text-center py-10 text-gray-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-300" /> {empty}
            </td></tr>
          ) : rows.map((r, idx) => {
            const cells = render(r);
            return (
              <tr key={idx} className="border-t hover:bg-gray-50">
                {cells.map((c, i) => <td key={i} className={`px-4 py-3 ${i >= 2 ? 'text-right text-gray-700' : 'text-gray-800'} ${i === 1 ? 'font-medium' : ''}`}>{c}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
