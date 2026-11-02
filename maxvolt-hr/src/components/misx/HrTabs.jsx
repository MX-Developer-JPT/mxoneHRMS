import { ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { fmtD, num } from '@/lib/mis';
import { Section, MiniTable, Unavailable } from '@/components/misx/common';

const inr = (v) => (v == null ? '—' : `₹${Math.round(Number(v)).toLocaleString('en-IN')}`);
const PAL = ['#1E4E8C', '#38BDF8', '#818CF8', '#F59E0B', '#10B981', '#EF4444', '#A7C4E8', '#9CA3AF'];
const axis = { fontSize: 11, fill: '#6B7280' };
const Chart = ({ title, sub, height = 250, children }) => (<div><div className="text-sm font-medium text-gray-800">{title}</div>{sub && <div className="text-[11px] text-gray-500 mb-2">{sub}</div>}<div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div></div>);
const Stat = ({ label, value, sub, tone }) => (<div className={`rounded-xl border bg-white p-3 ${tone === 'bad' ? 'border-red-200 bg-red-50/40' : tone === 'warn' ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200'}`}><div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div><div className="text-xs text-gray-600">{label}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>);
const Grid = ({ n = 4, children }) => <div className={`grid grid-cols-2 ${n === 3 ? 'md:grid-cols-3' : n === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3`}>{children}</div>;
const Gone = () => <Unavailable>This section is only available to HR and management.</Unavailable>;
const Who = (r) => [r.code, r.name, r.dept];
const toDonut = (o) => Object.entries(o || {}).map(([name, value]) => ({ name, value }));

// ── executive strip for the Overview tab ─────────────────────────────────────────────────────────────────────────────
export function HrStrip({ d, setTab }) {
  const h = d.hr; if (!h) return null;
  const L = h.letters.counts, P = h.probation.counts, A = h.attrition, N = h.loans, C = h.lifecycle;
  const items = [
    ['probation', 'Confirmation overdue', P.overdue, `${P.onProbation} on probation · ${P.endingSoon} ending soon`, P.overdue ? 'bad' : null],
    ['letters', 'Letters / documents pending', L.pendingAppointment + L.pendingConfirmation + L.pendingTransfer + L.pendingIssue, `${L.docIncomplete} employees with incomplete documents`, L.pendingAppointment ? 'warn' : null],
    ['attrition', 'Attrition (annualised)', A.company.annualised == null ? '—' : `${A.company.annualised}%`, `${A.company.exits} exit(s) · ${A.company.joiners} joiner(s) · retention ${A.retention.rate ?? '—'}%`, null],
    ...(h.payroll ? [['payroll', `Payroll cost · ${h.payroll.month}`, inr(h.payroll.cost), h.payroll.momPct == null ? 'no earlier month to compare' : `${h.payroll.momPct > 0 ? '+' : ''}${h.payroll.momPct}% vs previous month · ${h.payroll.headcount} on payroll`, Math.abs(h.payroll.momPct || 0) >= 10 ? 'warn' : null]] : []),
    ['loans', 'Loans & advances outstanding', inr(N.amounts.outstanding), `${N.counts.active} active · ${N.counts.overdue} behind`, N.counts.overdue ? 'warn' : null],
    ['lifecycle', 'HR operations open', C.tickets.open + C.onboarding.pendingCount + C.exits.pendingDeactivationCount, `${C.tickets.open} tickets · ${C.onboarding.pendingCount} onboardings · ${C.exits.pendingDeactivationCount} access removals`, C.exits.pendingDeactivationCount ? 'warn' : null],
  ];
  return (
    <Section title="HR at a glance" subtitle="Probation, documentation, attrition, loans and HR operations — click a card for the detail.">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">{items.map(([tab, l, v, sub, tone]) => <button key={tab} onClick={() => setTab(tab)} className="text-left"><Stat label={l} value={v} sub={sub} tone={tone} /></button>)}</div>
    </Section>
  );
}

// ── probation & confirmation ─────────────────────────────────────────────────────────────────────────────────────────
export function ProbationTab({ d }) {
  const h = d.hr?.probation; if (!h) return <Gone />;
  const c = h.counts;
  return (
    <div className="space-y-4">
      <Grid n={5}>
        <Stat label="On probation" value={c.onProbation} sub={`${c.trainees} trainee(s)`} />
        <Stat label="Confirmation overdue" value={c.overdue} sub="probation ended, not confirmed" tone={c.overdue ? 'bad' : null} />
        <Stat label="Ending within 30 days" value={c.endingSoon} tone={c.endingSoon ? 'warn' : null} />
        <Stat label="Extended" value={c.extended} sub={c.noEndDate ? `${c.noEndDate} with no end date` : ''} />
        <Stat label="Confirmed this period" value={c.confirmedInPeriod} sub={h.avgDaysToConfirm ? `avg ${h.avgDaysToConfirm.avg} days to confirm (n=${h.avgDaysToConfirm.n})` : 'average not available'} />
      </Grid>
      {h.confirmedDateMissing > 0 && <Unavailable>{h.confirmedDateMissing} confirmed employee(s) have no recorded confirmation date, so they are left out of the confirmation-time average and the confirmed-in-period count.</Unavailable>}
      <Section title="Overdue confirmations" subtitle="Probation end date has passed and the employee is still on probation — act on these first.">
        <MiniTable heads={['Code', 'Employee', 'Department', 'Joined', 'Probation ended', 'Days overdue', 'Review']} rows={h.overdue.map(r => [r.code, r.name, r.dept, fmtD(r.doj), fmtD(r.end), <b key="o" className="text-red-700">{r.overdueBy}</b>, r.reviewStatus])} empty="No overdue confirmations." />
      </Section>
      <Section title="Ending soon and upcoming confirmation dates">
        <MiniTable heads={['Code', 'Employee', 'Department', 'Probation ends', 'Days left', 'Extended', 'Review']} rows={h.upcoming.map(r => [r.code, r.name, r.dept, fmtD(r.end), r.daysLeft, r.extended ? 'Yes' : '', r.reviewStatus])} empty="Nothing ending." />
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Department-wise probation status"><MiniTable heads={['Department', 'On probation', 'Overdue', 'Ending soon', 'Extended', 'Confirmed']} rows={h.byDept.map(x => [x.dept, x.onProbation, x.overdue, x.endingSoon, x.extended, x.confirmedInPeriod])} empty="No one on probation." /></Section>
        <Section title="Confirmed in this period"><MiniTable heads={['Code', 'Employee', 'Department', 'Confirmed on', 'Days from joining']} rows={h.confirmedList.map(r => [r.code, r.name, r.dept, fmtD(r.confirmedOn), r.days ?? '—'])} empty="No confirmations recorded in this period." /></Section>
      </div>
      {h.noEndDate.length > 0 && <Section title="On probation but no end date recorded" subtitle="Their confirmation cannot be tracked until an end date is set."><MiniTable heads={['Code', 'Employee', 'Department', 'Joined']} rows={h.noEndDate.map(r => [r.code, r.name, r.dept, fmtD(r.doj)])} /></Section>}
    </div>
  );
}

// ── letters & documentation ──────────────────────────────────────────────────────────────────────────────────────────
export function LettersTab({ d }) {
  const h = d.hr?.letters; if (!h) return <Gone />;
  const c = h.counts;
  return (
    <div className="space-y-4">
      <Unavailable>{h.note}</Unavailable>
      <Grid n={5}>
        <Stat label="Warning letters" value={c.warnings} sub={`${c.warningsInPeriod} in this period · ${c.multiWarning} employee(s) with ${2}+`} tone={c.multiWarning ? 'warn' : null} />
        <Stat label="Appointment letters pending" value={c.pendingAppointment} tone={c.pendingAppointment ? 'warn' : null} />
        <Stat label="Confirmation letters pending" value={c.pendingConfirmation} tone={c.pendingConfirmation ? 'warn' : null} />
        <Stat label="Transfer / promotion letters pending" value={c.pendingTransfer} />
        <Stat label="Generated, not sent" value={c.pendingIssue} />
      </Grid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Letters recorded" subtitle="Generated through Letter Generator."><MiniTable heads={['Type', 'Total', 'In period', 'Sent', 'Not sent']} rows={h.byType.map(t => [t.label, t.total, t.inPeriod, t.sent, t.pendingIssue])} empty="No letters generated yet." /></Section>
        <Section title="Pending actions by department" subtitle="What HR still has to do, department by department."><MiniTable heads={['Department', 'Appointment', 'Confirmation', 'Transfer', 'Not sent', 'Documents']} rows={h.pendingByDept.map(x => [x.dept, x.appointment, x.confirmation, x.transfer, x.issue, x.documents])} empty="Nothing pending." /></Section>
      </div>
      <Section title="Warning letters issued" subtitle="Who, when and why."><MiniTable heads={['Date', 'Code', 'Employee', 'Department', 'Reason', 'Ref']} rows={h.warnings.map(w => [fmtD(w.date), w.code, w.name, w.dept, w.reason || <span key="n" className="text-gray-400">no reason recorded</span>, w.ref])} empty="No warning letters." />
        {h.multiWarning.length > 0 && <div className="mt-3"><div className="text-sm font-medium mb-1">Employees with multiple warnings</div><MiniTable heads={['Code', 'Employee', 'Department', 'Warnings']} rows={h.multiWarning.map(r => [r.code, r.name, r.dept, <b key="w">{r.warnings}</b>])} /></div>}
      </Section>
      <Section title="Pending-action list" subtitle="Employees whose documentation is incomplete or whose letter has not been issued.">
        <MiniTable heads={['Code', 'Employee', 'Department', 'What is pending']} rows={[
          ...h.pendingAppointment.map(r => [...Who(r), `Appointment letter — joined ${fmtD(r.doj)} (${r.daysSinceJoining} days ago)`]),
          ...h.pendingConfirmation.map(r => [...Who(r), `Confirmation letter — ${r.reason}`]), ...h.pendingTransfer.map(r => [...Who(r), r.reason]),
          ...h.pendingIssue.map(r => [r.code, r.name, r.dept, `${r.type} letter generated ${fmtD(r.generated)} — not sent`])]} empty="No letters pending." />
      </Section>
      <Section title="Employee-wise document completion" subtitle={`Required: Aadhaar, PAN, educational certificate and bank details. ${c.docComplete} of ${c.activeEmployees} active employees are complete.`}>
        <MiniTable heads={['Code', 'Employee', 'Department', 'Present', 'Missing']} rows={h.incompleteDocs.slice(0, 150).map(r => [r.code, r.name, r.dept, `${r.present} of ${r.required}`, r.missing])} empty="Every active employee's documents are complete." />
        {h.incompleteDocs.length > 150 && <p className="text-xs text-gray-500 mt-1">Showing 150 of {h.incompleteDocs.length} — the Excel export lists everyone.</p>}
      </Section>
    </div>
  );
}

// ── attrition & retention ────────────────────────────────────────────────────────────────────────────────────────────
export function AttritionTab({ d }) {
  const h = d.hr?.attrition; if (!h) return <Gone />;
  const co = h.company, pv = h.previous;
  return (
    <div className="space-y-4">
      {h.historyLimited && <Unavailable>Exits are recorded only from {fmtD(h.firstExit)}. Anyone who left before then is not in the system, so the trailing 12-month and annualised rates below are understated until a full year of exits has been recorded.</Unavailable>}
      <Grid n={5}>
        <Stat label="Exits this period" value={co.exits} sub={`previous period ${pv.exits}`} />
        <Stat label="Attrition rate" value={co.rate == null ? '—' : `${co.rate}%`} sub={`annualised ${co.annualised ?? '—'}% (previous ${pv.annualised ?? '—'}%)`} />
        <Stat label="Trailing 12-month attrition" value={h.annual.rate == null ? '—' : `${h.annual.rate}%`} />
        <Stat label="Retention rate" value={h.retention.rate == null ? '—' : `${h.retention.rate}%`} sub={`${h.retention.stayed} of ${h.retention.cohort} stayed`} />
        <Stat label="Average tenure" value={h.avgTenureYears == null ? '—' : `${h.avgTenureYears} yrs`} sub={h.avgTenureAtExitYears != null ? `at exit ${h.avgTenureAtExitYears} yrs` : ''} />
      </Grid>
      <Section title="Joiners vs exits" subtitle="Twelve months to the end of the period — headcount grows when the blue bars exceed the red ones.">
        <Chart title="Monthly joiners, exits and attrition %" height={260}>
          <ComposedChart data={h.trend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={axis} /><YAxis yAxisId="l" tick={axis} allowDecimals={false} width={30} /><YAxis yAxisId="r" orientation="right" tick={axis} width={36} unit="%" /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="joiners" name="Joiners" fill="#38BDF8" radius={[3, 3, 0, 0]} /><Bar yAxisId="l" dataKey="exits" name="Exits" fill="#EF4444" radius={[3, 3, 0, 0]} /><Line yAxisId="r" type="monotone" dataKey="rate" name="Attrition %" stroke="#1E4E8C" strokeWidth={2} dot={{ r: 3 }} /></ComposedChart>
        </Chart>
      </Section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Voluntary vs involuntary"><Chart title="" height={200}><PieChart><Pie data={toDonut(h.kinds)} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="80%">{toDonut(h.kinds).map((_, i) => <Cell key={i} fill={PAL[i % PAL.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /></PieChart></Chart>{!Object.keys(h.kinds).length && <p className="text-sm text-gray-500">No exits in this period.</p>}</Section>
        <Section title="Reasons for leaving"><MiniTable heads={['Reason', 'Exits']} rows={Object.entries(h.reasons)} empty="No exits in this period." />{h.exitRecordsMissing > 0 && <p className="text-[11px] text-amber-700 mt-2">{h.exitRecordsMissing} leaver(s) have no exit record, so their reason is not known.</p>}</Section>
        <Section title="Tenure at exit"><MiniTable heads={['Tenure', 'Exits']} rows={h.tenure.map(t => [t.band, t.exits])} /><p className="text-[11px] text-gray-500 mt-2">Resignation vs termination: {Object.entries(h.types).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}</p></Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Department-wise attrition"><MiniTable heads={['Department', 'Exits', 'Avg headcount', 'Attrition %', 'Annualised %']} rows={h.byDept.map(x => [x.dept, x.exits, x.avg, x.rate ?? '—', <b key="a" className={x.annualised >= 15 ? 'text-red-700' : ''}>{x.annualised ?? '—'}</b>])} /></Section>
        <Section title="Designation-wise attrition"><MiniTable heads={['Designation', 'Exits', 'Avg headcount', 'Attrition %']} rows={h.byDesignation.filter(x => x.exits > 0).map(x => [x.designation, x.exits, x.avg, x.rate ?? '—'])} empty="No exits in this period." /></Section>
      </div>
      <Section title="Department stability" subtitle="Stability = 100 − annualised attrition. Lowest first."><MiniTable heads={['Department', 'Headcount', 'Average tenure (yrs)', 'Exits', 'Stability %']} rows={h.stability.map(x => [x.dept, x.headcount, x.avgTenureYears, x.exits, x.stabilityPct ?? '—'])} /></Section>
      <Section title="Leavers in this period"><MiniTable heads={['Code', 'Employee', 'Department', 'Designation', 'Joined', 'Left', 'Tenure (days)', 'Type', 'Reason']} rows={h.exits.map(l => [l.code, l.name, l.dept, l.designation, fmtD(l.doj), fmtD(l.lwd), l.tenureDays ?? '—', `${l.type} (${l.kind})`, l.reason])} empty="Nobody left in this period." /></Section>
      <Section title="How these figures are calculated"><ul className="text-xs text-gray-600 space-y-1 list-disc pl-4">{h.method.map((m, i) => <li key={i}>{m}</li>)}</ul>{h.separatedNoDate > 0 && <p className="text-xs text-amber-700 mt-2">{h.separatedNoDate} separated employee(s) have no last working day recorded and cannot be placed in time.</p>}{h.firstExit && <p className="text-xs text-gray-500 mt-1">Exits are available from {fmtD(h.firstExit)} (earliest recorded last working day); earlier history is not in the system.</p>}</Section>
    </div>
  );
}

// ── loans & advances ─────────────────────────────────────────────────────────────────────────────────────────────────
export function LoansTab({ d }) {
  const h = d.hr?.loans; if (!h) return <Gone />;
  const a = h.amounts, c = h.counts;
  return (
    <div className="space-y-4">
      <Unavailable>{h.note}</Unavailable>
      <Grid n={5}>
        <Stat label="Total outstanding" value={inr(a.outstanding)} sub={`loans ${inr(a.outstandingLoans)} · advances ${inr(a.outstandingAdvances)}`} />
        <Stat label="Total disbursed" value={inr(a.disbursed)} sub={`${c.total} on record`} />
        <Stat label="Active" value={c.active} sub={`${c.fullyRepaid} fully repaid · ${c.pendingApproval} pending`} />
        <Stat label="Monthly deduction" value={inr(a.monthlyDeduction)} />
        <Stat label="Behind schedule" value={c.overdue} sub={c.overdue ? inr(a.behind) : ''} tone={c.overdue ? 'bad' : null} />
      </Grid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Department-wise exposure"><MiniTable heads={['Department', 'Active', 'Outstanding', 'Monthly deduction', 'Behind']} rows={h.byDept.map(x => [x.dept, x.loans, inr(x.outstanding), inr(x.monthly), x.overdue])} empty="No active loans or advances." /></Section>
        <Section title="Loan deductions on payslips" subtitle="Repayments actually collected, by payroll month."><Chart title="" height={200}><BarChart data={h.deductions}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="label" tick={axis} /><YAxis tick={axis} width={50} /><Tooltip formatter={inr} /><Bar dataKey="amount" name="Loan deductions" fill="#1E4E8C" radius={[3, 3, 0, 0]} /></BarChart></Chart>{!h.deductions.length && <p className="text-sm text-gray-500">No loan deductions appear on the uploaded payslips.</p>}</Section>
      </div>
      <Section title="Employee-wise loan and advance statement"><MiniTable heads={['Code', 'Employee', 'Department', 'Kind', 'Status', 'Amount', 'Monthly', 'Repaid', 'Progress', 'Outstanding', 'Behind by', 'Basis']} rows={h.statement.map(r => [r.code, r.name, r.dept, r.kind, r.status, inr(r.amount), inr(r.monthly), inr(r.repaid), r.repaidPct == null ? '—' : `${r.repaidPct}%`, <b key="o">{inr(r.outstanding)}</b>, r.behind > 0 ? <span key="b" className={r.overdue ? 'text-red-700 font-semibold' : ''}>{inr(r.behind)}</span> : '—', <span key="s" className="text-[11px] text-gray-500">{r.basis}</span>])} empty="No loans or advances are recorded in MaxVolt One." /></Section>
      {h.offCycle.length > 0 && <Section title="Off-cycle payments" subtitle="Bonuses and other off-cycle payments (not loans)."><MiniTable heads={['Type', 'Status', 'Count', 'Amount']} rows={h.offCycle.map(o => [o.type, o.status, o.count, inr(o.amount)])} /></Section>}
    </div>
  );
}

// ── lifecycle, HR operations and recruitment detail ──────────────────────────────────────────────────────────────────
export function LifecycleTab({ d }) {
  const h = d.hr?.lifecycle, rc = d.hr?.recruitment; if (!h) return <Gone />;
  const kv = (o) => Object.entries(o || {});
  return (
    <div className="space-y-4">
      <Grid n={5}>
        <Stat label="Onboarding not complete" value={h.onboarding.pendingCount} tone={h.onboarding.pendingCount ? 'warn' : null} />
        <Stat label="Helpdesk open" value={h.tickets.open} sub={`${h.tickets.openOverdue} older than 7 days · ${h.tickets.resolved} resolved`} tone={h.tickets.openOverdue ? 'warn' : null} />
        <Stat label="Avg days to resolve" value={h.tickets.avgResolutionDays ?? '—'} sub={h.tickets.resolutionN ? `n=${h.tickets.resolutionN}` : 'no resolved tickets with dates'} />
        <Stat label="Leavers with access still on" value={h.exits.pendingDeactivationCount} sub={`${h.exits.noExitRecord} with no exit record`} tone={h.exits.pendingDeactivationCount ? 'bad' : null} />
        <Stat label="Transfers this period" value={h.transfersInPeriod} />
      </Grid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Onboarding" subtitle="Stage of every active employee's onboarding."><MiniTable heads={['Stage', 'Employees']} rows={kv(h.onboarding.stages)} />{h.onboarding.pending.length > 0 && <div className="mt-3"><MiniTable heads={['Code', 'Employee', 'Department', 'Stage']} rows={h.onboarding.pending.map(r => [r.code, r.name, r.dept, r.stage])} /></div>}</Section>
        <Section title="Exit clearance & account deactivation"><MiniTable heads={['Code', 'Employee', 'Left', 'Exit record', 'Access removed']} rows={h.exits.leavers.map(l => [l.code, l.name, fmtD(l.lwd), l.exitStatus, l.accessDeactivated === true ? 'Yes' : <span key="n" className="text-red-700">{l.accessDeactivated === false ? 'No' : 'Not recorded'}</span>])} empty="No separated employees." /></Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Helpdesk"><MiniTable heads={['Status', 'Tickets']} rows={kv(h.tickets.byStatus)} empty="No tickets." />{h.tickets.openList.length > 0 && <div className="mt-3"><MiniTable heads={['Ticket', 'Age (days)']} rows={h.tickets.openList.slice(0, 10).map(t => [t.subject, t.ageDays])} /></div>}</Section>
        <Section title="Performance reviews & PIPs"><MiniTable heads={['Status', 'Count']} rows={[...kv(h.performance.byStatus).map(([k, v]) => [`Review: ${k}`, v]), ...kv(h.performance.pipStatus).map(([k, v]) => [`PIP: ${k}`, v])]} empty="No performance reviews or PIPs recorded." /></Section>
        <Section title="Training"><MiniTable heads={['Status', 'Enrolments']} rows={kv(h.training.byStatus)} empty="No training enrolments recorded." /></Section>
      </div>
      {rc && (
        <Section title="Recruitment detail" subtitle="Sources, offers and interviews — alongside the pipeline in Workforce & recruitment.">
          <Grid n={5}>
            <Stat label="Offers released" value={rc.offers.released} /><Stat label="Offers accepted" value={rc.offers.accepted} sub={rc.offers.acceptanceRate == null ? '' : `${rc.offers.acceptanceRate}% of released`} /><Stat label="Joined" value={rc.offers.joined} sub={rc.offers.offerToJoin == null ? '' : `${rc.offers.offerToJoin}% offer-to-joining`} />
            <Stat label="Interviews this period" value={rc.interviews.inPeriod} sub={`${rc.interviews.total} in total`} /><Stat label="Requisition status" value={Object.entries(rc.requisitionStatus).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} sub={rc.onHoldKnown ? '' : 'no on-hold status is used'} />
          </Grid>
          <div className="grid gap-4 lg:grid-cols-2 mt-3">
            <MiniTable heads={['Source', 'Candidates', 'Reached interview', 'Offered', 'Joined']} rows={rc.sources.map(s => [s.source, s.candidates, s.interviewed, s.offered, s.joined])} empty="No candidates." />
            <MiniTable heads={['Position', 'Department', 'Positions', 'Candidates', 'Interviewing', 'Offers', 'Joined']} rows={rc.positions.map(p => [p.position, p.dept, p.positions, p.candidates, p.interviewing, p.offers, p.joined])} empty="No open requisitions." />
          </div>
          {rc.recruiterWise?.unavailable && <div className="mt-3"><Unavailable>{rc.recruiterWise.reason}</Unavailable></div>}
        </Section>
      )}
    </div>
  );
}
