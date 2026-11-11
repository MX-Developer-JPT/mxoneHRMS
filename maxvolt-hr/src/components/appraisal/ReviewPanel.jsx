import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Save, Send, CheckCircle2, AlertTriangle, CalendarClock, Target, GraduationCap, ShieldCheck, FileDown } from 'lucide-react';
import { ap, STATUS_TONE, label, flat, MEETING_MODES, inputCls, confirmReason, fmtDate, fmtDateTime, saveBase64File } from '@/lib/appraisal';

const Field = ({ label: l, children, hint }) => (<label className="block text-sm"><span className="font-medium text-slate-700">{l}</span>{hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}<div className="mt-1">{children}</div></label>);
const Section = ({ title, children, right }) => (<div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold text-slate-800">{title}</h3>{right}</div>{children}</div>);
const RatingSelect = ({ scale, value, onChange, disabled }) => (
  <select className={inputCls} disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}>
    <option value="">— rate —</option>{[...scale].sort((a, b) => b.value - a.value).map(s => <option key={s.value} value={s.value}>{s.value} · {s.label}</option>)}
  </select>
);

export default function ReviewPanel({ reviewId, onChanged }) {
  const [data, setData] = useState(null);
  const [forms, setForms] = useState(null);
  const [tab, setTab] = useState('kpis');
  const [busy, setBusy] = useState(false);
  const [self, setSelf] = useState({ kpis: {}, questionnaire: {} });
  const [mgr, setMgr] = useState({ kpis: {}, questionnaire: {}, competencies: {} });
  const [declared, setDeclared] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([ap('ap_get_review', { review_id: reviewId }), forms ? Promise.resolve(forms) : ap('ap_get_forms')]);
      setData(d); setForms(f);
      const r = d.review; setSelf({ kpis: r.self?.kpis || {}, questionnaire: r.self?.questionnaire || {} });
      setMgr({ kpis: r.mgr?.kpis || {}, questionnaire: r.mgr?.questionnaire || {}, competencies: r.mgr?.competencies || {}, employee_feedback: r.mgr?.employee_feedback || '', confidential_note: r.mgr?.confidential_note || '', recommend_responsibility: r.mgr?.recommend_responsibility || '', recommend_training: r.mgr?.recommend_training || '' });
      setDeclared(false);
    } catch (e) { toast.error(e.message); }
  }, [reviewId]); // eslint-disable-line
  useEffect(() => { setData(null); load(); }, [load]);

  const act = async (fn, params, okMsg) => {
    setBusy(true);
    try { const d = await ap(fn, { review_id: reviewId, ...params }); if (okMsg) toast.success(okMsg); await load(); onChanged?.(); return d; }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  if (!data || !forms) return <div className="p-8 text-center text-slate-400"><Loader2 className="inline w-5 h-5 animate-spin" /></div>;
  const { review: r, goals, meetings, dev_plans, history } = data;
  const A = r.access, scale = r.cycle?.settings?.scale || [], kpis = flat(r.assignment?.items);
  const selfLocked = r.self_status === 'submitted';
  const canSelf = A.own && !selfLocked && r.assigned;
  const mgrLocked = r.mgr_status === 'submitted';
  const canMgr = A.can_evaluate && !mgrLocked && (r.self_status === 'submitted' || r.flags?.self_waived);
  const compOn = Number(r.cycle?.settings?.split?.competency) > 0;
  const tabs = [['kpis', 'KPIs & Scores'], ['self', 'Self-Assessment'], ...(A.can_evaluate || A.hr || (A.own && r.employee_visible) ? [['mgr', 'Manager Evaluation']] : []), ['meeting', 'Review Meeting'], ['goals', 'Goals'], ['dev', 'Development'], ...(A.hr ? [['hr', 'HR Decision']] : [])];
  const setSelfK = (id, k, v) => setSelf(s => ({ ...s, kpis: { ...s.kpis, [id]: { ...s.kpis[id], [k]: v } } }));
  const setMgrK = (id, k, v) => setMgr(s => ({ ...s, kpis: { ...s.kpis, [id]: { ...s.kpis[id], [k]: v } } }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div><div className="text-lg font-semibold text-slate-900">{r.emp.name} <span className="text-sm font-normal text-slate-500">{r.emp.code}</span></div>
          <div className="text-sm text-slate-500">{r.emp.designation} · {r.emp.department} · Manager: {r.emp.manager_name || '—'}</div></div>
        <Badge className={`${STATUS_TONE[r.status] || ''} border-0`}>{r.status_label}</Badge>
        {r.flags?.late_self && <Badge className="bg-red-50 text-red-700 border-0">Late self-assessment</Badge>}
        {r.flags?.no_manager && <Badge className="bg-amber-50 text-amber-800 border-0"><AlertTriangle className="w-3 h-3 mr-1" />No reporting manager</Badge>}
        <div className="ml-auto flex gap-2">
          {(A.hr || A.can_evaluate || A.own) && <Button size="sm" variant="outline" onClick={async () => { try { const d = await ap('ap_export', { report: 'individual', review_id: reviewId, cycle_id: r.cycle_id, format: 'pdf' }); saveBase64File(d.base64, d.filename, 'application/pdf'); } catch (e) { toast.error(e.message); } }}><FileDown className="w-4 h-4 mr-1" />PDF</Button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}
      </div>

      {tab === 'kpis' && (
        <Section title="KPIs / KRAs and scores">
          {!r.assigned ? <p className="text-sm text-amber-700">No KPIs assigned yet. {A.hr || A.can_evaluate ? 'Assign a template from Templates, or set KPIs for this employee below.' : 'Please contact your manager or HR.'}</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 border-b"><th className="py-2 pr-2">KRA / KPI</th><th className="px-2">Target</th><th className="px-2">Weight</th><th className="px-2">Self</th>{(A.can_evaluate || A.hr || r.employee_visible) && <th className="px-2">Manager</th>}</tr></thead>
              <tbody>{kpis.map(k => (<tr key={k.id} className="border-b last:border-0 align-top"><td className="py-2 pr-2"><div className="font-medium">{k.title}</div><div className="text-xs text-slate-500">{k.kra}{k.description ? ' · ' + k.description : ''}</div></td><td className="px-2">{k.target ?? '—'} {k.unit}</td><td className="px-2">{k.weight}%</td>
                <td className="px-2">{r.scores?.self_rows?.find(x => x.id === k.id)?.rating ?? '—'}</td>
                {(A.can_evaluate || A.hr || r.employee_visible) && <td className="px-2">{r.scores?.manager_rows?.find(x => x.id === k.id)?.rating ?? '—'}</td>}</tr>))}</tbody></table></div>)}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            {[['Self score', r.scores?.self], ...((A.can_evaluate || A.hr) ? [['Manager score', r.scores?.manager]] : []), ...((A.hr) ? [['HR adjusted', r.scores?.hr_adjusted]] : []), ...((A.hr || A.can_evaluate || r.employee_visible) ? [['Final', r.scores?.final]] : [])].map(([l, v]) => (
              <div key={l} className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">{l}</div><div className="text-xl font-semibold">{v ?? '—'}</div></div>))}
            {(A.hr || A.can_evaluate || r.employee_visible) && r.scores?.band && <div className="rounded-md bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Rating</div><div className="text-lg font-semibold text-emerald-800">{r.scores.band}</div></div>}
          </div>
          {A.own && !r.employee_visible && <p className="text-xs text-slate-500">Your manager's rating and the final result become visible after HR publishes the results.</p>}
          {(A.hr || A.can_evaluate) && r.assigned && !['approved', 'published', 'closed'].includes(r.hr_status) && <KpiEditor r={r} act={act} />}
          {history?.length > 0 && <div className="text-xs text-slate-500">Previous cycles: {history.map((h, i) => <span key={i} className="mr-3">{h.final} ({h.band})</span>)}</div>}
        </Section>)}

      {tab === 'self' && (
        <div className="space-y-4">
          {selfLocked && <div className="rounded-md bg-emerald-50 text-emerald-800 text-sm p-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Submitted {fmtDateTime(r.self?.submitted_at)}{r.self?.late ? ' (late)' : ''}. {A.hr ? '' : 'Contact HR if it needs to be reopened.'}</div>}
          {!r.assigned && <div className="text-sm text-amber-700">KPIs are not assigned yet — the self-assessment opens once they are.</div>}
          {r.assigned && <Section title="KPI-wise self-assessment">
            {kpis.map(k => { const v = self.kpis[k.id] || {}; return (
              <div key={k.id} className="rounded-md border border-slate-200 p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2"><div><div className="font-medium">{k.title}</div><div className="text-xs text-slate-500">{k.kra} · weight {k.weight}% · target {k.target ?? '—'} {k.unit}</div></div></div>
                <div className="grid md:grid-cols-3 gap-3">
                  <Field label="Actual achievement"><input className={inputCls} disabled={!canSelf} value={v.actual || ''} onChange={e => setSelfK(k.id, 'actual', e.target.value)} /></Field>
                  <Field label="Self rating"><RatingSelect scale={scale} value={v.rating} disabled={!canSelf} onChange={x => setSelfK(k.id, 'rating', x)} /></Field>
                </div>
                <Field label="Explanation"><textarea rows={2} className={inputCls} disabled={!canSelf} value={v.explanation || ''} onChange={e => setSelfK(k.id, 'explanation', e.target.value)} /></Field>
                <div className="grid md:grid-cols-2 gap-3"><Field label="Challenges"><textarea rows={2} className={inputCls} disabled={!canSelf} value={v.challenges || ''} onChange={e => setSelfK(k.id, 'challenges', e.target.value)} /></Field>
                  <Field label="Evidence / supporting links" hint="one per line"><textarea rows={2} className={inputCls} disabled={!canSelf} value={(v.evidence || []).map(x => x.url).join('\n')} onChange={e => setSelfK(k.id, 'evidence', e.target.value.split('\n').filter(Boolean).map(u => ({ name: u.slice(0, 60), url: u })))} /></Field></div>
              </div>); })}
          </Section>}
          {r.assigned && forms.self.map(sec => (
            <Section key={sec.id} title={`Section ${sec.id}: ${sec.title}`}>
              {sec.questions.map(q => <Field key={q.id} label={q.text}><textarea rows={2} className={inputCls} disabled={!canSelf} value={self.questionnaire[q.id] || ''} onChange={e => setSelf(s => ({ ...s, questionnaire: { ...s.questionnaire, [q.id]: e.target.value } }))} /></Field>)}
            </Section>))}
          {canSelf && <Section title="Declaration">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={declared} onChange={e => setDeclared(e.target.checked)} />{forms.declaration}</label>
            <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => act('ap_save_self', { kpis: self.kpis, questionnaire: self.questionnaire }, 'Draft saved')}><Save className="w-4 h-4 mr-1" />Save draft</Button>
              <Button disabled={busy || !declared} onClick={() => act('ap_submit_self', { kpis: self.kpis, questionnaire: self.questionnaire, declaration: true }, 'Self-assessment submitted')}><Send className="w-4 h-4 mr-1" />Submit</Button></div>
          </Section>}
          {A.hr && selfLocked && <Button variant="outline" onClick={() => { const reason = confirmReason('Reason for reopening this self-assessment (the old version is kept):'); if (reason) act('ap_reopen_self', { reason }, 'Reopened'); }}>Reopen self-assessment</Button>}
          {A.hr && !selfLocked && !r.flags?.self_waived && <Button variant="outline" onClick={() => { const reason = confirmReason('Reason for waiving the self-assessment (manager can then evaluate without it):'); if (reason) act('ap_waive_self', { reason }, 'Waived'); }}>Waive self-assessment</Button>}
          {r.self_versions?.length > 0 && <p className="text-xs text-slate-500">{r.self_versions.length} earlier version(s) kept (reopened {r.self_versions.map(v => fmtDate(v.archived_at)).join(', ')}).</p>}
        </div>)}

      {tab === 'mgr' && (
        <div className="space-y-4">
          {!(A.can_evaluate || A.hr || r.employee_visible) ? <p className="text-sm text-slate-500">Not visible yet.</p> : <>
            {mgrLocked && <div className="rounded-md bg-emerald-50 text-emerald-800 text-sm p-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />Submitted {fmtDateTime(r.mgr?.submitted_at)}.</div>}
            {A.can_evaluate && !mgrLocked && !canMgr && <div className="rounded-md bg-amber-50 text-amber-800 text-sm p-3">Waiting for the employee's self-assessment. {A.hr ? 'You can waive it from the Self-Assessment tab.' : ''}</div>}
            <Section title="KPI-wise evaluation (independent of the employee's rating)">
              {kpis.map(k => { const v = mgr.kpis[k.id] || {}; const s = self.kpis[k.id] || r.self?.kpis?.[k.id] || {}; const gap = r.scores?.gaps?.find(g => g.kpi_id === k.id); return (
                <div key={k.id} className={`rounded-md border p-3 space-y-2 ${gap ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                  <div className="flex justify-between gap-2"><div><div className="font-medium">{k.title}</div><div className="text-xs text-slate-500">weight {k.weight}% · target {k.target ?? '—'} {k.unit}</div></div>
                    <div className="text-xs text-slate-600 text-right">Employee: rating <b>{s.rating ?? '—'}</b>, actual <b>{s.actual || '—'}</b>{gap && <div className="text-amber-700">Large gap ({gap.gap})</div>}</div></div>
                  {s.explanation && <div className="text-xs bg-slate-50 rounded p-2 text-slate-600">“{s.explanation}”</div>}
                  <div className="grid md:grid-cols-3 gap-3"><Field label="Verified achievement"><input className={inputCls} disabled={!canMgr} value={v.verified_actual || ''} onChange={e => setMgrK(k.id, 'verified_actual', e.target.value)} /></Field>
                    <Field label="Manager rating"><RatingSelect scale={scale} value={v.rating} disabled={!canMgr} onChange={x => setMgrK(k.id, 'rating', x)} /></Field></div>
                  <div className="grid md:grid-cols-2 gap-3"><Field label="Remarks"><textarea rows={2} className={inputCls} disabled={!canMgr} value={v.remarks || ''} onChange={e => setMgrK(k.id, 'remarks', e.target.value)} /></Field>
                    <Field label="Performance gap / improvement"><textarea rows={2} className={inputCls} disabled={!canMgr} value={v.gap || ''} onChange={e => setMgrK(k.id, 'gap', e.target.value)} /></Field></div>
                </div>); })}
            </Section>
            {compOn && <Section title="Competencies">
              <div className="grid md:grid-cols-2 gap-3">{(r.cycle.settings.competencies || []).filter(c => c.enabled).map(c => <Field key={c.id} label={c.name}><RatingSelect scale={scale} value={mgr.competencies[c.id]} disabled={!canMgr} onChange={x => setMgr(s => ({ ...s, competencies: { ...s.competencies, [c.id]: x } }))} /></Field>)}</div></Section>}
            <Section title="Evaluation summary">
              {forms.manager.flatMap(s => s.questions).map(q => <Field key={q.id} label={q.text + (q.required ? ' *' : '')}><textarea rows={2} className={inputCls} disabled={!canMgr} value={mgr.questionnaire[q.id] || ''} onChange={e => setMgr(s => ({ ...s, questionnaire: { ...s.questionnaire, [q.id]: e.target.value } }))} /></Field>)}
              <Field label="Feedback for the employee"><textarea rows={2} className={inputCls} disabled={!canMgr} value={mgr.employee_feedback || ''} onChange={e => setMgr(s => ({ ...s, employee_feedback: e.target.value }))} /></Field>
              {A.can_evaluate && <Field label="Confidential note to HR" hint="never shown to the employee or senior managers"><textarea rows={2} className={inputCls} disabled={!canMgr} value={mgr.confidential_note || ''} onChange={e => setMgr(s => ({ ...s, confidential_note: e.target.value }))} /></Field>}
              <div className="grid md:grid-cols-2 gap-3"><Field label="Recommended responsibilities / promotion"><textarea rows={2} className={inputCls} disabled={!canMgr} value={mgr.recommend_responsibility || ''} onChange={e => setMgr(s => ({ ...s, recommend_responsibility: e.target.value }))} /></Field>
                <Field label="Recommended training"><textarea rows={2} className={inputCls} disabled={!canMgr} value={mgr.recommend_training || ''} onChange={e => setMgr(s => ({ ...s, recommend_training: e.target.value }))} /></Field></div>
              {canMgr && <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => act('ap_save_manager_eval', mgr, 'Draft saved')}><Save className="w-4 h-4 mr-1" />Save draft</Button>
                <Button disabled={busy} onClick={() => { if (confirm('Submit this evaluation? It cannot be changed afterwards unless HR returns it.')) act('ap_submit_manager_eval', mgr, 'Evaluation submitted'); }}><Send className="w-4 h-4 mr-1" />Submit evaluation</Button></div>}
            </Section></>}
        </div>)}

      {tab === 'meeting' && <MeetingTab r={r} meetings={meetings} act={act} />}
      {tab === 'goals' && <GoalsTab r={r} goals={goals} act={act} />}
      {tab === 'dev' && <DevTab r={r} plans={dev_plans} act={act} />}
      {tab === 'hr' && A.hr && <HrTab r={r} act={act} reviewId={reviewId} />}
      {A.own && r.hr_status === 'published' && !r.employee_ack && tab === 'kpis' && <AckResult act={act} />}
    </div>
  );
}

function KpiEditor({ r, act }) {
  const [open, setOpen] = useState(false); const [items, setItems] = useState(null);
  const start = () => { setItems(JSON.parse(JSON.stringify(r.assignment.items))); setOpen(true); };
  const total = items ? items.flatMap(k => k.kpis).reduce((a, p) => a + (Number(p.weight) || 0), 0) : 0;
  if (!open) return <Button size="sm" variant="outline" onClick={start}>Change KPIs for this employee</Button>;
  const setP = (ki, pi, k, v) => setItems(it => it.map((kr, i) => i !== ki ? kr : { ...kr, kpis: kr.kpis.map((p, j) => j !== pi ? p : { ...p, [k]: v }) }));
  return (<div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 space-y-2">
    <div className="text-sm font-medium">Employee-specific KPIs <span className={total === 100 ? 'text-emerald-700' : 'text-red-600'}>(total {total}%)</span></div>
    {items.map((kr, ki) => <div key={kr.id} className="space-y-1"><div className="text-xs font-medium text-slate-600">{kr.title}</div>{kr.kpis.map((p, pi) => <div key={p.id} className="grid grid-cols-12 gap-2"><input className={`${inputCls} col-span-6`} value={p.title} onChange={e => setP(ki, pi, 'title', e.target.value)} /><input className={`${inputCls} col-span-3`} placeholder="Target" value={p.target ?? ''} onChange={e => setP(ki, pi, 'target', e.target.value)} /><input className={`${inputCls} col-span-3`} type="number" placeholder="Weight" value={p.weight} onChange={e => setP(ki, pi, 'weight', e.target.value)} /></div>)}</div>)}
    <div className="flex gap-2"><Button size="sm" disabled={total !== 100} onClick={() => { const reason = confirmReason('Reason for changing this employee\'s KPIs:'); if (reason) { act('ap_set_employee_kpis', { items, reason }, 'KPIs updated'); setOpen(false); } }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div></div>);
}

function AckResult({ act }) {
  const [c, setC] = useState('');
  return (<Section title="Your result"><p className="text-sm text-slate-600">You can record a comment on your published result. This does not change the rating.</p><textarea rows={2} className={inputCls} value={c} onChange={e => setC(e.target.value)} placeholder="Optional comment" />
    <div className="flex gap-2"><Button size="sm" onClick={() => act('ap_ack_result', { agrees: true, comment: c }, 'Recorded')}>I have read it</Button><Button size="sm" variant="outline" onClick={() => act('ap_ack_result', { agrees: false, comment: c }, 'Recorded')}>I disagree — add comment</Button></div></Section>);
}

function MeetingTab({ r, meetings, act }) {
  const A = r.access; const [f, setF] = useState({ date: '', start_time: '', end_time: '', mode: 'teams', link: '', location: '', agenda: '' }); const [done, setDone] = useState(null);
  const [c, setC] = useState({ discussion_summary: '', strengths: '', improvement_areas: '', employee_feedback: '', manager_feedback: '', follow_up_date: '', action_items: [{ text: '', owner: '', due: '' }] });
  const [ack, setAck] = useState('');
  return (<div className="space-y-4">
    {meetings.map(m => (<Section key={m.id} title={`${fmtDate(m.date)}${m.start_time ? ' · ' + m.start_time : ''} · ${label(m.mode)}`} right={<Badge className="border-0 bg-indigo-50 text-indigo-800">{label(m.status)}</Badge>}>
      {m.link && <a className="text-sm text-blue-600 underline" href={m.link} target="_blank" rel="noreferrer">Join link</a>}{m.agenda && <p className="text-sm text-slate-600">Agenda: {m.agenda}</p>}
      {m.status === 'completed' && <div className="text-sm space-y-1"><p><b>Summary:</b> {m.discussion_summary}</p><p><b>Strengths:</b> {m.strengths}</p><p><b>Improvement areas:</b> {m.improvement_areas}</p><div><b>Action items:</b><ul className="list-disc ml-5">{(m.action_items || []).map((a, i) => <li key={i}>{a.text}{a.owner ? ` — ${a.owner}` : ''}{a.due ? ` (by ${fmtDate(a.due)})` : ''}</li>)}</ul></div>
        {m.employee_ack ? <p className="text-xs text-slate-500">Employee acknowledged {fmtDate(m.employee_ack.at)}{m.employee_ack.agrees ? '' : ' with comments'}: {m.employee_ack.comment}</p> : A.own && <div className="space-y-2 pt-2"><textarea rows={2} className={inputCls} placeholder="Optional comment (does not change your rating)" value={ack} onChange={e => setAck(e.target.value)} /><div className="flex gap-2"><Button size="sm" onClick={() => act('ap_ack_meeting', { meeting_id: m.id, agrees: true, comment: ack }, 'Acknowledged')}>Acknowledge discussion</Button><Button size="sm" variant="outline" onClick={() => act('ap_ack_meeting', { meeting_id: m.id, agrees: false, comment: ack }, 'Recorded')}>Add disagreement</Button></div></div>}</div>}
      {m.status !== 'completed' && m.status !== 'cancelled' && (A.can_evaluate || A.hr) && <div className="flex gap-2"><Button size="sm" onClick={() => setDone(m.id)}>Record outcome</Button><Button size="sm" variant="outline" onClick={() => { if (confirm('Cancel this meeting?')) act('ap_save_meeting', { meeting_id: m.id, date: m.date, mode: m.mode, cancel: true }, 'Cancelled'); }}>Cancel</Button></div>}
      {done === m.id && <div className="space-y-2 border-t pt-3">
        {[['discussion_summary', 'Discussion summary *'], ['strengths', 'Key strengths discussed *'], ['improvement_areas', 'Improvement areas *'], ['employee_feedback', 'Employee feedback'], ['manager_feedback', 'Manager feedback']].map(([k, l]) => <Field key={k} label={l}><textarea rows={2} className={inputCls} value={c[k]} onChange={e => setC({ ...c, [k]: e.target.value })} /></Field>)}
        <div className="text-sm font-medium">Action items *</div>{c.action_items.map((a, i) => <div key={i} className="grid grid-cols-12 gap-2"><input className={`${inputCls} col-span-6`} placeholder="Action" value={a.text} onChange={e => setC({ ...c, action_items: c.action_items.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /><input className={`${inputCls} col-span-3`} placeholder="Owner" value={a.owner} onChange={e => setC({ ...c, action_items: c.action_items.map((x, j) => j === i ? { ...x, owner: e.target.value } : x) })} /><input type="date" className={`${inputCls} col-span-3`} value={a.due} onChange={e => setC({ ...c, action_items: c.action_items.map((x, j) => j === i ? { ...x, due: e.target.value } : x) })} /></div>)}
        <Button size="sm" variant="ghost" onClick={() => setC({ ...c, action_items: [...c.action_items, { text: '', owner: '', due: '' }] })}>+ Add action</Button>
        <div><Button onClick={() => act('ap_complete_meeting', { ...c, meeting_id: m.id }, 'Meeting completed').then(() => setDone(null))}>Complete meeting</Button></div></div>}
    </Section>))}
    {(A.can_evaluate || A.hr) && <Section title="Schedule a meeting">
      <div className="grid md:grid-cols-4 gap-3"><Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field><Field label="Start"><input type="time" className={inputCls} value={f.start_time} onChange={e => setF({ ...f, start_time: e.target.value })} /></Field><Field label="End"><input type="time" className={inputCls} value={f.end_time} onChange={e => setF({ ...f, end_time: e.target.value })} /></Field>
        <Field label="Mode"><select className={inputCls} value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}>{MEETING_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field></div>
      <div className="grid md:grid-cols-2 gap-3"><Field label="Location / meeting link"><input className={inputCls} value={f.mode === 'in_person' ? f.location : f.link} onChange={e => setF(f.mode === 'in_person' ? { ...f, location: e.target.value } : { ...f, link: e.target.value })} /></Field><Field label="Agenda"><input className={inputCls} value={f.agenda} onChange={e => setF({ ...f, agenda: e.target.value })} /></Field></div>
      <Button onClick={() => act('ap_save_meeting', f, 'Meeting scheduled')}><CalendarClock className="w-4 h-4 mr-1" />Schedule</Button></Section>}
    {!meetings.length && !(A.can_evaluate || A.hr) && <p className="text-sm text-slate-500">No meeting scheduled yet.</p>}
  </div>);
}

function GoalsTab({ r, goals, act }) {
  const A = r.access; const [g, setG] = useState({ title: '', description: '', target: '', due_date: '', priority: 'medium' });
  const upd = (goal, extra) => { const progress = window.prompt('Progress % (0-100):', goal[A.own ? 'reported_progress' : 'verified_progress'] ?? ''); if (progress === null) return; const comment = window.prompt('Comment (optional):', '') || ''; act('ap_update_goal_progress', { goal_id: goal.id, progress: Number(progress), comment, ...extra }, 'Progress updated'); };
  return (<div className="space-y-3">
    {goals.map(x => (<Section key={x.id} title={x.title} right={<Badge className="border-0 bg-slate-100 text-slate-700">{label(x.status)}</Badge>}>
      <p className="text-sm text-slate-600">{x.description} {x.target && <span>· Target: {x.target}</span>} {x.due_date && <span>· Due {fmtDate(x.due_date)}</span>}</p>
      <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded bg-slate-50 p-2">Employee reported<div className="text-lg font-semibold">{x.reported_progress ?? '—'}{x.reported_progress != null && '%'}</div><div className="text-xs text-slate-500">{x.employee_comment}</div></div><div className="rounded bg-emerald-50 p-2">Manager verified<div className="text-lg font-semibold">{x.verified_progress ?? '—'}{x.verified_progress != null && '%'}</div><div className="text-xs text-slate-500">{x.manager_comment}</div></div></div>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => upd(x)}>{A.own ? 'Report progress' : 'Verify progress'}</Button>
        <select className="text-sm border rounded px-2" value={x.status} onChange={e => act('ap_update_goal_progress', { goal_id: x.id, status: e.target.value, progress: x[A.own ? 'reported_progress' : 'verified_progress'] ?? 0 }, 'Status updated')}>{['not_started', 'in_progress', 'completed', 'delayed', 'cancelled'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></div>
    </Section>))}
    {!goals.length && <p className="text-sm text-slate-500">No goals yet.</p>}
    <Section title="Add a goal"><div className="grid md:grid-cols-4 gap-3"><div className="md:col-span-2"><Field label="Title"><input className={inputCls} value={g.title} onChange={e => setG({ ...g, title: e.target.value })} /></Field></div><Field label="Target"><input className={inputCls} value={g.target} onChange={e => setG({ ...g, target: e.target.value })} /></Field><Field label="Due"><input type="date" className={inputCls} value={g.due_date} onChange={e => setG({ ...g, due_date: e.target.value })} /></Field></div>
      <Field label="Description"><textarea rows={2} className={inputCls} value={g.description} onChange={e => setG({ ...g, description: e.target.value })} /></Field>
      <Button onClick={() => act('ap_save_goal', g, 'Goal saved').then(() => setG({ title: '', description: '', target: '', due_date: '', priority: 'medium' }))}><Target className="w-4 h-4 mr-1" />Add goal</Button></Section>
  </div>);
}

function DevTab({ r, plans, act }) {
  const A = r.access; const [programs, setPrograms] = useState([]); const [p, setP] = useState({ skill_gap: '', recommended_training: '', category: 'technical', priority: 'medium', target_date: '', training_program_id: '' });
  useEffect(() => { if (A.can_evaluate || A.hr) ap('ap_list_dev_plans', { cycle_id: r.cycle_id }).then(d => setPrograms(d.programs || [])).catch(() => {}); }, [r.cycle_id]); // eslint-disable-line
  return (<div className="space-y-3">
    {plans.map(x => (<Section key={x.id} title={x.recommended_training} right={<Badge className="border-0 bg-slate-100 text-slate-700">{label(x.status)}</Badge>}>
      <p className="text-sm text-slate-600">Gap: {x.skill_gap} · {label(x.category)} · {label(x.priority)} priority{x.target_date ? ` · by ${fmtDate(x.target_date)}` : ''}{x.training_program_name ? ` · Programme: ${x.training_program_name}` : ''}</p>
      {(A.can_evaluate || A.hr) && <select className="text-sm border rounded px-2 py-1" value={x.status} onChange={e => act('ap_save_dev_plan', { ...x, plan_id: x.id, status: e.target.value }, 'Updated')}>{['recommended', 'planned', 'in_progress', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select>}
    </Section>))}
    {!plans.length && <p className="text-sm text-slate-500">No training or development recommendations yet.</p>}
    {(A.can_evaluate || A.hr) && <Section title="Recommend training"><div className="grid md:grid-cols-2 gap-3"><Field label="Skill gap"><input className={inputCls} value={p.skill_gap} onChange={e => setP({ ...p, skill_gap: e.target.value })} /></Field><Field label="Recommended training"><input className={inputCls} value={p.recommended_training} onChange={e => setP({ ...p, recommended_training: e.target.value })} /></Field>
      <Field label="Category"><select className={inputCls} value={p.category} onChange={e => setP({ ...p, category: e.target.value })}>{['technical', 'communication', 'leadership', 'management', 'process', 'compliance', 'software', 'functional'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
      <Field label="Priority"><select className={inputCls} value={p.priority} onChange={e => setP({ ...p, priority: e.target.value })}>{['low', 'medium', 'high'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
      <Field label="Target date"><input type="date" className={inputCls} value={p.target_date} onChange={e => setP({ ...p, target_date: e.target.value })} /></Field>
      <Field label="Link to existing training programme"><select className={inputCls} value={p.training_program_id} onChange={e => setP({ ...p, training_program_id: e.target.value })}><option value="">— none —</option>{programs.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field></div>
      <Button onClick={() => act('ap_save_dev_plan', p, 'Recommendation saved')}><GraduationCap className="w-4 h-4 mr-1" />Save recommendation</Button></Section>}
  </div>);
}

function HrTab({ r, act }) {
  const [score, setScore] = useState(r.scores?.hr_adjusted ?? ''); const [reason, setReason] = useState(''); const [mgrId, setMgrId] = useState(''); const [people, setPeople] = useState([]);
  useEffect(() => { ap('ap_cycle_roster', { cycle_id: r.cycle_id }).then(d => setPeople(d.reviews.map(x => ({ user_id: x.user_id, name: x.name, designation: x.designation })))).catch(() => {}); }, [r.cycle_id]); // eslint-disable-line
  const dec = (action, extra = {}) => act('ap_hr_decide', { action, ...extra }, label(action) + ' done');
  const need = (msg) => confirmReason(msg);
  return (<div className="space-y-4">
    <Section title="Calibration"><div className="grid grid-cols-3 gap-3 text-sm"><div className="rounded bg-slate-50 p-3">Original manager score<div className="text-xl font-semibold">{r.scores?.original_manager ?? r.scores?.manager ?? '—'}</div></div><div className="rounded bg-slate-50 p-3">HR adjusted<div className="text-xl font-semibold">{r.scores?.hr_adjusted ?? '—'}</div></div><div className="rounded bg-emerald-50 p-3">Final<div className="text-xl font-semibold">{r.scores?.final ?? '—'} <span className="text-sm">{r.scores?.band}</span></div></div></div>
      {r.scores?.gaps?.length > 0 && <p className="text-sm text-amber-700">{r.scores.gaps.length} KPI(s) with a large gap between self and manager rating.</p>}
      <div className="grid md:grid-cols-4 gap-3"><Field label="Adjusted score (0–100)"><input type="number" className={inputCls} value={score} onChange={e => setScore(e.target.value)} /></Field><div className="md:col-span-3"><Field label="Reason (mandatory)"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field></div></div>
      <div className="flex gap-2"><Button disabled={score === '' || !reason} onClick={() => act('ap_hr_adjust', { score: Number(score), reason }, 'Score adjusted')}>Apply adjustment</Button><Button variant="outline" disabled={!reason || r.scores?.hr_adjusted == null} onClick={() => act('ap_hr_adjust', { clear: true, reason }, 'Adjustment removed')}>Remove adjustment</Button></div>
      {r.adjustments?.length > 0 && <ul className="text-xs text-slate-500 list-disc ml-5">{r.adjustments.map((a, i) => <li key={i}>{fmtDateTime(a.at)}: {a.from ?? '—'} → {a.to ?? 'removed'} — {a.reason}</li>)}</ul>}</Section>
    <Section title="Decision"><div className="flex flex-wrap gap-2">
      <Button onClick={() => { if (r.meeting_status === 'completed' || r.meeting_required === false) return dec('approve'); const x = need('The review meeting is not completed. Reason to approve anyway (Cancel to stop):'); if (x) dec('approve', { override_meeting: true, reason: x }); }}><ShieldCheck className="w-4 h-4 mr-1" />Approve</Button>
      <Button variant="outline" onClick={() => { const reason = need('What needs to be corrected?'); if (reason) dec('return', { to: 'manager', reason }); }}>Return to manager</Button>
      <Button variant="outline" onClick={() => { const reason = need('What needs to be corrected?'); if (reason) dec('return', { to: 'employee', reason }); }}>Return to employee</Button>
      <Button variant="outline" onClick={() => { const reason = need('Clarification needed from the manager:'); if (reason) dec('clarify', { reason }); }}>Request clarification</Button>
      <Button variant="outline" disabled={r.hr_status !== 'approved'} onClick={() => dec('publish')}>Publish to employee</Button>
      <Button variant="outline" onClick={() => { const reason = need('Reason for reopening:'); if (reason) dec('reopen', { reason }); }}>Reopen</Button></div>
      {r.hr?.decision_log?.length > 0 && <ul className="text-xs text-slate-500 list-disc ml-5">{r.hr.decision_log.map((d, i) => <li key={i}>{fmtDateTime(d.at)} — {label(d.action)}{d.reason ? `: ${d.reason}` : ''}</li>)}</ul>}</Section>
    <Section title="Reporting manager"><div className="flex gap-2"><select className={inputCls} value={mgrId} onChange={e => setMgrId(e.target.value)}><option value="">— choose new reviewer —</option>{people.filter(x => x.user_id !== r.user_id).map(x => <option key={x.user_id} value={x.user_id}>{x.name} ({x.designation})</option>)}</select><Button variant="outline" disabled={!mgrId} onClick={() => { const reason = need('Reason for reassigning the reviewer:'); if (reason) act('ap_reassign_manager', { manager_id: mgrId, reason }, 'Reassigned'); }}>Reassign</Button></div></Section>
  </div>);
}
