import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Users, Loader2, Search } from 'lucide-react';

// Who receives the scheduled MIS e-mails: the Management department (toggle), any hand-picked
// employees, and any extra e-mail addresses (e.g. directors / consultants outside the app).
export default function MisRecipientsCard() {
  const [cfg, setCfg] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [extra, setExtra] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [res, emps] = await Promise.all([
          base44.functions.invoke('getMisMailConfig', {}),
          base44.entities.Employee.list().catch(() => []),
        ]);
        const d = res?.data || res;
        if (d?.success) { setCfg(d.config); setRecipients(d.recipients || []); setExtra((d.config.extra_emails || []).join('\n')); }
        else toast.error(d?.error || 'Could not load recipient settings');
        setEmployees((emps || []).filter(e => e.user_id && e.status !== 'inactive' && e.display_name).sort((a, b) => a.display_name.localeCompare(b.display_name)));
      } catch (e) { toast.error('Could not load recipient settings: ' + e.message); }
    })();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter(e => !q || `${e.display_name} ${e.employee_code || ''} ${e.department || ''}`.toLowerCase().includes(q)).slice(0, 80);
  }, [employees, search]);

  if (!cfg) return <div className="border rounded-lg p-5 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading recipient settings…</div>;

  const toggleUser = (uid) => setCfg(c => ({ ...c, user_ids: c.user_ids.includes(uid) ? c.user_ids.filter(x => x !== uid) : [...c.user_ids, uid] }));
  const setPeriod = (k, v) => setCfg(c => ({ ...c, periods: { ...c.periods, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const extra_emails = extra.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
      const res = await base44.functions.invoke('saveMisMailConfig', { config: { ...cfg, extra_emails } });
      const d = res?.data || res;
      if (!d?.success) { toast.error(d?.error || 'Save failed'); setSaving(false); return; }
      setCfg(d.config); setRecipients(d.recipients || []); setExtra((d.config.extra_emails || []).join('\n'));
      const dropped = extra_emails.length - d.config.extra_emails.length;
      toast.success(`Saved — ${d.recipients.length} recipient(s)` + (dropped > 0 ? ` (${dropped} invalid address(es) ignored)` : ''));
    } catch (e) { toast.error('Save failed: ' + e.message); }
    setSaving(false);
  };

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" /><h2 className="font-semibold">Who receives the MIS reports</h2></div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.include_management} onChange={e => setCfg(c => ({ ...c, include_management: e.target.checked }))} />
        Everyone in the <b>Management</b> department
      </label>

      <div className="space-y-2">
        <div className="text-sm font-medium">Add specific employees</div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input className="w-full h-9 rounded-md border bg-background pl-8 pr-2 text-sm" placeholder="Search name, code or department…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="max-h-52 overflow-y-auto rounded-md border divide-y">
          {shown.length === 0 && <div className="p-3 text-sm text-muted-foreground">No employees match.</div>}
          {shown.map(e => (
            <label key={e.user_id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
              <input type="checkbox" checked={cfg.user_ids.includes(e.user_id)} onChange={() => toggleUser(e.user_id)} />
              <span className="font-medium">{e.display_name}</span>
              <span className="text-muted-foreground text-xs">{e.employee_code || ''} {e.department ? `· ${e.department}` : ''}</span>
            </label>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">{cfg.user_ids.length} employee(s) selected</div>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-medium">Extra email addresses <span className="text-muted-foreground font-normal">(one per line — for people outside the app)</span></div>
        <textarea className="w-full min-h-[70px] rounded-md border bg-background p-2 text-sm" value={extra} onChange={e => setExtra(e.target.value)} placeholder="director@example.com" />
      </div>

      <div className="space-y-1">
        <div className="text-sm font-medium">Send these reports</div>
        <div className="flex flex-wrap gap-4 text-sm">
          {[['daily', 'Daily (12:00 AM)'], ['weekly', 'Weekly (Monday)'], ['monthly', 'Monthly (1st)']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={cfg.periods[k] !== false} onChange={e => setPeriod(k, e.target.checked)} /> {l}</label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save recipients</Button>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <div className="text-sm font-medium mb-1">Currently receiving ({recipients.length})</div>
        {recipients.length === 0 ? <div className="text-sm text-red-700">No one — reports will not be sent.</div> : (
          <div className="text-sm space-y-0.5 max-h-40 overflow-y-auto">
            {recipients.map(r => <div key={r.email}><span className="font-medium">{r.name || r.email}</span> <span className="text-muted-foreground">{r.name ? r.email : ''} · {r.source}</span></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
