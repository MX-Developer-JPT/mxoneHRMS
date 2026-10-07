import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { ld, fmtDate } from '@/lib/ld';
import { useEmployees, EmployeeSelect, Field } from '@/components/ld/shared';

const LEVELS = ['', 'Awareness', 'Basic', 'Working', 'Advanced', 'Expert'];
const STATUS_CLS = { VALID: 'border-green-300 text-green-700', EXPIRING: 'border-amber-300 text-amber-700', EXPIRED: 'border-red-300 text-red-700', REVOKED: 'border-gray-300 text-gray-500' };

export default function LdSkillsCertsTab() {
  const emps = useEmployees();
  const [skills, setSkills] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [certs, setCerts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, g, c] = await Promise.all([ld('ld_listSkills'), ld('ld_getSkillGaps'), ld('ld_listCertificates')]);
      setSkills(s.skills); setGaps(g.skills); setCerts(c.certificates);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (name, payload, ok) => {
    setBusy(true);
    try { await ld(name, payload); toast.success(ok); setDlg(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const upd = (key, patch) => setDlg(d => ({ ...d, [key]: { ...d[key], ...patch } }));

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  return (
    <Tabs defaultValue="skills">
      <TabsList><TabsTrigger value="skills">Skills &amp; gaps</TabsTrigger><TabsTrigger value="certs">Certificates ({certs.length})</TabsTrigger></TabsList>

      <TabsContent value="skills" className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Proficiency: 1 Awareness · 2 Basic · 3 Working · 4 Advanced · 5 Expert</span><div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'skill', s: { name: '', category: 'General' } })}><Plus className="w-4 h-4 mr-1" />Skill</Button>
          <Button size="sm" onClick={() => setDlg({ kind: 'rate', r: { user_id: '', skill_id: '', current: 2, required: 3, evidence: '' } })}>Rate an employee</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">{skills.map(s => <Badge key={s.id} variant="outline">{s.name}</Badge>)}{skills.length === 0 && <span className="text-sm text-gray-500">No skills defined yet — add the skills / competencies you track.</span>}</div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Department</th><th>Skill</th><th>Current</th><th>Required</th><th>Gap</th><th>Next assessment</th><th>Suggested training</th></tr></thead>
            <tbody>
              {gaps.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">No skill ratings yet.</td></tr>}
              {gaps.map(g => (
                <tr key={g.id} className="border-b last:border-0">
                  <td className="p-2">{g.employee_name}</td><td>{g.department}</td><td>{g.skill_name}</td><td>{g.current} · {LEVELS[g.current]}</td><td>{g.required} · {LEVELS[g.required]}</td>
                  <td className={g.gap > 0 ? 'text-red-600 font-semibold' : 'text-green-700'}>{g.gap > 0 ? `−${g.gap}` : 'None'}</td>
                  <td className={g.due ? 'text-red-600' : ''}>{fmtDate(g.next_assessment)}</td><td className="text-xs">{(g.recommended || []).map(r => r.title).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="certs" className="space-y-3">
        <div className="flex justify-end"><Button size="sm" onClick={() => setDlg({ kind: 'cert', c: { user_id: '', title: '', external: false, issuer: '', score: '', issue_date: new Date().toISOString().slice(0, 10), expiry_date: '' } })}><Plus className="w-4 h-4 mr-1" />Issue certificate</Button></div>
        <Card><CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Certificate ID</th><th>Employee</th><th>Certificate</th><th>Score</th><th>Issued</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {certs.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">No certificates yet — induction completion certificates appear here automatically.</td></tr>}
              {certs.map(c => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="p-2 font-mono text-xs">{c.certificate_id}</td><td>{c.employee_name}<div className="text-[11px] text-gray-400">{c.department}</div></td><td>{c.title}</td><td>{c.score ?? '—'}</td><td>{fmtDate(c.issue_date)}</td><td>{fmtDate(c.expiry_date)}</td>
                  <td><Badge variant="outline" className={STATUS_CLS[c.status]}>{c.status}</Badge></td>
                  <td className="whitespace-nowrap">
                    <Link to={`/LdCertificate?id=${c.id}`}><Button size="sm" variant="ghost" className="h-7 text-xs">View</Button></Link>
                    {c.status !== 'REVOKED' && <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => setDlg({ kind: 'revoke', c, reason: '' })}>Revoke</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent></Card>
      </TabsContent>

      <Dialog open={dlg?.kind === 'skill'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent><DialogHeader><DialogTitle>New skill</DialogTitle></DialogHeader>
          {dlg?.kind === 'skill' && (
            <div className="space-y-3">
              <Field label="Name"><Input value={dlg.s.name} onChange={e => upd('s', { name: e.target.value })} /></Field>
              <Field label="Category"><Input value={dlg.s.category} onChange={e => upd('s', { category: e.target.value })} /></Field>
              <Button disabled={busy} onClick={() => act('ld_saveSkill', { skill: dlg.s }, 'Skill added')}>Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.kind === 'rate'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent><DialogHeader><DialogTitle>Rate skill proficiency</DialogTitle></DialogHeader>
          {dlg?.kind === 'rate' && (
            <div className="space-y-3">
              <Field label="Employee"><EmployeeSelect emps={emps} value={dlg.r.user_id} onChange={v => upd('r', { user_id: v })} /></Field>
              <Field label="Skill">
                <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={dlg.r.skill_id} onChange={e => upd('r', { skill_id: e.target.value })}>
                  <option value="">Select skill</option>{skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                {[['current', 'Current level'], ['required', 'Required level']].map(([k, l]) => (
                  <Field key={k} label={l}>
                    <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={dlg.r[k]} onChange={e => upd('r', { [k]: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} · {LEVELS[n]}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label="Evidence"><Textarea rows={2} value={dlg.r.evidence} onChange={e => upd('r', { evidence: e.target.value })} /></Field>
              <Button disabled={busy} onClick={() => act('ld_rateSkill', dlg.r, 'Rating saved')}>Save rating</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.kind === 'cert'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent><DialogHeader><DialogTitle>Issue a certificate</DialogTitle></DialogHeader>
          {dlg?.kind === 'cert' && (
            <div className="space-y-3">
              <Field label="Employee"><EmployeeSelect emps={emps} value={dlg.c.user_id} onChange={v => upd('c', { user_id: v })} /></Field>
              <Field label="Certificate title"><Input value={dlg.c.title} onChange={e => upd('c', { title: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dlg.c.external} onChange={e => upd('c', { external: e.target.checked })} />External certification (issued by another body)</label>
              {dlg.c.external && <Field label="Issuer"><Input value={dlg.c.issuer} onChange={e => upd('c', { issuer: e.target.value })} /></Field>}
              <div className="grid grid-cols-3 gap-3">
                <Field label="Score"><Input value={dlg.c.score} onChange={e => upd('c', { score: e.target.value })} /></Field>
                <Field label="Issued"><Input type="date" value={dlg.c.issue_date} onChange={e => upd('c', { issue_date: e.target.value })} /></Field>
                <Field label="Expires"><Input type="date" value={dlg.c.expiry_date} onChange={e => upd('c', { expiry_date: e.target.value })} /></Field>
              </div>
              <Button disabled={busy} onClick={() => act('ld_issueCertificate', { ...dlg.c, score: dlg.c.score === '' ? null : Number(dlg.c.score), expiry_date: dlg.c.expiry_date || null }, 'Certificate issued')}>Issue</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dlg?.kind === 'revoke'} onOpenChange={o => !o && setDlg(null)}>
        <DialogContent><DialogHeader><DialogTitle>Revoke {dlg?.c?.certificate_id}</DialogTitle></DialogHeader>
          <Textarea placeholder="Reason (kept in the audit trail)" value={dlg?.reason || ''} onChange={e => setDlg(d => ({ ...d, reason: e.target.value }))} />
          <Button disabled={busy} onClick={() => act('ld_revokeCertificate', { id: dlg.c.id, reason: dlg.reason }, 'Certificate revoked')}>Revoke</Button>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
