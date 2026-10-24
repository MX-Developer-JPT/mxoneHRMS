import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line, Cell } from 'recharts';
import { toast } from 'sonner';
import { mis, fmtD, fmtDT, num } from '@/lib/mis';
import { Section, Pill, KpiGrid, MiniTable, Register, Unavailable, Chg } from '@/components/misx/common';

const COL = { present: '#1E4E8C', half: '#7DA3D6', wfh: '#38BDF8', od: '#818CF8', leave: '#A7C4E8', absent: '#EF4444', missing: '#F59E0B', blue: '#2D5986', grey: '#9CA3AF' };
const periodText = (d) => `${fmtD(d.meta.period.from)} – ${fmtD(d.meta.period.to)}`;
const axis = { fontSize: 11, fill: '#6B7280' };

const Chart = ({ title, sub, height = 260, children }) => (
  <div>
    <div className="text-sm font-medium text-gray-800">{title}</div>
    <div className="text-[11px] text-gray-500 mb-2">{sub}</div>
    <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
  </div>
);
const tick = (d) => (d ? d.slice(8) + '/' + d.slice(5, 7) : '');
const Grid = ({ cols = 2, children }) => <div className={`grid gap-4 ${cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>{children}</div>;
const Stat = ({ label, value, sub }) => (<div className="rounded-lg border bg-white p-3"><div className="text-xl font-bold text-gray-900">{num(value)}</div><div className="text-xs text-gray-500">{label}</div>{sub && <div className="text-[11px] text-gray-400">{sub}</div>}</div>);


// ───────────────────────────── Overview
export function OverviewTab({ d, setTab, onOpenInsight }) {
  const A = d.attendance;
  const top = d.insights.filter(i => i.status !== 'Dismissed' && i.status !== 'Resolved').slice(0, 5);
  return (
    <div className="space-y-4">
      <KpiGrid kpis={d.kpis} onOpen={(link) => setTab(link)} />
      <p className="text-[11px] text-gray-500">ED = employee-days. Headcount counts people; attendance cards count employee-days and are never added to headcount. Hover the <span className="font-medium">ⓘ</span> on a card for its formula; click a card to open its detail.</p>
      <Section title="Management highlights" subtitle="Generated from verified records by explicit rules — open an insight to see the evidence and the rule that raised it." right={<button className="text-xs text-blue-700 hover:underline" onClick={() => setTab('insights')}>All {d.insights.length} insights →</button>}>
        {!top.length ? <p className="text-sm text-gray-500">No open insights for this period.</p> : (
          <div className="space-y-2">{top.map(i => (
            <button key={i.key} onClick={() => onOpenInsight(i)} className="w-full text-left flex items-start gap-3 rounded-lg border p-3 hover:bg-gray-50">
              <Pill sev={i.severity} /><div className="min-w-0"><div className="text-sm font-medium text-gray-900">{i.title}</div><div className="text-xs text-gray-500 mt-0.5">{i.action}</div></div>
            </button>))}</div>
        )}
      </Section>
      <Section title="Attendance composition by day" subtitle={`Scheduled employee-days per day, ${periodText(d)}. Weekly offs and holidays are excluded.`}>
        <Chart title="Daily attendance composition" sub="Unit: employee-days · stacked by category">
          <BarChart data={A.trend} margin={{ left: -10, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={tick} tick={axis} /><YAxis tick={axis} /><Tooltip labelFormatter={fmtD} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="present" name="Present (physical)" stackId="a" fill={COL.present} /><Bar dataKey="half" name="Half-day" stackId="a" fill={COL.half} /><Bar dataKey="wfh" name="WFH" stackId="a" fill={COL.wfh} /><Bar dataKey="od" name="On duty" stackId="a" fill={COL.od} /><Bar dataKey="leave" name="Leave" stackId="a" fill={COL.leave} /><Bar dataKey="absent" name="Absent" stackId="a" fill={COL.absent} /><Bar dataKey="missing" name="Missing record" stackId="a" fill={COL.missing} />
          </BarChart>
        </Chart>
      </Section>
    </div>
  );
}

// ───────────────────────────── Attendance
export function AttendanceTab({ d, params }) {
  const A = d.attendance, T = A.total, P = A.prevTotal, R = d.regularisation;
  const rows = [['Present', 'present'], ['Late', 'late'], ['Short attendance', 'short'], ['Half-day', 'half'], ['Work from home', 'wfh'], ['On duty', 'od'], ['Approved leave', 'leave'], ['Absent', 'absent'], ['Missing record', 'missing']];
  const deptBars = d.departments.filter(x => x.compliance != null && x.sched >= (d.meta.config?.minSample ?? 30)).sort((a, b) => a.compliance - b.compliance);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Scheduled employee-days" value={T.sched} sub={`${d.meta.attendanceEmployees} employees`} />
        <Stat label="Physical presence rate" value={T.rates.physical == null ? 'n/a' : `${T.rates.physical}%`} sub="(present+late+short+½ half) ÷ scheduled" />
        <Stat label="Attendance compliance" value={T.rates.compliance == null ? 'n/a' : `${T.rates.compliance}%`} sub="(scheduled − absent − missing) ÷ scheduled" />
        <Stat label="Late arrivals" value={T.lateArrivals} sub={P ? `was ${P.lateArrivals}` : ''} />
        <Stat label="Incomplete punch sessions" value={T.incomplete} />
        <Stat label="Average hours worked" value={T.avgHours ?? 'n/a'} sub={`${T.hoursDays} days with full punches`} />
      </div>
      <Grid>
        <Section title="Attendance composition" subtitle="Each scheduled employee-day is counted once, in exactly one category. Leave, WFH and OD are not physical presence.">
          <MiniTable heads={['Category', 'Employee-days', '% of scheduled', 'Comparison']} rows={[...rows.map(([l, k]) => [l, num(T[k]), T.sched ? `${Math.round(T[k] / T.sched * 1000) / 10}%` : 'n/a', P ? num(P[k]) : 'n/a']), [<b key="t">Scheduled</b>, <b key="s">{num(T.sched)}</b>, '100%', P ? num(P.sched) : 'n/a']]} />
        </Section>
        <Section title="Compliance by department" subtitle="Departments with at least the minimum sample of scheduled employee-days (a rate on a tiny sample misleads).">
          <Chart title="Attendance compliance %" sub={`${periodText(d)} · unit: % of scheduled employee-days`} height={Math.max(180, deptBars.length * 24)}>
            <BarChart data={deptBars} layout="vertical" margin={{ left: 60, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} tick={axis} /><YAxis type="category" dataKey="dept" tick={axis} width={110} /><Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="compliance" name="Compliance %">{deptBars.map((x, i) => <Cell key={i} fill={x.compliance < 85 ? COL.absent : COL.present} />)}</Bar></BarChart>
          </Chart>
        </Section>
      </Grid>
      <Section title="Daily trend" subtitle="Physical presence and compliance rate per scheduled day.">
        <Chart title="Daily rates" sub={`${periodText(d)} · unit: %`}>
          <LineChart data={A.trend.filter(x => x.sched)} margin={{ left: -10, right: 8 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={tick} tick={axis} /><YAxis domain={[0, 100]} tick={axis} /><Tooltip labelFormatter={fmtD} formatter={(v) => `${v}%`} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="physical" name="Physical presence %" stroke={COL.present} dot={false} strokeWidth={2} /><Line type="monotone" dataKey="compliance" name="Compliance %" stroke="#16A34A" dot={false} strokeWidth={2} /></LineChart>
        </Chart>
      </Section>
      <Section title="Regularisation" subtitle="Requests submitted in the period. The backlog is today's snapshot of everything still waiting.">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
          {[['Submitted', R.counts.total, R.prev?.total], ['Pending (manager)', R.counts.pending, R.prev?.pending], ['Awaiting HR', R.counts.awaitingHr, R.prev?.awaitingHr], ['Approved', R.counts.approved, R.prev?.approved], ['Rejected', R.counts.rejected, R.prev?.rejected], ['Submitted late', R.counts.late, R.prev?.late], ['Avg approval (h)', R.counts.avgApprovalHours ?? 'n/a', R.prev?.avgApprovalHours], ['Backlog beyond SLA', R.backlogOverSla, null]].map(([l, v, p]) => <Stat key={l} label={l} value={v} sub={p != null ? `was ${p}` : ''} />)}
        </div>
        <Grid>
          <div><div className="text-sm font-medium mb-1">Approvers with pending requests</div><MiniTable heads={['Approver', 'Pending', 'Over SLA', 'Oldest (d)']} rows={R.managers.map(m => [m.name, m.pending, m.overSla, m.oldest])} empty="No pending requests." /></div>
          <div><div className="text-sm font-medium mb-1">Requests by department</div><MiniTable heads={['Department', 'Requests']} rows={Object.entries(R.byDept).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])} empty="None in this period." /></div>
        </Grid>
        <p className="text-[11px] text-gray-500 mt-2">{R.counts.afterCutoff} request(s) were approved after the month they relate to had closed (attendance modified after the reporting cut-off).</p>
      </Section>
      <Register kind="regularisation" params={params} title="Regularisation register" subtitle="Employee, date, original and revised attendance, reason, status, approver and timestamps."
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'date', label: 'Date', render: r => fmtD(r.date) }, { key: 'original', label: 'Original' }, { key: 'revised', label: 'Revised / reason type' }, { key: 'reason', label: 'Reason', cls: 'max-w-xs' }, { key: 'status', label: 'Status' }, { key: 'approver', label: 'Approver' }, { key: 'approvedAt', label: 'Approved', render: r => fmtDT(r.approvedAt) }, { key: 'lateBy', label: 'Days late', render: r => (r.lateBy > 0 ? r.lateBy : '') }]} />
      <Register kind="employees_attendance" params={params} title="Employee-wise attendance" subtitle="Employee-days in the selected period."
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'scheduled', label: 'Sched.' }, { key: 'present', label: 'Present' }, { key: 'late', label: 'Late' }, { key: 'half', label: 'Half' }, { key: 'wfh', label: 'WFH' }, { key: 'od', label: 'OD' }, { key: 'leave', label: 'Leave' }, { key: 'absent', label: 'Absent' }, { key: 'missing', label: 'Missing' }, { key: 'hours', label: 'Hours' }, { key: 'compliancePct', label: 'Compl. %' }]} />
    </div>
  );
}

// ───────────────────────────── Exceptions
export function ExceptionsTab({ d, params }) {
  const [view, setView] = useState('attendance');
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs p-3">Exceptions are <b>indicators to verify</b>, not findings about conduct. Each row shows the observed value, the baseline it was compared with, why it was raised and what to check. Weekly offs, holidays and approved exemptions are never flagged.</div>
      <div className="flex gap-2 flex-wrap">{[['attendance', `Attendance (${d.attendance.exceptionCount})`], ['leave', `Leave patterns (${d.leave.patternCount})`]].map(([id, l]) => <button key={id} onClick={() => setView(id)} className={`h-8 px-3 rounded-full text-sm border ${view === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'}`}>{l}</button>)}</div>
      {view === 'attendance' ? (
        <Register kind="exceptions" params={params} title="Attendance exceptions" pageSize={20}
          columns={[{ key: 'sev', label: 'Severity', render: r => <Pill sev={r.sev} /> }, { key: 'type', label: 'Exception' }, { key: 'name', label: 'Employee / department', render: r => <span>{r.name ? `${r.name} ` : ''}<span className="text-xs text-gray-400">{r.code} {r.dept}</span></span> }, { key: 'observed', label: 'Observed' }, { key: 'baseline', label: 'Expected baseline' }, { key: 'variance', label: 'Variance' }, { key: 'dates', label: 'Dates' }, { key: 'why', label: 'Why flagged', cls: 'max-w-xs' }, { key: 'verify', label: 'Recommended verification', cls: 'max-w-xs' }]} />
      ) : (
        <Register kind="leave_patterns" params={params} title="Leave-pattern indicators" pageSize={20}
          columns={[{ key: 'sev', label: 'Severity', render: r => <Pill sev={r.sev} /> }, { key: 'type', label: 'Indicator' }, { key: 'name', label: 'Employee / department', render: r => <span>{r.name || r.dept} <span className="text-xs text-gray-400">{r.code}</span></span> }, { key: 'observed', label: 'Observed' }, { key: 'baseline', label: 'Baseline' }, { key: 'dates', label: 'Dates' }, { key: 'why', label: 'Why flagged', cls: 'max-w-xs' }, { key: 'verify', label: 'Verification', cls: 'max-w-xs' }]} />
      )}
    </div>
  );
}

// ───────────────────────────── Leave
export function LeaveTab({ d, params }) {
  const L = d.leave, c = L.counts, p = L.prev;
  const [win, setWin] = useState(String(Object.keys(L.noLeave)[2] || Object.keys(L.noLeave)[0]));
  const nl = L.noLeave[win];
  const types = Object.entries(L.byType).map(([k, v]) => ({ k, v }));
  const trend = Object.entries(L.trend).sort().map(([k, v]) => ({ k, v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[['Requests submitted', c.requests, p?.requests], ['Approved', c.approved, p?.approved], ['Pending', c.pending, p?.pending], ['Rejected', c.rejected, p?.rejected], ['Cancelled', c.cancelled, p?.cancelled], ['Approved leave days', c.approvedDays, p?.approvedDays], ['Avg duration (days)', c.avgDuration ?? 'n/a', p?.avgDuration], ['Short-notice requests', c.shortNotice, p?.shortNotice]].map(([l, v, pv]) => <Stat key={l} label={l} value={v} sub={pv != null ? `was ${pv}` : ''} />)}
      </div>
      <p className="text-[11px] text-gray-500">Requests are counted by the day they were submitted; leave days are the approved days that fall inside the period on scheduled workdays (a half-day counts ½).</p>
      <Grid>
        <Section title="Approved leave days by type"><Chart title="Leave days by type" sub={`${periodText(d)} · unit: days`} height={220}><BarChart data={types} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="k" tick={axis} /><YAxis tick={axis} /><Tooltip /><Bar dataKey="v" name="Days" fill={COL.blue} /></BarChart></Chart></Section>
        <Section title="Monthly trend (12 months)"><Chart title="Approved leave days per month" sub="Unit: days · ends at the period end" height={220}><LineChart data={trend} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="k" tick={axis} /><YAxis tick={axis} /><Tooltip /><Line type="monotone" dataKey="v" name="Days" stroke={COL.present} strokeWidth={2} /></LineChart></Chart></Section>
      </Grid>
      <Section title="Employees with no leave applications" subtitle="Not good or bad by itself. Each person is classified from their attendance evidence in the window; only 'Requires review' and 'Absences without leave applications' need a look."
        right={<div className="flex gap-1">{Object.keys(L.noLeave).map(w => <button key={w} onClick={() => setWin(w)} className={`h-8 px-3 rounded-full text-sm border ${win === w ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'}`}>{w} days</button>)}</div>}>
        <p className="text-xs text-gray-500 mb-3">Window {fmtD(nl.from)} – {fmtD(nl.to)} · <b>{nl.total}</b> employee(s) with no leave request in the window.</p>
        <MiniTable heads={['Classification', 'Employees']} rows={Object.entries(nl.byClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])} />
      </Section>
      <Register kind={`no_leave_${win}`} params={params} title={`Evidence — no leave application in the last ${win} days`} pageSize={15}
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'class', label: 'Classification' }, { key: 'scheduled', label: 'Scheduled days' }, { key: 'physical', label: 'Physical days' }, { key: 'wfh', label: 'WFH' }, { key: 'od', label: 'OD' }, { key: 'regularisations', label: 'Regularisations' }, { key: 'absentUnexplained', label: 'Unexplained absences' }, { key: 'missing', label: 'Missing' }, { key: 'why', label: 'Evidence', cls: 'max-w-sm' }]} />
      <Section title="Leave balances (as stored)" subtitle="Allocation rules differ by policy, so utilisation against entitlement is indicative.">
        <MiniTable heads={['Policy', 'Employees', 'Allocated', 'Accrued this year', 'Carried forward', 'Used', 'Used % of allocated + carried']} rows={(L.balances || []).map(b => [b.code, b.employees, b.allocated, b.accrued, b.carried, b.used, b.utilisation == null ? 'n/a' : `${b.utilisation}%`])} empty="No balance records for this year." />
      </Section>
      {!!L.pendingLong.length && <Section title="Leave pending for a long time"><MiniTable heads={['Employee', 'Department', 'Waiting (days)']} rows={L.pendingLong.map(x => [x.name, x.dept, x.age])} /></Section>}
      <Register kind="leave" params={params} title="Leave requests submitted in the period" pageSize={15}
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'type', label: 'Type' }, { key: 'from', label: 'From', render: r => fmtD(r.from) }, { key: 'to', label: 'To', render: r => fmtD(r.to) }, { key: 'days', label: 'Days' }, { key: 'status', label: 'Status' }, { key: 'applied', label: 'Applied', render: r => fmtD(r.applied) }, { key: 'notice', label: 'Notice (d)' }]} />
    </div>
  );
}

// ───────────────────────────── Workforce
export function WorkforceTab({ d, params, applyFilter }) {
  const W = d.workforce, rc = W.recruitment, co = W.company, pc = W.prevCompany;
  if (!rc) return <Unavailable>Recruitment detail is not available for your role.</Unavailable>;
  const chart = W.departments.map(x => ({ dept: x.dept, Opening: x.opening, Closing: x.closing }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[['Opening headcount', co.opening, pc?.opening], ['Joinings', co.joinings, pc?.joinings], ['Exits', co.exits, pc?.exits], ['Closing headcount', co.closing, pc?.closing], ['Net change', co.net, pc?.net], ['Open vacancies', rc.openVacancies, null], ['Requisitions raised', rc.counts.raised, null], ['Offers accepted', rc.offers.accepted, null]].map(([l, v, p]) => <Stat key={l} label={l} value={v} sub={p != null ? `was ${p}` : ''} />)}
      </div>
      <p className="text-[11px] text-gray-500">Closing = Opening + Joinings − Exits (an exit takes effect the day after the last working day). {co.reconciles ? 'This reconciles for the company and every department.' : 'RECONCILIATION FAILED — see Data Quality.'}</p>
      <Unavailable>Not recorded in MaxVolt One, so shown as unavailable rather than guessed: department transfers (a department&apos;s history uses each person&apos;s current department), sanctioned/budgeted positions, vacancy history, offer and stage dates, time-to-fill. Open vacancies and the offer pipeline are snapshots of today.</Unavailable>
      <Section title="Department headcount movement" subtitle="Click a department to open its detailed report.">
        <MiniTable heads={['Department', 'Opening', 'Joinings', 'Exits', 'Transfers in', 'Transfers out', 'Closing', 'Net', 'Change %', 'Open vacancies']}
          rows={[...W.departments.map(x => [<button key={x.dept} className="text-blue-700 hover:underline" onClick={() => applyFilter({ department: x.dept })}>{x.dept}</button>, x.opening, x.joinings, x.exits, 'n/a', 'n/a', x.closing, x.net > 0 ? `+${x.net}` : x.net, x.netPct == null ? (x.opening < 1 ? 'n/a' : '') : (x.opening < 5 ? `${x.netPct}% (small dept)` : `${x.netPct}%`), rc.byDept.find(v => v.dept === x.dept)?.open ?? 0]),
            [<b key="c">Company</b>, <b key="o">{co.opening}</b>, <b key="j">{co.joinings}</b>, <b key="e">{co.exits}</b>, 'n/a', 'n/a', <b key="cl">{co.closing}</b>, <b key="n">{co.net}</b>, co.opening ? `${Math.round(co.net / co.opening * 1000) / 10}%` : 'n/a', rc.openVacancies]]} />
      </Section>
      <Section title="Opening versus closing headcount"><Chart title="Headcount by department" sub={`Opening (${fmtD(W.openingDate)}) vs closing (${fmtD(d.meta.period.to)}) · unit: employees`} height={300}><BarChart data={chart} margin={{ left: -10, bottom: 40 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="dept" tick={{ ...axis, fontSize: 10 }} interval={0} angle={-35} textAnchor="end" height={70} /><YAxis tick={axis} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Opening" fill={COL.grey} /><Bar dataKey="Closing" fill={COL.blue} /></BarChart></Chart></Section>
      <Grid>
        <Section title="Recruitment funnel (current pipeline)" subtitle="Candidate records hold only a current stage, so this is a snapshot of the pipeline today."><Chart title="Candidates by stage" sub="Unit: candidates" height={240}><BarChart data={rc.funnel} layout="vertical" margin={{ left: 40, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={axis} /><YAxis type="category" dataKey="stage" tick={axis} width={120} /><Tooltip /><Bar dataKey="n" name="Candidates" fill={COL.blue} /></BarChart></Chart></Section>
        <Section title="Open vacancies by department" subtitle="Positions on published requisitions not yet filled."><MiniTable heads={['Department', 'Requisitions', 'Positions', 'Filled', 'Open', 'Open > ageing limit']} rows={rc.byDept.map(x => [x.dept, x.reqs, x.positions, x.filled, x.open, x.aged])} empty="No open requisitions." /></Section>
      </Grid>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Applications in period" value={rc.counts.applied} /><Stat label="Interviews scheduled in period" value={rc.counts.interviews} /><Stat label="Requisitions with no recent activity" value={rc.stale} /><Stat label="Published without full approval" value={rc.unapproved} /><Stat label="Offers declined (current)" value={rc.offers.declined} />
      </div>
      <Register kind="vacancies" params={params} title="Vacancy ageing" pageSize={15} subtitle="Remaining = approved positions − candidates joined."
        columns={[{ key: 'id', label: 'Req ID', render: r => r.id.slice(0, 8) }, { key: 'title', label: 'Position' }, { key: 'dept', label: 'Department' }, { key: 'raised', label: 'Raised', render: r => fmtD(r.raised) }, { key: 'positions', label: 'Approved' }, { key: 'filled', label: 'Filled' }, { key: 'remaining', label: 'Remaining' }, { key: 'owner', label: 'Owner' }, { key: 'status', label: 'Status' }, { key: 'age', label: 'Age (d)' }, { key: 'candidates', label: 'Candidates' }]} />
      <Grid>
        <Register kind="joiners" params={params} title="Joinings in the period" pageSize={10} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'date', label: 'Joined', render: r => fmtD(r.date) }]} />
        <Register kind="exits" params={params} title="Exits in the period" subtitle="Last working day shown." pageSize={10} columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'date', label: 'Last day', render: r => fmtD(r.date) }]} />
      </Grid>
    </div>
  );
}

// ───────────────────────────── Departments
export function DepartmentsTab({ d, applyFilter }) {
  const cur = d.meta.filters?.department && d.meta.filters.department !== 'all' ? d.meta.filters.department : null;
  return (
    <div className="space-y-4">
      {cur && <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-sm p-3 flex items-center justify-between"><span>Showing the detailed report for <b>{cur}</b> — every tab, register and export is filtered to this department.</span><button className="text-blue-700 underline text-sm" onClick={() => applyFilter({ department: 'all' })}>Back to all departments</button></div>}
      <Section title="Department summary" subtitle="Click a department to open its detailed report. n/a means the department had no scheduled employee-days (not 100%).">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50">{['Department', 'Head', 'Open HC', 'Close HC', 'Join', 'Exit', 'Net', 'Vacancies', 'Present ED', 'Absent ED', 'Leave ED', 'WFH ED', 'OD ED', 'Late', 'Regul.', 'Missing', 'Compl. %', 'Leave days', 'Gate passes', 'Pending appr.', 'Reimb. claims', 'Reimb. pending ₹'].map(h => <th key={h} className="p-2 whitespace-nowrap font-medium">{h}</th>)}</tr></thead>
          <tbody>{d.departments.map(x => (
            <tr key={x.dept} className="border-b hover:bg-gray-50/60"><td className="p-2"><button className="text-blue-700 hover:underline whitespace-nowrap" onClick={() => applyFilter({ department: x.dept })}>{x.dept}</button></td><td className="p-2 whitespace-nowrap">{x.head || 'n/a'}</td>
              {[x.opening, x.closing, x.joinings, x.exits, x.net, x.openVacancies, x.present, x.absent, x.leave, x.wfh, x.od, x.late, x.regularisations, x.missing, x.compliance == null ? 'n/a' : `${x.compliance}%`, x.leaveDays, x.gatePasses, x.pendingApprovals, x.reimbClaims, x.reimbPending].map((v, i) => <td key={i} className="p-2 text-right tabular-nums">{v}</td>)}</tr>))}</tbody></table></div>
        <p className="text-[11px] text-gray-500 mt-2">ED = employee-days. Transfers between departments are not recorded in MaxVolt One.</p>
      </Section>
    </div>
  );
}

// ───────────────────────────── Gate pass
export function GatePassTab({ d, params }) {
  const G = d.gatepass, c = G.counts, p = G.prev;
  const byType = Object.entries(c.byType).map(([k, v]) => ({ k: k.replace(/_/g, ' '), v }));
  const byDay = Object.entries(c.byDay).sort().map(([k, v]) => ({ k, v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[['Passes created', c.total, p?.total], ['Returned', c.returned, p?.returned], ['Open', c.open, p?.open], ['Overdue', c.overdue, p?.overdue], ['Auto-closed', c.autoClosed, p?.autoClosed], ['Cancelled', c.cancelled, p?.cancelled], ['Avg outing (min)', c.avgDurationMin ?? 'n/a', p?.avgDurationMin], ['Employees with 2+ passes', c.repeatEmployees, p?.repeatEmployees]].map(([l, v, pv]) => <Stat key={l} label={l} value={v} sub={pv != null ? `was ${pv}` : ''} />)}
      </div>
      <p className="text-[11px] text-gray-500">Average duration uses only passes with real departure and return times ({c.durationSample} pass(es)); auto-closed passes carry system times and are excluded. Official outings are legitimate work and are not treated as time away.</p>
      <Grid>
        <Section title="By outing type"><Chart title="Gate passes by outing type" sub={`${periodText(d)} · unit: passes`} height={220}><BarChart data={byType} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="k" tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip /><Bar dataKey="v" name="Passes" fill={COL.blue} /></BarChart></Chart></Section>
        <Section title="By day"><Chart title="Gate passes per day" sub="Unit: passes" height={220}><BarChart data={byDay} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="k" tickFormatter={tick} tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip labelFormatter={fmtD} /><Bar dataKey="v" name="Passes" fill={COL.present} /></BarChart></Chart></Section>
      </Grid>
      <Grid>
        <Section title="By department"><MiniTable heads={['Department', 'Passes']} rows={Object.entries(c.byDept).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])} /></Section>
        <Section title="By status"><MiniTable heads={['Status', 'Passes']} rows={Object.entries(c.byStatus).map(([k, v]) => [k.replace(/_/g, ' '), v])} /></Section>
      </Grid>
      <Register kind="gatepass_exceptions" params={params} title="Gate pass exceptions" pageSize={15}
        columns={[{ key: 'sev', label: 'Severity', render: r => <Pill sev={r.sev} /> }, { key: 'kind', label: 'Exception' }, { key: 'name', label: 'Employee', render: r => <span>{r.name} <span className="text-xs text-gray-400">{r.code} {r.dept}</span></span> }, { key: 'date', label: 'Date', render: r => fmtD(r.date) }, { key: 'status', label: 'Status' }, { key: 'expected', label: 'Expected' }, { key: 'actual', label: 'Actual' }, { key: 'why', label: 'Why', cls: 'max-w-xs' }, { key: 'action', label: 'Recommended action', cls: 'max-w-xs' }]} />
      <Register kind="gatepass" params={params} title="Gate pass register" pageSize={20}
        columns={[{ key: 'id', label: 'Pass', render: r => r.id.slice(0, 8) }, { key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'type', label: 'Type' }, { key: 'reason', label: 'Purpose', cls: 'max-w-xs' }, { key: 'created', label: 'Created', render: r => fmtDT(r.created) }, { key: 'approval', label: 'Approval' }, { key: 'status', label: 'Status' }, { key: 'exit', label: 'Exit', render: r => fmtDT(r.exit) }, { key: 'returned', label: 'Returned', render: r => fmtDT(r.returned) }, { key: 'durationMin', label: 'Min' }, { key: 'closure', label: 'Closure' }, { key: 'approver', label: 'Approver' }]} />
    </div>
  );
}

// ───────────────────────────── Visitors
export function VisitorsTab({ d, params }) {
  const V = d.visitors;
  if (!V) return <Unavailable>Visitor records are not available for your role.</Unavailable>;
  const c = V.counts, p = V.prev;
  const byDay = Object.entries(c.byDay).sort().map(([k, v]) => ({ k, v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[['Visitors', c.total, p?.total], ['Walk-in', c.walkIn, p?.walkIn], ['Pre-registered', c.preRegistered, p?.preRegistered], ['Checked out', c.checkedOut, p?.checkedOut], ['Pending approval', c.pendingApproval, p?.pendingApproval], ['Missing check-out', c.missingCheckout, p?.missingCheckout], ['Repeat visitors', c.repeatVisitors, p?.repeatVisitors], ['Avg visit (min)', c.avgDurationMin ?? 'n/a', p?.avgDurationMin]].map(([l, v, pv]) => <Stat key={l} label={l} value={v} sub={pv != null ? `was ${pv}` : ''} />)}
      </div>
      {c.avgExpectedMin != null && <p className="text-[11px] text-gray-500">Expected visit length averages {c.avgExpectedMin} min against {c.avgDurationMin ?? 'n/a'} min actual.</p>}
      <Grid>
        <Section title="Visitors per day"><Chart title="Visitors per day" sub={`${periodText(d)} · unit: visitors`} height={200}><BarChart data={byDay} margin={{ left: -10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="k" tickFormatter={tick} tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip labelFormatter={fmtD} /><Bar dataKey="v" name="Visitors" fill={COL.blue} /></BarChart></Chart></Section>
        <Section title="By host department"><MiniTable heads={['Department', 'Visitors']} rows={Object.entries(c.byDept).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])} empty="No visitors in this period." /></Section>
      </Grid>
      {!!V.issues.length && <Section title="Records needing attention"><MiniTable heads={['Issue', 'Visitor', 'Host', 'Department', 'Date', 'Action']} rows={V.issues.map(i => [i.kind, i.visitor, i.host, i.dept, fmtD(i.date), i.action])} /></Section>}
      <Register kind="visitors" params={params} title="Visitor log" subtitle="Personal contact details are shown to HR / management only." pageSize={15}
        columns={[{ key: 'type', label: 'Type' }, { key: 'visitor', label: 'Visitor' }, { key: 'company', label: 'Company' }, { key: 'host', label: 'Host' }, { key: 'dept', label: 'Department' }, { key: 'purpose', label: 'Purpose' }, { key: 'status', label: 'Status' }, { key: 'date', label: 'Date', render: r => fmtD(r.date) }, { key: 'in', label: 'In', render: r => fmtDT(r.in) }, { key: 'out', label: 'Out', render: r => fmtDT(r.out) }, { key: 'durationMin', label: 'Min' }]} />
    </div>
  );
}

// ───────────────────────────── Reimbursements
export function ReimbursementsTab({ d, params }) {
  const B = d.reimbursements;
  if (!B) return <Unavailable>Reimbursement data is not available for your role.</Unavailable>;
  const c = B.counts, p = B.prev;
  const inr = (v) => (v == null ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[['Claims', c.claims, p?.claims], ['Approved (incl. paid)', c.approved, p?.approved], ['Pending approval', c.pending, p?.pending], ['Rejected', c.rejected, p?.rejected], ['Paid (confirmed)', c.paid, p?.paid]].map(([l, v, pv]) => <Stat key={l} label={l} value={v} sub={pv != null ? `was ${pv}` : ''} />)}
        <Stat label="Avg approval (h)" value={c.avgApprovalHours ?? 'n/a'} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Claimed" value={inr(c.claimedAmt)} sub={p ? `was ${inr(p.claimedAmt)}` : ''} /><Stat label="Approved" value={inr(c.approvedAmt)} /><Stat label="Paid" value={inr(c.paidAmt)} sub="needs payment confirmation" /><Stat label="Outstanding" value={inr(c.outstandingAmt)} sub="not yet paid, not rejected" />
      </div>
      <Grid>
        <Section title="By claim type"><MiniTable heads={['Type', 'Claims', 'Amount']} rows={Object.entries(c.byType).map(([k, v]) => [k, v.n, inr(v.amt)])} empty="No claims in this period." /></Section>
        <Section title="By department"><MiniTable heads={['Department', 'Claims', 'Amount', 'Pending']} rows={Object.entries(c.byDept).map(([k, v]) => [k, v.n, inr(v.amt), inr(v.pendingAmt)])} empty="No claims in this period." /></Section>
      </Grid>
      <Section title="Claims for review" subtitle="Possible duplicates and ageing are prompts for review, not allegations.">
        <MiniTable heads={['Flag', 'Code', 'Employee', 'Department', 'Amount', 'Why', 'Action']} rows={B.issues.map(i => [i.kind, i.code, i.name, i.dept, i.amount == null ? '' : inr(i.amount), i.why, i.action])} empty="Nothing flagged." />
      </Section>
      <Register kind="reimbursements" params={params} title="Claims register" pageSize={15}
        columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Employee' }, { key: 'dept', label: 'Department' }, { key: 'type', label: 'Type' }, { key: 'date', label: 'Expense date', render: r => fmtD(r.date) }, { key: 'amount', label: 'Amount', render: r => inr(r.amount) }, { key: 'status', label: 'Status' }, { key: 'approvedOn', label: 'Approved', render: r => fmtD(r.approvedOn) }, { key: 'paidOn', label: 'Paid', render: r => fmtD(r.paidOn) }, { key: 'ageDays', label: 'Pending (d)' }]} />
    </div>
  );
}

// ───────────────────────────── Insights
const STATUSES = ['New', 'Under Review', 'Resolved', 'Dismissed'];
export function InsightsTab({ d, onRefresh, focusKey, canEdit }) {
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState(focusKey || null);
  const list = d.insights.filter(i => showClosed || !['Resolved', 'Dismissed'].includes(i.status));
  const setStatus = async (i, status) => { try { await mis('setMisInsightStatus', { key: i.key, status }); toast.success(`Marked ${status}`); onRefresh(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-xs text-gray-500">{list.length} insight(s). Every insight lists its evidence and the rule that raised it — nothing here is an opaque AI judgement.</p><label className="text-xs text-gray-600 flex items-center gap-1.5"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} />Show resolved / dismissed</label></div>
      {!list.length && <p className="text-sm text-gray-500 py-6 text-center">No open insights.</p>}
      {list.map(i => (
        <div key={i.key} className="rounded-xl border bg-white">
          <button className="w-full text-left p-3 flex items-start gap-3" onClick={() => setOpen(open === i.key ? null : i.key)}>
            <Pill sev={i.severity} /><div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-900">{i.title}</div><div className="text-xs text-gray-500">{i.category} · {i.dept} · detected {fmtD(i.detected)}</div></div>
            <span className="text-xs text-gray-500 shrink-0">{i.status}</span>
          </button>
          {open === i.key && (
            <div className="px-3 pb-3 space-y-2 text-sm border-t pt-3">
              <div className="grid sm:grid-cols-3 gap-2 text-xs"><div><span className="text-gray-500">Current</span><div className="text-base font-semibold">{num(i.current)}</div></div><div><span className="text-gray-500">Comparison</span><div className="text-base font-semibold">{num(i.comparison)}</div></div><div><span className="text-gray-500">Variance</span><div><Chg k={{ prev: i.comparison, abs: i.abs, pct: i.pct, dir: i.abs > 0 ? 'up' : i.abs < 0 ? 'down' : 'flat', better: 'neutral', note: i.note }} /></div></div></div>
              <p><b className="text-gray-700">Evidence:</b> {i.evidence || '—'}</p>
              <p><b className="text-gray-700">Why this was raised:</b> {i.why}</p>
              <p><b className="text-gray-700">Suggested action:</b> {i.action} <span className="text-gray-500">(owner: {i.owner})</span></p>
              {canEdit && <div className="flex items-center gap-1.5 flex-wrap pt-1"><span className="text-xs text-gray-500">Status:</span>{STATUSES.map(s => <button key={s} onClick={() => setStatus(i, s)} className={`h-7 px-2.5 rounded-full text-xs border ${i.status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700'}`}>{s}</button>)}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── Data quality
export function DataQualityTab({ d, params }) {
  const failed = d.reconciliation.filter(r => !r.ok).length;
  return (
    <div className="space-y-4">
      <Section title="Reconciliation" subtitle="The dashboard, registers and exports use one calculation engine; these checks prove the totals agree.">
        <MiniTable heads={['Check', 'Result', 'Detail']} rows={d.reconciliation.map(r => [r.check, <Pill key="r" sev={r.ok ? 'OK' : 'Critical'}>{r.ok ? 'Pass' : 'FAIL'}</Pill>, r.detail])} />
        {failed > 0 && <p className="text-sm text-red-700 mt-2">{failed} check(s) failed — figures may be incomplete. Review the data-quality items below.</p>}
      </Section>
      <Section title="Data quality" subtitle="Zero means the check found nothing — it is not the same as missing or failed data.">
        <MiniTable heads={['Check', 'Source', 'Records', 'Severity', 'Likely cause', 'Recommended correction', 'Examples']}
          rows={d.dataQuality.map(x => [x.title, x.source, x.count, <Pill key="s" sev={x.sev} />, x.cause, x.fix, <span key="e" className="text-xs text-gray-500">{x.samples.join('; ')}</span>])} />
      </Section>
      <Register kind="data_quality" params={params} title="Affected records (examples)" pageSize={15} columns={[{ key: 'check', label: 'Check' }, { key: 'record', label: 'Record' }, { key: 'source', label: 'Source' }]} />
      <Section title="Known limitations of this report"><ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">{d.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></Section>
    </div>
  );
}
