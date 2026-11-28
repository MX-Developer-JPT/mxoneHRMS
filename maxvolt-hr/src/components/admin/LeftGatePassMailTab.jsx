import React, { useCallback, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, Plus, X, Save, Send, Eye } from 'lucide-react';
import { toast } from 'sonner';

const call = async (name, args) => { const r = await base44.functions.invoke(name, args); return r?.data || r; };
const VALID = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[A-Za-z]{2,}$/;
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// Admin Panel → Gate Pass Email: who receives, every day at 9 AM, the list of employees who left without a gate pass the
// previous day.
export default function LeftGatePassMailTab() {
  const [data, setData] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [sendWhenNone, setSendWhenNone] = useState(true);
  const [entry, setEntry] = useState('');
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  const apply = (c) => { setRecipients(c.recipients); setEnabled(c.enabled); setSendWhenNone(c.send_when_none); setDirty(false); };
  const load = useCallback(async () => {
    try { const d = await call('lw_get', {}); setData(d); apply(d.config); setDate((x) => x || d.yesterday); setError(''); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { toast.error(e.message); } setBusy(''); };

  const add = () => {
    const list = entry.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = list.find((x) => !VALID.test(x));
    if (bad) { toast.error(`"${bad}" is not a valid email address`); return; }
    if (!list.length) return;
    setRecipients((r) => [...new Set([...r, ...list])]); setEntry(''); setDirty(true);
  };
  const save = () => run('save', async () => { const d = await call('lw_save', { recipients, enabled, send_when_none: sendWhenNone }); apply(d.config); toast.success('Saved'); });
  const show = () => run('preview', async () => setPreview(await call('lw_preview', { date })));
  const send = () => {
    if (!window.confirm(`Send the list for ${date} to ${data.config.recipients.length} saved recipient(s) now?`)) return;
    run('send', async () => { const d = await call('lw_send', { date }); toast.success(`Sent to ${d.sent} recipient(s): ${d.cases} employee(s)`); await load(); });
  };

  if (error) return <p className="py-8 text-center text-sm text-red-600">{error}</p>;
  if (!data) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" />Left without gate pass — daily email</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">Every day at <b>9:00 AM</b> these addresses receive the employees who left without a gate pass on the previous day: short attendance or half day, last check-out {data.threshold_minutes} minutes or more before shift end, and no gate pass. On Duty, Work From Home, leave and regularised days are not counted.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} />Send this email every day</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sendWhenNone} disabled={!enabled} onChange={(e) => { setSendWhenNone(e.target.checked); setDirty(true); }} />Also send it when nobody left without a gate pass</label>
          <div className="flex gap-2">
            <Input type="email" multiple placeholder="name@maxvoltenergy.com (several can be pasted, separated by commas)" value={entry} onChange={(e) => setEntry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <Button variant="outline" onClick={add} disabled={!entry.trim()}><Plus className="w-4 h-4 mr-1" />Add</Button>
          </div>
          {recipients.length === 0 ? <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">No recipient yet, so nothing is sent.</p> : (
            <div className="flex flex-wrap gap-2">
              {recipients.map((r) => <span key={r} className="inline-flex items-center gap-1 border rounded-full pl-3 pr-1.5 py-1 text-sm">{r}<button type="button" aria-label={`Remove ${r}`} onClick={() => { setRecipients((x) => x.filter((y) => y !== r)); setDirty(true); }}><X className="w-3.5 h-3.5 text-gray-400" /></button></span>)}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={save} disabled={!dirty || !!busy}>{busy === 'save' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save</Button>
            {dirty ? <span className="text-xs text-amber-700">Changes are not saved yet.</span> : data.config.updated_at && <span className="text-xs text-gray-500">Last changed by {data.config.updated_by_name} on {when(data.config.updated_at)}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Check or send a day</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input type="date" aria-label="Day" className="w-44" max={data.yesterday} value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} />
            <Button variant="outline" onClick={show} disabled={!date || !!busy}>{busy === 'preview' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}Show list</Button>
            <Button variant="outline" onClick={send} disabled={!date || !!busy || dirty || !data.config.recipients.length}>{busy === 'send' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Send now</Button>
          </div>
          {preview && (preview.rows.length === 0 ? <p className="text-sm text-gray-500">Nobody left without a gate pass on {preview.date}.</p> : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs"><thead><tr className="bg-gray-100">{preview.columns.map((c) => <th key={c} className="text-left px-2 py-1.5 whitespace-nowrap">{c}</th>)}</tr></thead>
                <tbody>{preview.rows.map((r) => <tr key={`${r[1]}-${r[0]}`} className="border-t">{r.map((v, i) => <td key={preview.columns[i]} className="px-2 py-1.5 whitespace-nowrap">{v}</td>)}</tr>)}</tbody></table>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Sent</CardTitle></CardHeader>
        <CardContent>
          {data.log.length === 0 ? <p className="text-sm text-gray-500">Nothing sent yet.</p> : data.log.map((l) => (
            <p key={l.id} className="text-xs text-gray-600 py-1 border-b last:border-0">For {l.date}: {l.recipients ? `${l.cases} employee(s) to ${l.recipients} recipient(s)` : 'nobody to report, not sent'} · {when(l.sent_at)}{l.manual ? ' · sent by hand' : ''}</p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
