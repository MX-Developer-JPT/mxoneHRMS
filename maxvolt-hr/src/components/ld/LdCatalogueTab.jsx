import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Plus, Send } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { useEmployees, Field } from '@/components/ld/shared';

const TYPES = ['video', 'document', 'presentation', 'live_classroom', 'webinar', 'practical_task', 'quiz', 'assessment', 'policy_acknowledgement', 'certification', 'on_the_job', 'shadowing', 'workshop'];
const CATS = ['Corporate', 'HR', 'Safety', 'Compliance', 'Technical', 'Functional', 'Leadership', 'Soft skills', 'Digital', 'Product', 'Quality', 'Manufacturing', 'Sales', 'Customer service', 'Management', 'Professional development'];
const blank = { title: '', category: 'Corporate', type: 'document', description: '', content_url: '', duration_min: 60, mandatory: false, validity_months: 0, issues_certificate: false, assessment_id: '', status: 'active' };

export default function LdCatalogueTab() {
  const emps = useEmployees();
  const [courses, setCourses] = useState(null);
  const [paths, setPaths] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [dlg, setDlg] = useState(null); // course | path | assign
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, p, a, as] = await Promise.all([ld('ld_listCourses'), ld('ld_listPaths'), ld('ld_listAssessments'), ld('ld_listAssignments', {})]);
      setCourses(c.courses); setPaths(p.paths); setAssessments(a.assessments.filter(x => x.status !== 'archived')); setAssignments(as.assignments);
    } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const depts = [...new Set(emps.map(e => e.department).filter(Boolean))].sort();
  const save = async (name, payload, ok) => {
    setBusy(true);
    try { await ld(name, payload); toast.success(ok); setDlg(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (!courses) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  const shown = courses.filter(c => !q || `${c.title} ${c.category} ${c.code}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Tabs defaultValue="courses">
      <TabsList><TabsTrigger value="courses">Courses ({courses.length})</TabsTrigger><TabsTrigger value="paths">Learning paths ({paths.length})</TabsTrigger><TabsTrigger value="assignments">Assignments ({assignments.length})</TabsTrigger></TabsList>

      <TabsContent value="courses" className="space-y-3">
        <div className="flex gap-2"><Input className="w-64" placeholder="Search courses…" value={q} onChange={e => setQ(e.target.value)} /><div className="flex-1" /><Button size="sm" onClick={() => setDlg({ kind: 'course', c: { ...blank } })}><Plus className="w-4 h-4 mr-1" />New course</Button></div>
        <div className="grid md:grid-cols-2 gap-3">
          {shown.map(c => (
            <Card key={c.id} className={c.status === 'archived' ? 'opacity-60' : ''}><CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{c.title}</div><div className="text-xs text-gray-500">{c.code} · {c.category} · {c.type.replace(/_/g, ' ')} · {c.duration_min} min · v{c.version}</div></div>
                <div className="flex flex-col items-end gap-1">{c.mandatory && <Badge variant="outline" className="text-[10px] border-red-200 text-red-600">Mandatory</Badge>}{c.status === 'archived' && <Badge variant="outline" className="text-[10px]">Archived</Badge>}</div></div>
              <p className="text-xs text-gray-600 line-clamp-2">{c.description}</p>
              <div className="flex items-center justify-between text-xs text-gray-500"><span>{c.enrolled} assigned · {c.completed} completed</span>
                <span className="flex gap-1"><Button size="sm" variant="outline" className="h-7" onClick={() => setDlg({ kind: 'course', c: { ...blank, ...c } })}>Edit</Button><Button size="sm" className="h-7" onClick={() => setDlg({ kind: 'assign', course_id: c.id, mandatory: c.mandatory, users: [], departments: [], all: false, due_days: 30 })}><Send className="w-3 h-3 mr-1" />Assign</Button></span></div>
            </CardContent></Card>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="paths" className="space-y-3">
        <div className="flex justify-end"><Button size="sm" onClick={() => setDlg({ kind: 'path', p: { name: '', description: '', items: [], mandatory: false, due_days: 30, audience: { departments: [], all: false } } })}><Plus className="w-4 h-4 mr-1" />New learning path</Button></div>
        {paths.length === 0 && <Card><CardContent className="p-6 text-sm text-gray-500 text-center">A learning path is an ordered set of courses for a population (a department, a role, all employees). Create one to assign it in a single step.</CardContent></Card>}
        {paths.map(p => (
          <Card key={p.id}><CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div><div className="font-semibold">{p.name} {p.mandatory && <Badge variant="outline" className="text-[10px] border-red-200 text-red-600 ml-1">Mandatory</Badge>}</div><div className="text-xs text-gray-500">{p.items.length} course(s) · due in {p.due_days} days · {p.description}</div></div>
            <div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'path', p })}>Edit</Button><Button size="sm" onClick={() => setDlg({ kind: 'assign', path_id: p.id, mandatory: p.mandatory, users: [], departments: p.audience?.departments || [], all: !!p.audience?.all, due_days: p.due_days })}><Send className="w-3 h-3 mr-1" />Assign</Button></div>
          </CardContent></Card>
        ))}
      </TabsContent>

      <TabsContent value="assignments" className="space-y-2">
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]"><thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Training</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {assignments.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nothing assigned yet.</td></tr>}
              {assignments.slice(0, 400).map(a => (
                <tr key={a.id} className="border-b last:border-0"><td className="p-2">{a.employee_name}<div className="text-[11px] text-gray-400">{a.employee_code}</div></td><td>{a.department}</td><td>{a.course_title}{a.mandatory && <span className="text-red-500 text-[10px] ml-1">mandatory</span>}</td><td className={a.overdue ? 'text-red-600' : ''}>{fmtDate(a.due_date)}</td><td>{a.overdue && a.status !== 'COMPLETED' ? 'Overdue' : a.status.replace('_', ' ')}</td>
                  <td className="text-right pr-2">{a.status !== 'COMPLETED' && a.status !== 'WAIVED' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { try { await ld('ld_markComplete', { assignment_ids: [a.id] }); toast.success('Marked complete'); load(); } catch (e) { toast.error(e.message); } }}>Mark complete</Button>}</td></tr>
              ))}
            </tbody></table>
        </CardContent></Card>
      </TabsContent>

      {/* course editor */}
      <Dialog open={dlg?.kind === 'course'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{dlg?.c?.id ? 'Edit course' : 'New course'}</DialogTitle></DialogHeader>
          {dlg?.kind === 'course' && (() => { const c = dlg.c; const set = (k, v) => setDlg(d => ({ ...d, c: { ...d.c, [k]: v } })); return (
            <div className="space-y-3">
              <Field label="Title"><Input value={c.title} onChange={e => set('title', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category"><select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={c.category} onChange={e => set('category', e.target.value)}>{[...new Set([c.category, ...CATS])].map(x => <option key={x}>{x}</option>)}</select></Field>
                <Field label="Type"><select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={c.type} onChange={e => set('type', e.target.value)}>{TYPES.map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select></Field>
              </div>
              <Field label="Description"><Textarea rows={3} value={c.description} onChange={e => set('description', e.target.value)} /></Field>
              <Field label="Content link (video / document URL — optional)"><Input value={c.content_url || ''} onChange={e => set('content_url', e.target.value)} placeholder="https://…" /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Duration (min)"><Input type="number" value={c.duration_min} onChange={e => set('duration_min', e.target.value)} /></Field>
                <Field label="Certificate valid (months, 0 = no expiry)"><Input type="number" value={c.validity_months} onChange={e => set('validity_months', e.target.value)} /></Field>
                <Field label="Assessment"><select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={c.assessment_id || ''} onChange={e => set('assessment_id', e.target.value)}><option value="">None</option>{assessments.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></Field>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!c.mandatory} onChange={e => set('mandatory', e.target.checked)} />Mandatory</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!c.issues_certificate} onChange={e => set('issues_certificate', e.target.checked)} />Issues a certificate on completion</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={c.status === 'archived'} onChange={e => set('status', e.target.checked ? 'archived' : 'active')} />Archived</label>
              </div>
              <p className="text-[11px] text-gray-400">Changing the content, link or duration creates a new version; people already enrolled stay linked to the version they started.</p>
              <Button disabled={busy} onClick={() => save('ld_saveCourse', { course: c }, 'Course saved')}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save course</Button>
            </div>); })()}
        </DialogContent>
      </Dialog>

      {/* path editor */}
      <Dialog open={dlg?.kind === 'path'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{dlg?.p?.id ? 'Edit learning path' : 'New learning path'}</DialogTitle></DialogHeader>
          {dlg?.kind === 'path' && (() => { const p = dlg.p; const set = (k, v) => setDlg(d => ({ ...d, p: { ...d.p, [k]: v } })); const inPath = new Set(p.items.map(i => i.course_id)); return (
            <div className="space-y-3">
              <Field label="Name"><Input value={p.name} onChange={e => set('name', e.target.value)} /></Field>
              <Field label="Description"><Textarea rows={2} value={p.description || ''} onChange={e => set('description', e.target.value)} /></Field>
              <Field label="Courses, in order (tick to include)">
                <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                  {courses.filter(c => c.status === 'active').map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer"><input type="checkbox" checked={inPath.has(c.id)} onChange={e => set('items', e.target.checked ? [...p.items, { course_id: c.id, required: true }] : p.items.filter(i => i.course_id !== c.id))} />{c.title}</label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Complete within (days)"><Input type="number" value={p.due_days} onChange={e => set('due_days', e.target.value)} /></Field>
                <Field label="Audience departments (optional)"><select multiple className="w-full rounded-md border bg-white px-2 text-sm h-20" value={p.audience?.departments || []} onChange={e => set('audience', { ...(p.audience || {}), departments: [...e.target.selectedOptions].map(o => o.value) })}>{depts.map(d => <option key={d}>{d}</option>)}</select></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.mandatory} onChange={e => set('mandatory', e.target.checked)} />Mandatory</label>
              <Button disabled={busy} onClick={() => save('ld_savePath', { path: p }, 'Path saved')}>Save path</Button>
            </div>); })()}
        </DialogContent>
      </Dialog>

      {/* assign */}
      <Dialog open={dlg?.kind === 'assign'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Assign training</DialogTitle></DialogHeader>
          {dlg?.kind === 'assign' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dlg.all} onChange={e => setDlg(d => ({ ...d, all: e.target.checked }))} /><b>Everyone</b> (all active employees)</label>
              {!dlg.all && <>
                <Field label="Departments"><select multiple className="w-full rounded-md border bg-white px-2 text-sm h-24" value={dlg.departments} onChange={e => setDlg(d => ({ ...d, departments: [...e.target.selectedOptions].map(o => o.value) }))}>{depts.map(d => <option key={d}>{d}</option>)}</select></Field>
                <Field label="And / or specific employees"><select multiple className="w-full rounded-md border bg-white px-2 text-sm h-32" value={dlg.users} onChange={e => setDlg(d => ({ ...d, users: [...e.target.selectedOptions].map(o => o.value) }))}>{emps.map(e => <option key={e.user_id} value={e.user_id}>{e.display_name} · {e.department || ''}</option>)}</select></Field>
              </>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Due in (days)"><Input type="number" value={dlg.due_days} onChange={e => setDlg(d => ({ ...d, due_days: e.target.value }))} /></Field>
                <label className="flex items-end gap-2 text-sm pb-2"><input type="checkbox" checked={!!dlg.mandatory} onChange={e => setDlg(d => ({ ...d, mandatory: e.target.checked }))} />Mandatory</label>
              </div>
              <Button disabled={busy} onClick={() => save('ld_assign', { course_id: dlg.course_id, path_id: dlg.path_id, user_ids: dlg.users, departments: dlg.departments, all: dlg.all, due_days: Number(dlg.due_days), mandatory: !!dlg.mandatory }, 'Assigned — employees have been notified')}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Assign &amp; notify</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
