import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Copy, Users } from 'lucide-react';
import { ap, CYCLE_TONE, label, inputCls, confirmReason, fmtDate } from '@/lib/appraisal';

const Field = ({ label: l, children }) => (<label className="block text-sm"><span className="font-medium text-slate-700">{l}</span><div className="mt-1">{children}</div></label>);
const NEXT = { draft: 'configured', configured: 'published', published: 'in_progress', in_progress: 'under_hr_review', under_hr_review: 'finalised', finalised: 'closed', closed: 'archived' };
const blank = { name: '', financial_year: '', type: 'mid_year', review_start: '', review_end: '', deadlines: { self: '', manager: '', meeting: '', hr: '' }, eligibility: { departments: [], designations: [], categories: [], joined_on_or_before: '' }, template_id: '', include_competencies: false, allow_late_submission: true, meeting_required: true, notes: '' };

export default function CyclesAdmin({ onChanged }) {
  const [cycles, setCycles] = useState([]); const [templates, setTemplates] = useState([]); const [edit, setEdit] = useState(null); const [roster, setRoster] = useState(null); const [preview, setPreview] = useState(null); const [forms, setForms] = useState(null);
  const load = useCallback(async () => { try { const [c, t, f] = await Promise.all([ap('ap_list_cycles'), ap('ap_list_templates'), ap('ap_get_forms')]); setCycles(c.cycles); setTemplates(t.templates); setForms(f); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const done = () => { load(); onChanged?.(); };
  const move = async (c, to) => {
    let reason = '';
    if (to === 'closed' && c.counts && c.counts.finalised < c.counts.employees) { reason = confirmReason(`${c.counts.employees - c.counts.finalised} appraisal(s) are not published. Reason to close anyway (Cancel to stop):`); if (!reason) return; }
    else if (!confirm(`Move "${c.name}" to ${label(to)}?${to === 'published' ? ' This creates an appraisal for every eligible employee and notifies them.' : ''}`)) return;
    try { await ap('ap_set_cycle_status', { cycle_id: c.id, status: to, reason, force: !!reason }); toast.success(`Cycle is now ${label(to)}`); done(); } catch (e) { toast.error(e.message); }
  };
  const reopen = async (c) => { const reason = confirmReason('Reason for reopening this cycle:'); if (!reason) return; const back = { closed: 'finalised', archived: 'closed', finalised: 'under_hr_review', under_hr_review: 'in_progress' }[c.status]; try { await ap('ap_set_cycle_status', { cycle_id: c.id, status: back, reason }); toast.success('Reopened'); done(); } catch (e) { toast.error(e.message); } };
  const save = async (status) => { try { await ap('ap_save_cycle', { ...edit, status }); toast.success('Saved'); setEdit(null); done(); } catch (e) { toast.error(e.message); } };
  const doPreview = async () => { try { setPreview(await ap('ap_eligible_preview', edit)); } catch (e) { toast.error(e.message); } };
  const openRoster = async (c) => { try { setRoster({ c, ...(await ap('ap_cycle_roster', { cycle_id: c.id })) }); } catch (e) { toast.error(e.message); } };
  const setL = (k, v) => setEdit(e => ({ ...e, [k]: v })); const setD = (k, v) => setEdit(e => ({ ...e, deadlines: { ...e.deadlines, [k]: v } })); const setE = (k, v) => setEdit(e => ({ ...e, eligibility: { ...e.eligibility, [k]: v } }));
  const csv = (a) => (a || []).join(', '); const unCsv = (s) => s.split(',').map(x => x.trim()).filter(Boolean);

  if (edit) {
    const locked = edit.id && !['draft', 'configured'].includes(edit.status);
    return (<div className="space-y-4 max-w-4xl">
      <h3 className="text-lg font-semibold">{edit.id ? 'Edit cycle' : 'New appraisal cycle'}</h3>
      {locked && <div className="text-sm bg-amber-50 text-amber-800 rounded p-3">This cycle is {label(edit.status)}. Only deadlines and notes can change, and every change is recorded.</div>}
      <div className="grid md:grid-cols-3 gap-3"><div className="md:col-span-2"><Field label="Cycle name"><input className={inputCls} disabled={locked} value={edit.name} onChange={e => setL('name', e.target.value)} /></Field></div><Field label="Financial year"><input className={inputCls} disabled={locked} placeholder="2026-27" value={edit.financial_year} onChange={e => setL('financial_year', e.target.value)} /></Field>
        <Field label="Cycle type"><select className={inputCls} disabled={locked} value={edit.type} onChange={e => setL('type', e.target.value)}>{(forms?.cycle_types || []).map(t => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
        <Field label="Review period start"><input type="date" className={inputCls} disabled={locked} value={edit.review_start} onChange={e => setL('review_start', e.target.value)} /></Field><Field label="Review period end"><input type="date" className={inputCls} disabled={locked} value={edit.review_end} onChange={e => setL('review_end', e.target.value)} /></Field></div>
      <div className="grid md:grid-cols-4 gap-3">{[['self', 'Self-assessment deadline'], ['manager', 'Manager evaluation deadline'], ['meeting', 'Review meeting deadline'], ['hr', 'HR finalisation deadline']].map(([k, l]) => <Field key={k} label={l}><input type="date" className={inputCls} value={edit.deadlines[k]} onChange={e => setD(k, e.target.value)} /></Field>)}</div>
      <div className="grid md:grid-cols-2 gap-3"><Field label="Eligible departments (comma separated, blank = all)"><input className={inputCls} disabled={locked} value={csv(edit.eligibility.departments)} onChange={e => setE('departments', unCsv(e.target.value))} /></Field><Field label="Eligible designations (blank = all)"><input className={inputCls} disabled={locked} value={csv(edit.eligibility.designations)} onChange={e => setE('designations', unCsv(e.target.value))} /></Field>
        <Field label="Employee categories (blank = all)"><input className={inputCls} disabled={locked} value={csv(edit.eligibility.categories)} onChange={e => setE('categories', unCsv(e.target.value))} /></Field><Field label="Joined on or before"><input type="date" className={inputCls} disabled={locked} value={edit.eligibility.joined_on_or_before} onChange={e => setE('joined_on_or_before', e.target.value)} /></Field>
        <Field label="Apply this template to everyone (optional)"><select className={inputCls} disabled={locked} value={edit.template_id} onChange={e => setL('template_id', e.target.value)}><option value="">— match by designation / department —</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}</select></Field></div>
      <div className="flex flex-wrap gap-5 text-sm">{[['include_competencies', 'Include competency scoring'], ['allow_late_submission', 'Allow late submissions (flagged, never auto-rejected)'], ['meeting_required', 'Review meeting required before HR approval']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={locked && k !== 'allow_late_submission'} checked={!!edit[k]} onChange={e => setL(k, e.target.checked)} />{l}</label>)}</div>
      <Field label="Notes"><textarea rows={2} className={inputCls} value={edit.notes} onChange={e => setL('notes', e.target.value)} /></Field>
      {!locked && <div><Button size="sm" variant="outline" onClick={doPreview}><Users className="w-4 h-4 mr-1" />Preview eligible employees</Button>{preview && <span className="ml-3 text-sm text-slate-600">{preview.count} eligible{preview.without_manager > 0 ? ` · ${preview.without_manager} have no reporting manager` : ''}</span>}</div>}
      <div className="flex gap-2"><Button onClick={() => save(edit.status === 'draft' || !edit.id ? 'draft' : edit.status)}>Save</Button>{!locked && <Button variant="outline" onClick={() => save('configured')}>Save &amp; mark ready</Button>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
    </div>);
  }
  if (roster) return (<div className="space-y-3"><div className="flex items-center gap-3"><Button size="sm" variant="ghost" onClick={() => setRoster(null)}>← Back</Button><h3 className="font-semibold">{roster.c.name} — employees</h3></div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-500 border-b"><th className="py-2">Employee</th><th>Department</th><th>Manager</th><th>Status</th><th></th></tr></thead><tbody>{roster.reviews.map(r => <tr key={r.id} className="border-b"><td className="py-2">{r.name} <span className="text-xs text-slate-400">{r.code}</span></td><td>{r.department}</td><td>{r.manager_name || '—'}</td><td>{r.excluded ? <Badge className="bg-slate-200 text-slate-600 border-0">Removed</Badge> : r.status_label}</td>
      <td>{!r.excluded && !['closed', 'archived'].includes(roster.c.status) && <Button size="sm" variant="ghost" onClick={async () => { const reason = confirmReason(`Remove ${r.name} from this cycle? Reason:`); if (!reason) return; try { await ap('ap_cycle_employees', { cycle_id: roster.c.id, remove: [r.user_id], reason }); toast.success('Removed'); openRoster(roster.c); } catch (e) { toast.error(e.message); } }}>Remove</Button>}</td></tr>)}</tbody></table></div>
    {roster.not_in_cycle.length > 0 && !['closed', 'archived', 'draft', 'configured'].includes(roster.c.status) && <div className="space-y-2"><div className="text-sm font-medium">Add employees (not in this cycle)</div><div className="flex flex-wrap gap-2">{roster.not_in_cycle.slice(0, 40).map(e => <Button key={e.user_id} size="sm" variant="outline" onClick={async () => { try { await ap('ap_cycle_employees', { cycle_id: roster.c.id, add: [e.user_id] }); toast.success(`${e.name} added`); openRoster(roster.c); } catch (er) { toast.error(er.message); } }}>+ {e.name}</Button>)}</div></div>}
  </div>);

  return (<div className="space-y-3">
    <div className="flex justify-between"><h3 className="text-lg font-semibold">Appraisal cycles</h3><Button onClick={() => setEdit({ ...blank })}><Plus className="w-4 h-4 mr-1" />New cycle</Button></div>
    {!cycles.length && <p className="text-sm text-slate-500">No cycles yet. Create one — nothing is pre-loaded, including the Mid-Year Review 2026–27.</p>}
    {cycles.map(c => (<div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-center gap-3">
      <div className="min-w-[220px]"><div className="font-semibold">{c.name}</div><div className="text-xs text-slate-500">FY {c.financial_year} · {fmtDate(c.review_start)} – {fmtDate(c.review_end)}</div><div className="text-xs text-slate-500">Self {fmtDate(c.deadlines?.self)} · Manager {fmtDate(c.deadlines?.manager)} · HR {fmtDate(c.deadlines?.hr)}</div></div>
      <Badge className={`${CYCLE_TONE[c.status]} border-0`}>{label(c.status)}</Badge>
      {c.counts && <div className="text-xs text-slate-600">{c.counts.employees} employees · self {c.counts.self_submitted} · manager {c.counts.mgr_submitted} · finalised {c.counts.finalised}</div>}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEdit({ ...blank, ...c, eligibility: { ...blank.eligibility, ...c.eligibility } })}>{['draft', 'configured'].includes(c.status) ? 'Edit' : 'Deadlines'}</Button>
        {c.settings && <Button size="sm" variant="outline" onClick={() => openRoster(c)}><Users className="w-4 h-4 mr-1" />Employees</Button>}
        <Button size="sm" variant="outline" onClick={async () => { try { await ap('ap_duplicate_cycle', { cycle_id: c.id }); toast.success('Duplicated as a draft'); done(); } catch (e) { toast.error(e.message); } }}><Copy className="w-4 h-4 mr-1" />Duplicate</Button>
        {NEXT[c.status] && <Button size="sm" onClick={() => move(c, NEXT[c.status])}>{label(NEXT[c.status])} →</Button>}
        {['under_hr_review', 'finalised', 'closed', 'archived'].includes(c.status) && <Button size="sm" variant="outline" onClick={() => reopen(c)}>Reopen</Button>}
      </div></div>))}
  </div>);
}
