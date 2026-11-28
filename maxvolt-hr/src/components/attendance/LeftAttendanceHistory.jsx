import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { safeDate, safeTime } from '@/lib/dateUtils';
import { downloadBase64 } from '@/lib/download';

// Complete attendance history of one left employee, month by month, with the Excel download.
export default function LeftAttendanceHistory({ userId }) {
  const [month, setMonth] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const range = () => {
    if (!month) return {};
    const [y, m] = month.split('-').map(Number);
    return { from: `${month}-01`, to: `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
  };

  useEffect(() => {
    let alive = true;
    setLoading(true); setError('');
    base44.functions.invoke('le_attendance', { user_id: userId, ...range() })
      .then((r) => { if (alive) setData(r?.data || r); })
      .catch((e) => { if (alive) { setError(e.message || 'Could not load attendance'); setData(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId, month]);

  const download = async () => {
    setExporting(true);
    try {
      const r = await base44.functions.invoke('le_export', { user_id: userId, ...range() });
      const d = r?.data || r;
      downloadBase64(d.base64, d.filename);
      toast.success('Attendance report downloaded');
    } catch (e) { toast.error(e.message || 'Download failed'); }
    setExporting(false);
  };

  const s = data?.summary;
  const lwd = data?.employee?.last_working_date;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        {lwd && <Button variant="outline" size="sm" onClick={() => setMonth(lwd.slice(0, 7))}>Last working month</Button>}
        {month && <Button variant="ghost" size="sm" onClick={() => setMonth('')}>Complete history</Button>}
        <Button size="sm" className="ml-auto" onClick={download} disabled={exporting || loading || !data?.records?.length}>
          {exporting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Download className="w-4 h-4 mr-1.5" />}Download Excel
        </Button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      {loading && <p className="py-8 text-center text-gray-400 text-sm"><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Loading attendance…</p>}

      {!loading && s && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
            {[['Days', s.days], ['Present', s.present], ['Half day', s.half_day], ['Absent', s.absent], ['Leave', s.leave], ['Hours', s.hours]].map(([k, v]) => (
              <div key={k} className="border rounded-lg py-2"><p className="text-lg font-semibold">{v}</p><p className="text-xs text-gray-400">{k}</p></div>
            ))}
          </div>
          {s.after_exit > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">{s.after_exit} record(s) are dated after the last working day. They are kept and marked below.</p>}
          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 uppercase sticky top-0 bg-white">
                <tr>{['Date', 'Status', 'Check in', 'Check out', 'Hours'].map((h) => <th key={h} className="text-left py-1.5 pr-3">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {data.records.map((a) => (
                  <tr key={a.id || a.date} className={lwd && a.date > lwd ? 'bg-amber-50' : ''}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{safeDate(a.date, 'dd MMM yyyy, EEE')}</td>
                    <td className="py-1.5 pr-3 capitalize">{String(a.status || '—').replace(/_/g, ' ')}{a.regularised ? ' (regularised)' : ''}</td>
                    <td className="py-1.5 pr-3">{safeTime(a.check_in_time)}</td>
                    <td className="py-1.5 pr-3">{safeTime(a.check_out_time)}</td>
                    <td className="py-1.5 pr-3">{a.working_hours ? Number(a.working_hours).toFixed(2) : '—'}</td>
                  </tr>
                ))}
                {!data.records.length && <tr><td colSpan={5} className="py-8 text-center text-gray-400">No attendance records for this period</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
