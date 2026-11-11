import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, AlertTriangle } from 'lucide-react';
import { ap, STATUS_TONE, inputCls } from '@/lib/appraisal';

const STATUSES = ['self_assessment_pending', 'self_assessment_draft', 'manager_review_pending', 'manager_review_draft', 'meeting_pending', 'meeting_scheduled', 'hr_review_pending', 'returned_for_correction', 'approved', 'published', 'closed'];

export default function TeamTable({ cycleId, isHR, onOpen, refreshKey }) {
  const [f, setF] = useState({ search: '', status: '', department: '', pending: '' }); const [d, setD] = useState({ reviews: [], total: 0 }); const [page, setPage] = useState(1); const [cal, setCal] = useState(null);
  const load = useCallback(async () => { if (!cycleId) return; try { setD(await ap('ap_team_reviews', { cycle_id: cycleId, filters: f, page })); } catch (e) { toast.error(e.message); } }, [cycleId, f, page, refreshKey]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (isHR && cycleId) ap('ap_calibration', { cycle_id: cycleId }).then(setCal).catch(() => {}); }, [isHR, cycleId, refreshKey]);
  if (!d.is_manager && !isHR) return <p className="text-sm text-slate-500">You have no reporting employees in this cycle.</p>;
  return (<div className="space-y-3">
    <div className="flex flex-wrap gap-2 items-center">
      <div className="relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" /><input className={`${inputCls} pl-8 w-56`} placeholder="Search name or code" value={f.search} onChange={e => { setPage(1); setF({ ...f, search: e.target.value }); }} /></div>
      <select className={`${inputCls} w-56`} value={f.status} onChange={e => { setPage(1); setF({ ...f, status: e.target.value }); }}><option value="">All statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={f.pending === 'mine'} onChange={e => setF({ ...f, pending: e.target.checked ? 'mine' : '' })} />Waiting for my evaluation</label>
      <span className="ml-auto text-sm text-slate-500">{d.total} employee(s)</span></div>
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 bg-slate-50"><th className="p-2">Employee</th><th>Department</th>{isHR && <th>Manager</th>}<th>Status</th><th>Self</th><th>Manager</th>{isHR && <th>Final</th>}<th></th></tr></thead>
      <tbody>{d.reviews.map(r => (<tr key={r.id} className="border-t hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(r.id)}><td className="p-2"><div className="font-medium">{r.name}</div><div className="text-xs text-slate-400">{r.code} · {r.designation}</div></td><td>{r.department}</td>{isHR && <td>{r.manager_name || '—'}</td>}
        <td><Badge className={`${STATUS_TONE[r.status] || ''} border-0`}>{r.status_label}</Badge>{r.late_self && <AlertTriangle className="inline w-3.5 h-3.5 ml-1 text-red-500" title="Late self-assessment" />}{r.excluded && <Badge className="ml-1 bg-slate-200 text-slate-600 border-0">Removed</Badge>}</td>
        <td>{r.self_score ?? '—'}</td><td>{r.manager_score ?? '—'}</td>{isHR && <td className="font-medium">{r.final_score ?? '—'} <span className="text-xs text-slate-500">{r.band}</span></td>}<td><Button size="sm" variant="outline">Open</Button></td></tr>))}
        {!d.reviews.length && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Nothing matches.</td></tr>}</tbody></table></div>
    {d.total > d.page_size && <div className="flex gap-2 items-center text-sm"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>Page {page}<Button size="sm" variant="outline" disabled={page * d.page_size >= d.total} onClick={() => setPage(page + 1)}>Next</Button></div>}
    {isHR && cal && <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2"><h4 className="font-semibold">Calibration overview</h4>
      <p className="text-sm text-slate-600">Average manager score {cal.overall.avg} (σ {cal.overall.sd}) across {cal.overall.n} evaluation(s) · {cal.missing_evaluations} evaluation(s) still missing.</p>
      <div className="grid md:grid-cols-2 gap-4 text-sm"><div><div className="font-medium mb-1">By department</div>{cal.by_department.map(x => <div key={x.key} className="flex justify-between border-b py-1"><span>{x.key}</span><span>{x.avg} <span className="text-slate-400">({x.n}, {x.min}–{x.max})</span></span></div>)}</div>
        <div><div className="font-medium mb-1">By manager</div>{cal.by_manager.map(x => <div key={x.key} className="flex justify-between border-b py-1"><span>{x.key} {x.unusual && <Badge className="bg-amber-50 text-amber-800 border-0">unusual</Badge>}</span><span>{x.avg} <span className="text-slate-400">({x.n})</span></span></div>)}</div></div></div>}
  </div>);
}
