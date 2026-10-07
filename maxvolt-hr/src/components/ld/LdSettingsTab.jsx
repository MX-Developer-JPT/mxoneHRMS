import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { ld, fmtDateTime, ROLE_LABEL } from '@/lib/ld';
import { useEmployees, Field } from '@/components/ld/shared';

export default function LdSettingsTab() {
  const emps = useEmployees();
  const [cfg, setCfg] = useState(null);
  const [tpl, setTpl] = useState(null);
  const [versions, setVersions] = useState([]);
  const [json, setJson] = useState('');
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const c = await ld('ld_getConfig');
      setCfg(c.config); setTpl(c.active_template); setVersions(c.templates);
      setJson(JSON.stringify(c.active_template, null, 2));
      setAudit((await ld('ld_getAudit', { limit: 80 })).audit);
    } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveCfg = async () => {
    setBusy('cfg');
    try { await ld('ld_saveConfig', { config: cfg }); toast.success('Settings saved'); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const saveTpl = async () => {
    let t;
    try { t = JSON.parse(json); } catch { toast.error('That is not valid JSON'); return; }
    if (!window.confirm('Save as a NEW workflow version? New joiners will use it; employees already enrolled stay on the version they started with.')) return;
    setBusy('tpl');
    try { await ld('ld_saveTemplate', { template: t }); toast.success('New workflow version saved'); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (!cfg) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  const esc = cfg.escalation_days;
  const toggleAdmin = (uid) => setCfg(c => ({ ...c, ld_admin_user_ids: c.ld_admin_user_ids.includes(uid) ? c.ld_admin_user_ids.filter(x => x !== uid) : [...c.ld_admin_user_ids, uid] }));

  return (
    <Tabs defaultValue="rules">
      <TabsList><TabsTrigger value="rules">Rules &amp; escalation</TabsTrigger><TabsTrigger value="workflow">Induction workflow</TabsTrigger><TabsTrigger value="audit">Audit log</TabsTrigger></TabsList>

      <TabsContent value="rules" className="space-y-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Induction rules</CardTitle></CardHeader><CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Default pass mark %"><Input type="number" value={cfg.induction_pass_score} onChange={e => setCfg(c => ({ ...c, induction_pass_score: e.target.value }))} /></Field>
            <Field label="Max assessment attempts"><Input type="number" value={cfg.max_attempts} onChange={e => setCfg(c => ({ ...c, max_attempts: e.target.value }))} /></Field>
            <Field label="Remind before due (days)"><Input type="number" value={cfg.due_soon_days} onChange={e => setCfg(c => ({ ...c, due_soon_days: e.target.value }))} /></Field>
            <Field label="Certificate expiring warning (days)"><Input type="number" value={cfg.expiring_cert_days} onChange={e => setCfg(c => ({ ...c, expiring_cert_days: e.target.value }))} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.auto_start_induction !== false} onChange={e => setCfg(c => ({ ...c, auto_start_induction: e.target.checked }))} />Start the induction automatically when a new employee is approved</label>
          <div>
            <div className="text-sm font-semibold mb-1">Escalation — days overdue before each person is told</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[['employee', 'Employee'], ['manager', 'Reporting Manager'], ['hod', 'HOD'], ['hr', 'HR'], ['ld', 'L&D']].map(([k, l]) => (
                <Field key={k} label={l}><Input type="number" value={esc[k]} onChange={e => setCfg(c => ({ ...c, escalation_days: { ...c.escalation_days, [k]: Number(e.target.value) } }))} /></Field>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Employee → Reporting Manager → HOD → HR → L&D. Each level is notified once, when the step reaches that many days overdue.</p>
          </div>
        </CardContent></Card>

        <Card><CardHeader className="pb-2"><CardTitle className="text-base">L&amp;D administrators</CardTitle></CardHeader><CardContent className="space-y-2">
          <p className="text-xs text-gray-500">HR and admin users always have full L&D access. Tick anyone else who should administer learning (configure catalogue, sign off, waive).</p>
          <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
            {emps.map(e => <label key={e.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer"><input type="checkbox" checked={cfg.ld_admin_user_ids.includes(e.user_id)} onChange={() => toggleAdmin(e.user_id)} />{e.display_name}<span className="text-xs text-gray-400">{e.department}</span></label>)}
          </div>
        </CardContent></Card>
        <Button onClick={saveCfg} disabled={busy === 'cfg'}>{busy === 'cfg' && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save settings</Button>
      </TabsContent>

      <TabsContent value="workflow" className="space-y-4">
        <Card><CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm"><b>{tpl?.name}</b><Badge variant="outline">v{tpl?.version}</Badge><span className="text-gray-500">{versions.length} version(s) on record · existing employees stay on the version they enrolled under</span></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[700px]">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-1">Gate</th><th>Name</th><th>Owner</th><th>Completion</th><th>Due (day)</th><th>Needs</th><th>Required</th></tr></thead>
            <tbody>{tpl?.gates.map(g => <tr key={g.gate_id} className="border-b last:border-0"><td className="py-1 font-mono text-xs">{g.gate_id}</td><td>{g.name}</td><td>{g.owner_roles.map(r => ROLE_LABEL[r] || r).join(' / ')}</td><td>{g.completion.replace('_', ' ')}</td><td>{g.due_offset_days}</td><td className="text-xs">{(g.depends_on || []).join(', ') || '—'}</td><td>{g.required === false ? 'No' : 'Yes'}</td></tr>)}</tbody>
          </table></div>
        </CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Edit workflow definition (advanced)</CardTitle></CardHeader><CardContent className="space-y-2">
          <p className="text-xs text-gray-500">Gates, tasks, owners, due days, dependencies and forms are defined here. Saving never alters people already enrolled — it creates the next version for new joiners.</p>
          <Textarea className="font-mono text-xs min-h-[320px]" value={json} onChange={e => setJson(e.target.value)} />
          <Button onClick={saveTpl} disabled={busy === 'tpl'} variant="outline">{busy === 'tpl' && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Save as new version</Button>
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="audit">
        <Card><CardContent className="p-3 space-y-1.5">
          {audit.length === 0 && <div className="text-sm text-gray-500">Nothing recorded yet.</div>}
          {audit.map(a => <div key={a.id} className="text-xs flex gap-3 border-b last:border-0 pb-1.5"><span className="text-gray-400 w-32 shrink-0">{fmtDateTime(a.at)}</span><span className="font-medium w-44 shrink-0">{a.action.replace(/_/g, ' ')}</span><span className="text-gray-600">{a.actor_name}{a.details?.gate ? ` · ${a.details.gate}` : ''}{a.details?.title ? ` · ${a.details.title}` : ''}{a.details?.comments ? ` — ${a.details.comments}` : ''}</span></div>)}
        </CardContent></Card>
      </TabsContent>
    </Tabs>
  );
}
