import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, ComposedChart, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { Loader2, Download, Info, ArrowUp, ArrowDown, Minus, AlertTriangle, Pencil, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { mis, downloadBase64, fmtDT } from '@/lib/mis';
import { Section, MiniTable, Unavailable } from '@/components/misx/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// ₹ in Indian grouping, and a short form (₹12.3 L / ₹1.2 Cr) for cards and chart axes
const inr = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`);
const short = (v) => { const x = Math.abs(Number(v) || 0), s = Number(v) < 0 ? '−' : ''; if (x >= 1e7) return `${s}₹${(x / 1e7).toFixed(2)} Cr`; if (x >= 1e5) return `${s}₹${(x / 1e5).toFixed(2)} L`; if (x >= 1e3) return `${s}₹${(x / 1e3).toFixed(1)} K`; return `${s}₹${Math.round(x)}`; };
const pctText = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const PAL = ['#1E4E8C', '#38BDF8', '#818CF8', '#F59E0B', '#10B981', '#EF4444', '#A7C4E8', '#9CA3AF'];
const axis = { fontSize: 11, fill: '#6B7280' };
const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
const Lbl = ({ t, children }) => <label className="text-[11px] text-gray-500 flex flex-col gap-1">{t}{children}</label>;
const tipFmt = (v) => inr(v);

// change vs a comparison: for cost, "up" is neutral-to-bad, so colour follows `more` (good / bad / neutral)
function Delta({ c, more = 'bad', label }) {
  if (!c || !c.prev) return <span className="text-[11px] text-gray-400">no comparison</span>;
  const up = c.abs > 0, flat = c.abs === 0;
  const good = more === 'neutral' ? null : (up === (more === 'good'));
  const tone = flat || good == null ? 'text-gray-500' : good ? 'text-green-700' : 'text-red-700';
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-1 text-[11px] ${tone}`}><Icon className="w-3 h-3" />{pctText(c.pct)}{label ? <span className="text-gray-400">{label}</span> : null}</span>;
}

const Kpi = ({ label, value, help, children, accent }) => (
  <div className={`rounded-xl border bg-white p-3 ${accent ? 'border-blue-300 ring-1 ring-blue-100' : 'border-gray-200'}`}>
    <div className="flex items-center justify-between gap-1"><span className="text-[11px] font-medium text-gray-500 leading-tight">{label}</span><span title={help} className="text-gray-300 hover:text-gray-500 cursor-help"><Info className="w-3.5 h-3.5" /></span></div>
    <div className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
    <div className="mt-0.5 min-h-[16px] space-y-0.5">{children}</div>
  </div>
);

const Chart = ({ title, sub, height = 270, children }) => (
  <div><div className="text-sm font-medium text-gray-800">{title}</div><div className="text-[11px] text-gray-500 mb-2">{sub}</div><div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></div>
);

export default function PayrollTab({ canCorrect }) {
  const [params, setParams] = useState({ mode: 'month', month: '', fy: '', from: '', to: '', department: 'all' });
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [edit, setEdit] = useState(null);       // payroll id being corrected
  const [moveTab, setMoveTab] = useState('significant');

  const load = useCallback(async (p) => {
    setLoading(true); setError('');
    try { setD(await mis('getPayrollAnalytics', { ...p, department: p.department === 'all' ? undefined : p.department })); }
    catch (e) { setError(e.message || 'Payroll analytics could not be loaded'); }
    setLoading(false);
  }, []);
  useEffect(() => { load(params); }, [params, load]);
  const set = (patch) => setParams(p => ({ ...p, ...patch }));

  // first load: adopt what the server resolved (latest month / FY) so the selectors show real values
  useEffect(() => {
    if (!d) return;
    setParams(p => {
      const next = { ...p };
      if (!p.month) next.month = d.period.months[d.period.months.length - 1];
      if (!p.fy) next.fy = String(d.period.fy ?? d.available_fys[0]?.value ?? '');
      if (!p.from) next.from = d.period.months[0];
      if (!p.to) next.to = d.period.months[d.period.months.length - 1];
      return JSON.stringify(next) === JSON.stringify(p) ? p : next;
    });
  }, [d]);

  const doExport = async () => {
    setExporting(true);
    try { const r = await mis('exportPayrollAnalytics', { ...params, department: params.department === 'all' ? undefined : params.department }); downloadBase64(r.base64, r.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); toast.success(`${r.filename} downloaded`); }
    catch (e) { toast.error('Export failed: ' + e.message); }
    setExporting(false);
  };

  const noData = d && !d.available_months.length;
  const s = d?.summary, cmp = d?.comparison;
  const trend = useMemo(() => (d?.trend || []).filter(t => t.has_data), [d]);
  const donut = useMemo(() => (d?.departments || []).slice(0, 8).map(x => ({ name: x.department, value: x.cost })), [d]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-end gap-3">
        <Lbl t="Report for">
          <select className={cls} value={params.mode} onChange={e => set({ mode: e.target.value })}><option value="month">A month</option><option value="fy">Financial year</option><option value="custom">Custom period</option></select>
        </Lbl>
        {params.mode === 'month' && <Lbl t="Month"><select className={cls} value={params.month} onChange={e => set({ month: e.target.value })}>{(d?.available_months || []).slice().reverse().map(m => <option key={m.ym} value={m.ym}>{m.label}</option>)}</select></Lbl>}
        {params.mode === 'fy' && <Lbl t="Financial year (Apr–Mar)"><select className={cls} value={params.fy} onChange={e => set({ fy: e.target.value })}>{(d?.available_fys || []).map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Lbl>}
        {params.mode === 'custom' && <><Lbl t="From month"><input type="month" className={cls} value={params.from} max={params.to || undefined} onChange={e => set({ from: e.target.value })} /></Lbl><Lbl t="To month"><input type="month" className={cls} value={params.to} min={params.from || undefined} onChange={e => set({ to: e.target.value })} /></Lbl></>}
        <Lbl t="Department"><select className={`${cls} max-w-[200px]`} value={params.department} onChange={e => set({ department: e.target.value })}><option value="all">All departments</option>{(d?.departments_all || []).map(x => <option key={x} value={x}>{x}</option>)}</select></Lbl>
        <div className="ml-auto flex items-center gap-2">
          {d && <span className="text-[11px] text-gray-500 text-right leading-snug">{d.period.label} · vs {d.period.prev_label}<br />and {d.period.yoy_label}</span>}
          <Button size="sm" variant="outline" onClick={doExport} disabled={exporting || !d || noData}>{exporting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}Export to Excel</Button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 flex items-start gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</div>}
      {!d && loading && <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" />Reading uploaded payslips…</div>}
      {noData && <Unavailable>No payslips have been uploaded yet. Upload them under <b>Payslip Upload</b> — this section builds itself from those payslips (nothing is calculated here).</Unavailable>}

      {d && !noData && (
        <div className={loading ? 'opacity-60 pointer-events-none transition-opacity space-y-4' : 'space-y-4'}>
          <div className="text-[11px] text-gray-500 bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2 leading-relaxed">
            <b className="text-gray-700">How to read this:</b> <b>Total payroll cost</b> = gross salary + employer contributions. <b>Net salary</b> is what employees take home. <b>Employee deductions</b> (PF, ESI, PT, TDS, loan, LOP…) come out of gross and are <u>not</u> an extra cost. Everything is read from the uploaded payslips{s.employer_coverage.of ? ` — employer contributions are printed on ${s.employer_coverage.with} of ${s.employer_coverage.of} payslips` : ''}.
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Total payroll cost" value={short(s.cost)} accent help="Gross salary + employer contributions"><div className="text-[11px] text-gray-500">{inr(s.cost)}</div><Delta c={cmp.previous.cost} label={`vs ${d.period.prev_label}`} /></Kpi>
            <Kpi label="Total gross salary" value={short(s.gross)} help="Total earnings printed on the payslips"><Delta c={cmp.previous.gross} label={`vs ${d.period.prev_label}`} /></Kpi>
            <Kpi label="Net salary disbursed" value={short(s.net)} help="Take-home pay paid to employees"><Delta c={cmp.previous.net} label={`vs ${d.period.prev_label}`} /></Kpi>
            <Kpi label="Employee deductions" value={short(s.deductions)} help="Taken out of gross salary — not an additional company expense"><div className="text-[11px] text-gray-500">not an extra cost</div></Kpi>
            <Kpi label="Employer contributions" value={short(s.employer)} help="Employer PF / ESI etc. where the payslip prints them"><div className="text-[11px] text-gray-500">on {s.employer_coverage.with} of {s.employer_coverage.of} payslips</div></Kpi>
            <Kpi label="Average gross per employee" value={short(s.avg_gross)} help="Gross salary ÷ employee-months"><Delta c={cmp.previous.avg_gross} more="neutral" label={`vs ${d.period.prev_label}`} /></Kpi>
            <Kpi label={d.period.months.length > 1 ? `Employees (${d.summary.last_month.label})` : 'Employees in payroll'} value={s.headcount} help="Distinct employees with a payslip"><Delta c={cmp.previous.headcount} more="neutral" label={`vs ${d.period.prev_label}`} />{d.period.months.length > 1 && <div className="text-[11px] text-gray-500">average {s.avg_headcount} a month</div>}</Kpi>
            <Kpi label={`Cost growth, ${s.last_month.label} vs ${s.last_month.prev_label}`} value={s.mom_growth_pct == null ? '—' : pctText(s.mom_growth_pct)} help="Month-on-month change in total payroll cost">{s.mom_growth_abs != null && <div className="text-[11px] text-gray-500">{s.mom_growth_abs >= 0 ? '+' : '−'}{short(Math.abs(s.mom_growth_abs))}</div>}</Kpi>
          </div>

          {/* readout */}
          <Section title="What changed" subtitle="A plain-language readout of this period's payroll.">
            <ul className="space-y-1.5">{d.insights.map((i, k) => <li key={k} className={`text-sm flex gap-2 ${i.level === 'warn' ? 'text-amber-900' : 'text-gray-700'}`}><span>{i.level === 'warn' ? '⚠' : '•'}</span><span>{i.text}</span></li>)}</ul>
          </Section>

          {/* charts */}
          <Section title="Payroll cost trends" subtitle={d.period.mode === 'month' ? 'The 12 months up to the selected month.' : 'Each month of the selected period.'}>
            <div className="grid gap-6 lg:grid-cols-2">
              <Chart title="Monthly payroll cost" sub="Total cost, gross and net salary">
                <LineChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} tickFormatter={short} width={64} /><Tooltip formatter={tipFmt} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="cost" name="Total payroll cost" stroke="#1E4E8C" strokeWidth={2.5} dot={{ r: 3 }} /><Line type="monotone" dataKey="gross" name="Gross" stroke="#38BDF8" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="net" name="Net" stroke="#10B981" strokeWidth={2} dot={false} /></LineChart>
              </Chart>
              <Chart title={`${d.period.label} vs ${d.period.prev_label}`} sub="Current period against the previous one">
                <BarChart data={[{ k: 'Gross', cur: s.gross, prev: d.previous.gross }, { k: 'Net', cur: s.net, prev: d.previous.net }, { k: 'Employer contrib.', cur: s.employer, prev: d.previous.employer }, { k: 'Total cost', cur: s.cost, prev: d.previous.cost }]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="k" tick={axis} /><YAxis tick={axis} tickFormatter={short} width={64} /><Tooltip formatter={tipFmt} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="cur" name={d.period.label} fill="#1E4E8C" radius={[3, 3, 0, 0]} /><Bar dataKey="prev" name={d.period.prev_label} fill="#A7C4E8" radius={[3, 3, 0, 0]} /></BarChart>
              </Chart>
              <Chart title="Department-wise payroll cost" sub="Total payroll cost per department" height={Math.max(250, d.departments.length * 30)}>
                <BarChart layout="vertical" data={d.departments.slice(0, 14)} margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" tick={axis} tickFormatter={short} /><YAxis type="category" dataKey="department" tick={axis} width={110} /><Tooltip formatter={tipFmt} /><Bar dataKey="cost" name="Total payroll cost" fill="#1E4E8C" radius={[0, 3, 3, 0]} /></BarChart>
              </Chart>
              <Chart title="Department contribution to payroll" sub="Share of total payroll cost">
                <PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={2}>{donut.map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}</Pie><Tooltip formatter={tipFmt} /><Legend wrapperStyle={{ fontSize: 11 }} layout="vertical" align="right" verticalAlign="middle" /></PieChart>
              </Chart>
              <Chart title="Headcount vs payroll cost" sub="Employees (line) against cost (bars) by department" height={Math.max(270, 270)}>
                <ComposedChart data={d.departments.slice(0, 12)}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="department" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} /><YAxis yAxisId="l" tick={axis} tickFormatter={short} width={64} /><YAxis yAxisId="r" orientation="right" tick={axis} width={36} /><Tooltip formatter={(v, n) => (n === 'Employees' ? v : inr(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="cost" name="Payroll cost" fill="#A7C4E8" radius={[3, 3, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="headcount" name="Employees" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} /></ComposedChart>
              </Chart>
              <Chart title="Headcount and cost over time" sub="Monthly employees (line) against total cost (bars)">
                <ComposedChart data={trend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={axis} /><YAxis yAxisId="l" tick={axis} tickFormatter={short} width={64} /><YAxis yAxisId="r" orientation="right" tick={axis} width={36} /><Tooltip formatter={(v, n) => (n === 'Employees' ? v : inr(v))} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="cost" name="Payroll cost" fill="#A7C4E8" radius={[3, 3, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="headcount" name="Employees" stroke="#1E4E8C" strokeWidth={2} dot={{ r: 3 }} /></ComposedChart>
              </Chart>
            </div>
          </Section>

          {/* department table */}
          <Section title="Department-wise payroll" subtitle={`Variance is against ${d.period.prev_label}. Share is the department's part of the total payroll cost.`}>
            <MiniTable
              heads={['Department', 'Employees', 'Gross', 'Net', 'Employer contrib.', 'Total cost', 'Avg gross', 'Share', 'Share change', `Cost vs ${d.period.prev_label}`, `vs ${d.period.yoy_label}`]}
              rows={d.departments.map(x => [<b key="n">{x.department}</b>, x.headcount, inr(x.gross), inr(x.net), inr(x.employer), <b key="c">{inr(x.cost)}</b>, inr(x.avg_gross), `${x.share_pct}%`,
                x.prev_cost ? <span key="sc" className={x.share_change_pts > 0 ? 'text-amber-700' : 'text-gray-600'}>{x.share_change_pts > 0 ? '+' : ''}{x.share_change_pts} pts</span> : '—',
                x.prev_cost ? <span key="v" className={x.variance > 0 ? 'text-red-700' : x.variance < 0 ? 'text-green-700' : ''}>{x.variance > 0 ? '+' : ''}{inr(x.variance)} ({pctText(x.variance_pct)})</span> : <span key="nw" className="text-gray-400">new</span>,
                x.yoy_cost ? pctText(x.yoy_variance_pct) : '—'])}
              empty="No department data for this period." />
            {d.departments.length > 0 && <p className="text-[11px] text-gray-500 mt-2">Highest: <b>{d.departments[0].department}</b> ({d.departments[0].share_pct}%) · Lowest: <b>{d.departments[d.departments.length - 1].department}</b> ({d.departments[d.departments.length - 1].share_pct}%). Department is the one printed on each month's payslip, so past months keep their original department.</p>}
          </Section>

          {/* comparisons */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Month-on-month and year-on-year" subtitle={`${d.period.label} against ${d.period.prev_label} and ${d.period.yoy_label}.`}>
              <MiniTable heads={['Measure', d.period.label, d.period.prev_label, 'Change', d.period.yoy_label, 'Change']}
                rows={[['Total cost', 'cost', inr], ['Gross salary', 'gross', inr], ['Net salary', 'net', inr], ['Employees', 'headcount', (v) => v], ['Avg gross', 'avg_gross', inr]].map(([label, k, f]) => [
                  <b key="l">{label}</b>, f(cmp.previous[k].cur), cmp.previous[k].prev ? f(cmp.previous[k].prev) : '—', cmp.previous[k].prev ? <span key="a">{cmp.previous[k].abs > 0 ? '+' : ''}{f(cmp.previous[k].abs)} ({pctText(cmp.previous[k].pct)})</span> : '—',
                  cmp.year_ago[k].prev ? f(cmp.year_ago[k].prev) : '—', cmp.year_ago[k].prev ? <span key="b">{pctText(cmp.year_ago[k].pct)}</span> : '—'])} />
              {!cmp.has_previous && <p className="text-[11px] text-gray-500 mt-2">No payslips for {d.period.prev_label} yet, so there is nothing to compare with.</p>}
            </Section>
            <Section title={d.period.mode === 'month' ? 'This month, every year' : 'Financial years'} subtitle="Growth in cost, headcount and average salary from one year to the next.">
              <MiniTable heads={['Period', 'Employees', 'Total cost', 'Avg gross', 'Cost growth', 'Headcount', 'Avg salary']}
                rows={d.yoy_table.map(r => [<b key="p">{r.label}</b>, r.headcount, short(r.cost), inr(r.avg_gross), pctText(r.growth_pct), pctText(r.headcount_growth_pct), pctText(r.avg_growth_pct)])} empty="Only one year of payslips so far." />
            </Section>
          </div>

          {/* average salary */}
          <Section title="Average salary analysis" subtitle="Gross salary per employee-month in this period.">
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="grid grid-cols-2 gap-2 content-start">{[['Average', d.salary.average], ['Median', d.salary.median], ['Lowest', d.salary.min], ['Highest', d.salary.max]].map(([l, v]) => <div key={l} className="rounded-lg border p-3"><div className="text-lg font-bold">{inr(v)}</div><div className="text-xs text-gray-500">{l} gross</div></div>)}
                <div className="col-span-2 rounded-lg border p-3 text-xs text-gray-600">Basic {inr(d.salary.components.basic)} · HRA {inr(d.salary.components.hra)} · Other allowances {inr(d.salary.components.other_allowances)}</div></div>
              <Chart title="Employees by gross salary" sub="Number of employee-months in each band" height={230}><BarChart data={d.salary.bands}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={{ ...axis, fontSize: 10 }} /><YAxis tick={axis} allowDecimals={false} width={30} /><Tooltip /><Bar dataKey="count" name="Employees" fill="#1E4E8C" radius={[3, 3, 0, 0]} /></BarChart></Chart>
              <Chart title="Average gross by department" sub="Highest first" height={Math.max(230, d.salary.by_department.length * 26)}><BarChart layout="vertical" data={d.salary.by_department.slice(0, 12)} margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" tick={axis} tickFormatter={short} /><YAxis type="category" dataKey="department" tick={axis} width={100} /><Tooltip formatter={tipFmt} /><Bar dataKey="avg_gross" name="Avg gross" fill="#38BDF8" radius={[0, 3, 3, 0]} /></BarChart></Chart>
            </div>
          </Section>

          {/* movements */}
          <Section title={`Employee cost movements — ${d.movements.label} vs ${d.movements.base_label}`}
            subtitle="Why total cost moved: people who joined, people who left, and everyone who stayed (increments, LOP, bonus, allowances).">
            {!d.movements.has_base ? <Unavailable>There are no payslips for {d.movements.base_label}, so movements cannot be worked out.</Unavailable> : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  {[['Joiners added', d.movements.drivers.joiners_cost, `${d.movements.counts.joiners} employee(s)`], ['Exits removed', d.movements.drivers.exits_cost, `${d.movements.counts.exits} employee(s)`], ['Employees who stayed', d.movements.drivers.existing_change, `${d.movements.counts.increments} up · ${d.movements.counts.decreases} down`]].map(([l, v, sub]) => (
                    <div key={l} className="rounded-lg border p-3"><div className={`text-lg font-bold ${v > 0 ? 'text-red-700' : v < 0 ? 'text-green-700' : ''}`}>{v > 0 ? '+' : v < 0 ? '−' : ''}{short(Math.abs(v))}</div><div className="text-xs text-gray-500">{l} · {sub}</div></div>))}
                </div>
                <div className="flex flex-wrap gap-1 border-b mb-2">{[['significant', `Significant changes (${d.movements.counts.significant})`], ['increments', `Increases (${d.movements.counts.increments})`], ['decreases', `Decreases (${d.movements.counts.decreases})`], ['joiners', `Joiners (${d.movements.counts.joiners})`], ['exits', `Not in this month (${d.movements.counts.exits})`], ['structure_changes', `Structure changes (${d.movements.counts.structure_changes})`]].map(([id, l]) => <button key={id} onClick={() => setMoveTab(id)} className={`px-3 py-1.5 text-sm border-b-2 -mb-px ${moveTab === id ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500'}`}>{l}</button>)}</div>
                {['significant', 'increments', 'decreases'].includes(moveTab) && <MiniTable heads={['Code', 'Employee', 'Department', d.movements.base_label, d.movements.label, 'Change', '%', 'LOP days']} rows={d.movements[moveTab].map(x => [x.code, x.name, x.department, inr(x.prev_gross), inr(x.gross), <span key="d" className={x.delta > 0 ? 'text-red-700' : 'text-green-700'}>{x.delta > 0 ? '+' : ''}{inr(x.delta)}</span>, pctText(x.pct), x.lop_days || x.prev_lop_days ? `${x.prev_lop_days} → ${x.lop_days}` : '—'])} empty="None." />}
                {moveTab === 'joiners' && <MiniTable heads={['Code', 'Employee', 'Department', 'Gross', 'Total cost', '']} rows={d.movements.joiners.map(x => [x.code, x.name, x.department, inr(x.gross), inr(x.cost), x.returning ? 'returning' : 'new'])} empty="No joiners." />}
                {moveTab === 'exits' && <MiniTable heads={['Code', 'Employee', 'Department', `Gross ${d.movements.base_label}`, 'Cost removed']} rows={d.movements.exits.map(x => [x.code, x.name, x.department, inr(x.gross), inr(x.cost)])} empty="Nobody dropped out of payroll." />}
                {moveTab === 'structure_changes' && <MiniTable heads={['Code', 'Employee', 'Department', `Basic share ${d.movements.base_label}`, `Basic share ${d.movements.label}`]} rows={d.movements.structure_changes.map(x => [x.code, x.name, x.department, `${x.prev_basic_share}%`, `${x.basic_share}%`])} empty="No change in salary structure." />}
              </>
            )}
          </Section>

          {/* data quality */}
          <Section title="Payslip data review" subtitle="Records the extraction could not fully read or that do not add up. Figures above include them as extracted until corrected."
            right={<span className="text-xs text-gray-500">{d.data_quality.records} records · {d.data_quality.corrected} corrected · {d.data_quality.duplicates_removed} duplicate upload(s) replaced</span>}>
            {d.data_quality.flagged.length === 0 ? <p className="text-sm text-green-700">Every payslip record in this period reads cleanly and reconciles (gross − deductions = net).</p> : (
              <MiniTable heads={['Month', 'Code', 'Employee', 'Department', 'Gross', 'Net', 'Why it needs a look', canCorrect ? '' : '']}
                rows={d.data_quality.flagged.map(f => [f.label, f.code, f.name, f.department, inr(f.gross), inr(f.net), <span key="i" className="text-amber-900 text-xs">{[...f.issues, ...f.warnings].join(' · ')}</span>, canCorrect ? <Button key="e" size="sm" variant="outline" onClick={() => setEdit(f.id)}><Pencil className="w-3.5 h-3.5 mr-1" />Correct</Button> : ''])} />
            )}
            {d.data_quality.flagged_count > d.data_quality.flagged.length && <p className="text-xs text-gray-500 mt-1">Showing the first {d.data_quality.flagged.length} of {d.data_quality.flagged_count}.</p>}
            <div className="grid gap-4 lg:grid-cols-2 mt-5">
              <div>
                <div className="text-sm font-medium text-gray-800 mb-1">No payslip for {d.data_quality.missing_payslips.month} ({d.data_quality.missing_payslips.count})</div>
                {d.data_quality.missing_payslips.count === 0 ? <p className="text-sm text-gray-500">Every active employee has a payslip.</p> : <MiniTable heads={['Code', 'Employee', 'Department']} rows={d.data_quality.missing_payslips.list.map(x => [x.code, x.name, x.department])} />}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-800 mb-1">Upload history</div>
                <p className="text-[11px] text-gray-500 mb-1">This period: {d.data_quality.upload_totals.mapped} read · {d.data_quality.upload_totals.unmapped} not matched to an employee · {d.data_quality.upload_totals.duplicate} duplicate · {d.data_quality.upload_totals.password_failed + d.data_quality.upload_totals.invalid + d.data_quality.upload_totals.extraction_failed} unreadable</p>
                <MiniTable heads={['Payroll month', 'Uploaded', 'Files', 'Read', 'Problems']} rows={d.data_quality.upload_history.map(b => [b.label, fmtDT(b.uploaded_at), b.counts?.total ?? '—', b.counts?.mapped ?? '—', (b.counts?.unmapped || 0) + (b.counts?.duplicate || 0) + (b.counts?.invalid || 0) + (b.counts?.password_failed || 0) + (b.counts?.extraction_failed || 0)])} empty="No uploads recorded for this period." />
              </div>
            </div>
          </Section>
        </div>
      )}
      {edit && <CorrectDialog id={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(params); }} />}
    </div>
  );
}

const FIELDS = [['gross_salary', 'Gross salary'], ['basic_salary', 'Basic'], ['hra', 'HRA'], ['conveyance', 'Conveyance'], ['special_allowance', 'Other allowances'], ['incentive', 'Incentive'], ['overtime', 'Overtime'], ['bonus', 'Bonus']];
const DED = [['pf', 'PF'], ['esi', 'ESI'], ['professional_tax', 'Professional tax'], ['tds', 'TDS / income tax'], ['loan', 'Loan / advance'], ['lop', 'LOP deduction'], ['other', 'Other deductions']];
const EMP = [['pf', 'Employer PF'], ['esi', 'Employer ESI'], ['other', 'Other employer']];

function CorrectDialog({ id, onClose, onSaved }) {
  const [rec, setRec] = useState(null);
  const [vals, setVals] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { mis('getPayslipRecord', { payroll_id: id }).then(r => setRec(r.record)).catch(e => { toast.error(e.message); onClose(); }); }, [id]);
  const val = (path, orig) => (path in vals ? vals[path] : orig ?? '');
  const num = (path, orig) => Number(String(val(path, orig)).replace(/,/g, '')) || 0;
  const gross = rec && num('gross_salary', rec.gross_salary), ded = rec && num('total_deductions', rec.total_deductions), net = rec && num('net_salary', rec.net_salary);
  const diff = rec ? Math.round((gross - ded - net) * 100) / 100 : 0;
  const save = async () => {
    const changes = { deductions: {}, employer_contributions: {} };
    for (const [path, v] of Object.entries(vals)) {
      if (path.startsWith('d.')) changes.deductions[path.slice(2)] = v; else if (path.startsWith('e.')) changes.employer_contributions[path.slice(2)] = v; else changes[path] = v;
    }
    setBusy(true);
    try {
      const r = await mis('correctPayslipData', { payroll_id: id, reason, changes });
      toast.success(r.reconciles ? 'Corrected — the figures now reconcile' : `Saved — gross − deductions − net still differs by ₹${r.difference}`);
      onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const input = (path, orig) => <input inputMode="decimal" className="h-8 w-full rounded border border-gray-300 px-2 text-sm text-right tabular-nums" value={val(path, orig)} onChange={e => setVals(v => ({ ...v, [path]: e.target.value }))} />;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Correct payslip figures{rec ? ` — ${rec.employee_code}, ${String(rec.month).padStart(2, '0')}/${rec.year}` : ''}</DialogTitle></DialogHeader>
        {!rec ? <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div> : (
          <div className="space-y-4 text-sm">
            {rec.warnings?.length > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900 space-y-0.5">{rec.warnings.map((w, i) => <div key={i}>• {w}</div>)}</div>}
            {rec.file_url && <a href={rec.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"><ExternalLink className="w-3 h-3" />Open the uploaded payslip PDF to compare</a>}
            <div><div className="font-medium text-gray-800 mb-1">Earnings</div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{FIELDS.map(([k, l]) => <label key={k} className="text-[11px] text-gray-500">{l}{input(k, rec[k])}</label>)}</div></div>
            <div><div className="font-medium text-gray-800 mb-1">Employee deductions</div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{DED.map(([k, l]) => <label key={k} className="text-[11px] text-gray-500">{l}{input('d.' + k, rec.deductions?.[k])}</label>)}<label className="text-[11px] text-gray-500">Total deductions{input('total_deductions', rec.total_deductions)}</label><label className="text-[11px] text-gray-500">Net salary{input('net_salary', rec.net_salary)}</label></div></div>
            <div><div className="font-medium text-gray-800 mb-1">Employer contributions <span className="text-[11px] font-normal text-gray-400">(if the payslip prints them)</span></div><div className="grid grid-cols-3 gap-2">{EMP.map(([k, l]) => <label key={k} className="text-[11px] text-gray-500">{l}{input('e.' + k, rec.employer_contributions?.[k])}</label>)}</div></div>
            <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">Department{<input className="h-8 w-full rounded border border-gray-300 px-2 text-sm" value={val('department', rec.department)} onChange={e => setVals(v => ({ ...v, department: e.target.value }))} />}</label><label className="text-[11px] text-gray-500">Designation{<input className="h-8 w-full rounded border border-gray-300 px-2 text-sm" value={val('designation', rec.designation)} onChange={e => setVals(v => ({ ...v, designation: e.target.value }))} />}</label></div>
            <div className={`rounded-lg border p-2 text-xs ${Math.abs(diff) <= 5 ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>Gross {inr(gross)} − deductions {inr(ded)} = {inr(gross - ded)}; net on payslip {inr(net)}. {Math.abs(diff) <= 5 ? 'Reconciles.' : `Differs by ${inr(Math.abs(diff))}.`}</div>
            <label className="block text-[11px] text-gray-500">Reason for the correction (kept on the record)<textarea rows={2} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Net salary misread from the PDF" /></label>
            {rec.corrections?.length > 0 && <div className="text-[11px] text-gray-500">Earlier corrections: {rec.corrections.map(c => `${fmtDT(c.at)} — ${c.reason}`).join('; ')}</div>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !Object.keys(vals).length || reason.trim().length < 5}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save correction</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
