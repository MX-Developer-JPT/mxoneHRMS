import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Cake, Download, Loader2, Award } from 'lucide-react';
import { downloadBase64 } from '@/lib/download';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = [['all', 'Both'], ['birthday', 'Birthdays'], ['anniversary', 'Work anniversaries']];

// Month-wise birthdays and work anniversaries for the front desk, with Excel download.
export default function CelebrationList() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [kind, setKind] = useState('all');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null); setError('');
    base44.functions.invoke('cl_list', { month, year })
      .then((r) => { if (live) setData(r?.data || r); })
      .catch((e) => { if (live) setError(e.message || 'Could not load the list'); });
    return () => { live = false; };
  }, [month, year, retry]);

  const download = async (wholeYear) => {
    setBusy(wholeYear ? 'year' : 'month');
    try {
      const r = await base44.functions.invoke('cl_export', { month: wholeYear ? 0 : month, year, kind });
      const d = r?.data || r;
      downloadBase64(d.base64, d.filename);
      toast.success('List downloaded');
    } catch (e) { toast.error(e.message || 'Download failed'); }
    setBusy('');
  };

  const rows = (data?.rows || []).filter((r) => (kind === 'birthday' ? r.birthday : kind === 'anniversary' ? r.anniversary : true));
  const t = data?.totals;
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Cake className="w-6 h-6 text-pink-600" />Birthdays & Anniversaries</h1>
          <p className="text-sm text-gray-500">Current employees, month by month</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => download(false)} disabled={!!busy || !rows.length}>
            {busy === 'month' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}Download {MONTHS[month - 1]}
          </Button>
          <Button variant="outline" onClick={() => download(true)} disabled={!!busy}>
            {busy === 'year' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}All 12 months
          </Button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <select aria-label="Month" className="h-9 rounded-md border bg-white px-2 text-sm" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select aria-label="Year" className="h-9 rounded-md border bg-white px-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
        {KINDS.map(([k, label]) => <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-full border text-xs ${kind === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>)}
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRetry((x) => x + 1)}>Try again</Button></div>}
      {!data && !error && <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}

      {data && (
        <>
          <p className="text-sm text-gray-600"><b>{t.birthdays}</b> birthday(s) and <b>{t.anniversaries}</b> work anniversary(ies) in {MONTHS[month - 1]} {year}.
            {t.missing_birth_date > 0 && <span className="text-amber-700"> {t.missing_birth_date} employee(s) have no date of birth on record.</span>}</p>
          <Card><CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase"><tr>{['Employee code', 'Name', 'Department', 'Birthday', 'Work anniversary'].map((h) => <th key={h} className="text-left px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={`${r.employee_code}-${r.name}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600">{r.employee_code}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.department || '—'}</td>
                    <td className="px-4 py-2.5">{r.birthday ? <span className="inline-flex items-center gap-1.5 text-pink-700"><Cake className="w-3.5 h-3.5" />{r.birthday}</span> : '—'}</td>
                    <td className="px-4 py-2.5">{r.anniversary ? <span className="inline-flex items-center gap-1.5 text-blue-700"><Award className="w-3.5 h-3.5" />{r.anniversary} · {r.years} yr{r.years > 1 ? 's' : ''}</span> : '—'}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="py-10 text-center text-gray-400">Nobody in {MONTHS[month - 1]}</td></tr>}
              </tbody>
            </table>
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
