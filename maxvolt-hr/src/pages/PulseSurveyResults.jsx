import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MobileSelect from '@/components/MobileSelect';
import { ArrowLeft, FileSpreadsheet, FileText, Lock, Eye, Loader2, ShieldAlert, X, Users, Search, BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { ps, typeLabel, saveBase64File, fmtDate, fmtDateTime } from '@/lib/pulse';

const Sel = ({ label, value, onChange, children }) => (
  <div className="space-y-1"><div className="text-[11px] text-gray-500">{label}</div>
    <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>{children}</select></div>
);
const Tile = ({ label, value, tone = '' }) => (<div className="rounded-lg border bg-white p-3"><div className={`text-2xl font-bold ${tone || 'text-gray-800'}`}>{value}</div><div className="text-xs text-gray-500">{label}</div></div>);
const Bar = ({ pct, color = 'bg-violet-500' }) => <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
const enpsTone = (s) => (s >= 30 ? 'text-green-600' : s >= 0 ? 'text-amber-600' : 'text-red-600');

function QuestionCard({ q, n }) {
  return (
    <Card><CardContent className="p-4 space-y-2">
      <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium text-gray-800">{n}. {q.text}</p><Badge variant="outline" className="shrink-0 text-[10px]">{typeLabel(q.type)}</Badge></div>
      {q.type === 'text' ? (
        <div className="space-y-1.5 max-h-52 overflow-y-auto">
          {q.comments?.length ? q.comments.map((c, i) => <p key={i} className="text-sm text-gray-600 bg-gray-50 rounded p-2 italic">&ldquo;{c}&rdquo;</p>) : <p className="text-xs text-gray-400">No comments</p>}
        </div>
      ) : q.choices ? (
        <div className="space-y-1.5">{q.choices.map(c => (
          <div key={c.value}><div className="flex justify-between text-xs"><span className="text-gray-700">{c.label}</span><span className="text-gray-500">{c.count} · {c.pct}%</span></div><Bar pct={c.pct} /></div>
        ))}<p className="text-[11px] text-gray-400">{q.answered} answered{q.type === 'multi' ? ' · % of people who answered' : ''}</p></div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2"><span className="text-3xl font-bold text-violet-600">{q.average ?? '—'}</span><span className="text-xs text-gray-400">average of {q.type === 'nps' ? '10' : '5'} · {q.count} responses</span></div>
          <div className="space-y-0.5">{Array.from({ length: q.type === 'nps' ? 11 : 5 }, (_, i) => (q.type === 'nps' ? i : i + 1)).map(k => { const c = q.distribution?.[k] || 0; return (
            <div key={k} className="flex items-center gap-2 text-[11px]"><span className="w-4 text-right text-gray-500">{k}</span><div className="flex-1"><Bar pct={q.count ? (c / q.count) * 100 : 0} color={q.type === 'nps' ? (k >= 9 ? 'bg-green-500' : k <= 6 ? 'bg-red-400' : 'bg-amber-400') : 'bg-violet-500'} /></div><span className="w-6 text-gray-500">{c}</span></div>
          ); })}</div>
        </div>
      )}
    </CardContent></Card>
  );
}

function BreakdownTable({ title, rows, onPick, hasEnps }) {
  if (!rows?.length) return null;
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="overflow-x-auto">
      <table className="w-full text-sm min-w-[360px]"><thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Group</th><th>Responses</th><th>Avg rating</th>{hasEnps && <th>eNPS</th>}</tr></thead>
        <tbody>{rows.map(g => (
          <tr key={g.name} className="border-b last:border-0 hover:bg-gray-50">
            <td className="py-1.5">{g.hidden || g.name.startsWith('Other') ? <span className="text-gray-500">{g.name}</span> : <button className="text-violet-700 hover:underline text-left" onClick={() => onPick(g.name)}>{g.name}</button>}</td>
            <td>{g.hidden ? '< 5' : g.count}</td><td>{g.avg_rating ?? '—'}</td>{hasEnps && <td className={g.enps != null ? enpsTone(g.enps) : ''}>{g.enps ?? '—'}</td>}
          </tr>))}</tbody></table>
    </CardContent></Card>
  );
}

export default function PulseSurveyResults() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const id = params.get('id');
  const [all, setAll] = useState([]);
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ department: '', designation: '', location: '', user_id: '' });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('overview');

  useEffect(() => { ps('ps_list').then(d => setAll(d.surveys || [])).catch(() => {}); }, []);
  const load = useCallback(async (f) => {
    if (!id) return;
    setLoading(true);
    try { setData(await ps('ps_results', { survey_id: id, filters: f })); } catch (e) { toast.error(e.message); setData(null); }
    setLoading(false);
  }, [id]);
  useEffect(() => { setFilters({ department: '', designation: '', location: '', user_id: '' }); setTab('overview'); load({}); }, [id, load]);

  const setF = (k, v) => { const f = { ...filters, [k]: v }; setFilters(f); load(f); };
  const clear = () => { const f = { department: '', designation: '', location: '', user_id: '' }; setFilters(f); load(f); };
  const active = Object.values(filters).some(Boolean);

  const doExport = async (format) => {
    setExporting(format);
    try { const d = await ps('ps_export', { survey_id: id, format, filters }); saveBase64File(d.base64, d.filename, d.mime); toast.success(`Exported ${d.rows} response${d.rows === 1 ? '' : 's'}`); }
    catch (e) { toast.error(e.message); }
    setExporting('');
  };
  const openDetail = async (r) => {
    setDetail({ row: r, loading: true });
    try { setDetail({ row: r, loading: false, ...(await ps('ps_response', { survey_id: id, user_id: r.user_id })) }); } catch (e) { toast.error(e.message); setDetail(null); }
  };
  const remind = async () => {
    if (!confirm('Send a reminder to everyone who has not responded?')) return;
    try { const d = await ps('ps_remind', { survey_id: id }); toast.success(`Reminder sent to ${d.sent} ${d.sent === 1 ? 'person' : 'people'}`); } catch (e) { toast.error(e.message); }
  };

  const s = data?.survey;
  const opts = data?.filter_options || {};
  const shown = useMemo(() => (data?.responses || []).filter(r => !q || `${r.name} ${r.code} ${r.department} ${r.designation}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const hasEnps = !!data?.enps || (s?.questions || []).some(x => x.type === 'nps');

  if (!id) return <div className="p-6 text-gray-600">No survey selected. <Link to="/PulseSurveys" className="text-violet-700 underline">Back to surveys</Link></div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <Link to="/PulseSurveys" className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" />All surveys</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 break-words">{s?.title || 'Survey results'}</h1>
          {s && <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge className={s.type === 'enps' ? 'bg-teal-100 text-teal-700' : 'bg-violet-100 text-violet-700'}>{s.type === 'enps' ? 'eNPS' : 'Pulse'}</Badge>
            <Badge className={s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>{s.status}</Badge>
            {s.anonymous ? <Badge className="bg-violet-50 text-violet-700 border border-violet-200"><Lock className="w-3 h-3 mr-1" />Anonymous</Badge> : <Badge className="bg-amber-50 text-amber-700 border border-amber-200"><Eye className="w-3 h-3 mr-1" />Named</Badge>}
            <span className="text-xs text-gray-400">Launched {fmtDate(s.created_at)}</span>
          </div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!!exporting || !data || data.suppressed} onClick={() => doExport('xlsx')}>{exporting === 'xlsx' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}Excel report</Button>
          <Button variant="outline" size="sm" disabled={!!exporting || !data || data.suppressed} onClick={() => doExport('csv')}>{exporting === 'csv' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}CSV</Button>
        </div>
      </div>

      {s && (s.anonymous
        ? <div className="text-xs bg-violet-50 border border-violet-100 rounded-lg p-2.5 text-violet-800 flex gap-1.5"><Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />Anonymous survey: answers are not linked to names. Any breakdown or filter behind fewer than {data?.min_group || 5} people is hidden, and exports are shuffled with small groups merged.</div>
        : <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-amber-900 flex gap-1.5"><Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />Named survey: respondents were told their name is visible to HR. Opening an employee&apos;s answers and every export is recorded in an access log.</div>)}

      <Card><CardContent className="p-3 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Sel label="Survey" value={id} onChange={v => nav(`/PulseSurveyResults?id=${v}`)}>{all.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}{!all.some(x => x.id === id) && s && <option value={id}>{s.title}</option>}</Sel>
          <Sel label="Department" value={filters.department} onChange={v => setF('department', v)}><option value="">All departments</option>{(opts.departments || []).map(d => <option key={d} value={d}>{d}</option>)}</Sel>
          <Sel label="Designation" value={filters.designation} onChange={v => setF('designation', v)}><option value="">All designations</option>{(opts.designations || []).map(d => <option key={d} value={d}>{d}</option>)}</Sel>
          <Sel label="Location" value={filters.location} onChange={v => setF('location', v)}><option value="">All locations</option>{(opts.locations || []).map(d => <option key={d} value={d}>{d}</option>)}</Sel>
          {s && !s.anonymous
            ? <div className="space-y-1"><div className="text-[11px] text-gray-500">Employee</div><MobileSelect value={filters.user_id} onValueChange={v => setF('user_id', v)} placeholder="All employees" label="Employee" options={[{ value: '', label: 'All employees' }, ...(opts.employees || []).map(e => ({ value: e.user_id, label: e.label }))]} /></div>
            : <div className="space-y-1"><div className="text-[11px] text-gray-500">Employee</div><div className="h-9 rounded-md border bg-gray-50 px-2 text-xs text-gray-400 flex items-center">Not available (anonymous)</div></div>}
        </div>
        {active && <div className="flex items-center gap-2 text-xs text-gray-500"><span>Filtered</span><Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={clear}><X className="w-3 h-3 mr-1" />Clear filters</Button></div>}
      </CardContent></Card>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-violet-600" /></div> : !data ? null : data.suppressed ? (
        <Card className="border-amber-300 bg-amber-50"><CardContent className="p-6 flex gap-3 text-amber-900"><ShieldAlert className="w-6 h-6 shrink-0" /><div><div className="font-semibold">Results hidden to protect anonymity</div><div className="text-sm">{data.message}</div></div></CardContent></Card>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="responses">Responses{!s.anonymous ? ` (${data.response_count})` : ''}</TabsTrigger>{!s.anonymous && <TabsTrigger value="pending">Not responded ({data.not_responded?.length || 0})</TabsTrigger>}</TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Responses" value={data.response_count} />
              <Tile label="Employees in scope" value={data.in_scope} />
              <Tile label="Response rate" value={`${data.response_rate}%`} tone={data.response_rate >= 70 ? 'text-green-600' : data.response_rate >= 40 ? 'text-amber-600' : 'text-red-600'} />
              {data.enps ? <Tile label="eNPS" value={data.enps.score} tone={enpsTone(data.enps.score)} /> : <Tile label="Questions" value={s.questions.length} />}
            </div>
            {data.response_count === 0 && <Card><CardContent className="p-8 text-center text-gray-400">No responses for this selection yet.</CardContent></Card>}
            {data.enps && (
              <Card><CardContent className="p-4 space-y-1.5">
                <p className="text-sm font-medium text-gray-700">Net Promoter breakdown</p>
                <div className="flex h-4 rounded-full overflow-hidden"><div className="bg-green-500" style={{ width: `${data.enps.promoter_pct}%` }} /><div className="bg-amber-400" style={{ width: `${data.enps.passive_pct}%` }} /><div className="bg-red-500" style={{ width: `${data.enps.detractor_pct}%` }} /></div>
                <div className="flex justify-between text-xs text-gray-500 flex-wrap gap-2"><span>👍 {data.enps.promoters} promoters ({data.enps.promoter_pct}%)</span><span>😐 {data.enps.passives} passives</span><span>👎 {data.enps.detractors} detractors ({data.enps.detractor_pct}%)</span></div>
              </CardContent></Card>
            )}
            <div className="grid lg:grid-cols-2 gap-4">
              <BreakdownTable title="By department" rows={data.breakdown?.department} hasEnps={hasEnps} onPick={v => setF('department', v)} />
              <BreakdownTable title="By designation" rows={data.breakdown?.designation} hasEnps={hasEnps} onPick={v => setF('designation', v)} />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">{data.questions.map((qq, i) => <QuestionCard key={qq.id} q={qq} n={i + 1} />)}</div>
          </TabsContent>

          <TabsContent value="responses" className="space-y-3">
            {s.anonymous ? (
              <Card><CardContent className="p-8 text-center text-gray-500 space-y-2"><Lock className="w-8 h-8 mx-auto text-violet-400" /><div className="font-medium text-gray-700">Individual answers are not shown for an anonymous survey</div><div className="text-sm">Use the overview and the filters above for department- and designation-level results, or export the shuffled responses.</div></CardContent></Card>
            ) : (
              <>
                <div className="relative max-w-sm"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" /><Input className="pl-8" placeholder="Search name, code, department…" value={q} onChange={e => setQ(e.target.value)} /></div>
                <Card><CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-sm min-w-[720px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Designation</th><th>Location</th><th>Submitted</th><th></th></tr></thead>
                    <tbody>
                      {shown.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400">No responses for this selection.</td></tr>}
                      {shown.map(r => (
                        <tr key={r.user_id} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="p-2"><div className="font-medium">{r.name}</div><div className="text-[11px] text-gray-500">{r.code}</div></td>
                          <td>{r.department}</td><td>{r.designation}</td><td className="text-xs">{r.location || '—'}</td><td className="text-xs">{fmtDateTime(r.submitted_at)}</td>
                          <td className="pr-2 text-right"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDetail(r)}>View answers</Button></td>
                        </tr>))}
                    </tbody></table>
                </CardContent></Card>
              </>
            )}
          </TabsContent>

          {!s.anonymous && (
            <TabsContent value="pending" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-500 flex items-center gap-1.5"><Users className="w-4 h-4" />{data.not_responded.length} employee{data.not_responded.length === 1 ? '' : 's'} in this selection have not responded.</p>{s.status === 'active' && <Button size="sm" variant="outline" onClick={remind}><BellRing className="w-3.5 h-3.5 mr-1" />Remind everyone pending</Button>}</div>
              <Card><CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Designation</th><th>Location</th><th>Reporting manager</th></tr></thead>
                  <tbody>{data.not_responded.map(r => <tr key={r.user_id} className="border-b last:border-0"><td className="p-2"><div className="font-medium">{r.name}</div><div className="text-[11px] text-gray-500">{r.code}</div></td><td>{r.department}</td><td>{r.designation}</td><td className="text-xs">{r.location || '—'}</td><td className="text-xs">{r.manager || '—'}</td></tr>)}
                    {data.not_responded.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-green-600">Everyone has responded 🎉</td></tr>}</tbody></table>
              </CardContent></Card>
            </TabsContent>
          )}
        </Tabs>
      )}

      <Dialog open={!!detail} onOpenChange={o => !o && setDetail(null)}>
        <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{detail?.row?.name} — answers</DialogTitle></DialogHeader>
          {detail?.loading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div> : detail?.employee && (
            <div className="space-y-3">
              <div className="rounded-lg bg-gray-50 border p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
                <div><span className="text-gray-500 text-xs">Code</span><div>{detail.employee.code}</div></div><div><span className="text-gray-500 text-xs">Department</span><div>{detail.employee.department}</div></div>
                <div><span className="text-gray-500 text-xs">Designation</span><div>{detail.employee.designation}</div></div><div><span className="text-gray-500 text-xs">Reporting manager</span><div>{detail.employee.manager || '—'}</div></div>
                <div className="col-span-2"><span className="text-gray-500 text-xs">Submitted</span><div>{fmtDateTime(detail.submitted_at)}</div></div>
              </div>
              {detail.answers.map(a => (
                <div key={a.n} className="border-t pt-2"><div className="text-xs text-gray-500">{a.n}. {a.question} <span className="text-gray-400">· {typeLabel(a.type)}</span></div><div className="text-sm font-medium text-gray-800 mt-0.5 break-words">{a.answer === '' ? <span className="text-gray-400 font-normal">No answer</span> : a.answer}</div></div>
              ))}
              <p className="text-[11px] text-gray-400">Viewing this employee&apos;s answers has been recorded in the survey access log.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
