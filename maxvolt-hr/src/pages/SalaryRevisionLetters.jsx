import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UploadCloud, FileText, CheckCircle2, AlertTriangle, Loader2, Download, Send,
  FilePenLine, ChevronDown, ChevronUp, Search, Mail, Layers, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const TOKEN_KEY = 'base44_access_token';
const API = '/api/salary-revision';

async function call(path, { method = 'GET', body, form, raw } = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Request failed (${res.status})`);
  }
  return raw ? res.blob() : res.json();
}

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + inr(Math.abs(n));
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const LABELS = {
  basic: 'Basic Salary', hra: 'HRA', conveyance: 'Conveyance', pf: 'Provident Fund', medical: 'Medical Insurance', admin: 'PF Admin Charges',
  vpp: 'VPP', ctc_bonus: 'CTC Bonus', esi: 'ESI (Employer)', car_lease: 'Car Lease', car_maint: 'Car Fuel & Maint.', gym: 'Health & Wellness', hard_fur: 'Hard Furnishing',
};

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const FILTERS = [
  ['all', 'All'], ['eligible', 'Will get a letter'], ['attention', 'Needs attention'], ['excluded', 'Excluded / unmatched'],
  ['not_applied', 'Not applied'], ['not_sent', 'Not sent'], ['sent', 'Sent'], ['failed', 'Failed'],
];

export default function SalaryRevisionLetters() {
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [effective, setEffective] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; });
  const [form, setForm] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // { kind:'apply'|'send', will, ... }
  const [resend, setResend] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const fileRef = useRef(null);

  const loadBatches = () => call('/batches').then(d => setBatches(d.batches || [])).catch(() => {});
  useEffect(() => { loadBatches(); }, []);

  const applyBatch = (d) => {
    setBatch(d.batch); setRows(d.rows || []);
    setForm({ effective_date: d.batch.effective_date, letter_date: d.batch.letter_date, reason_text: d.batch.reason_text, signatory: d.batch.signatory, contact_email: d.batch.contact_email, include_take_home: d.batch.include_take_home });
    setSelected(new Set()); setOpen(new Set()); setLastResult(null);
  };
  const reload = async (id = batch?.id) => { if (!id) return; const d = await call(`/batches/${id}`); applyBatch(d); loadBatches(); };
  const run = async (key, fn) => { setBusy(key); try { return await fn(); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };

  const upload = () => run('upload', async () => {
    const fd = new FormData(); fd.append('file', file); fd.append('password', password); fd.append('effective_date', effective);
    const d = await call('/upload', { method: 'POST', form: fd });
    applyBatch(d); loadBatches(); setPassword('');
    toast.success(`Read ${d.batch.counts.sheet_rows} rows — review the preview below`);
  });
  const openBatch = (id) => run('open', () => reload(id));

  const saveSettings = () => run('settings', async () => {
    const d = await call(`/batches/${batch.id}/settings`, { method: 'POST', body: form });
    setBatch(d.batch); toast.success('Letter settings saved');
  });

  const shown = useMemo(() => rows.filter(r => {
    const q = query.trim().toLowerCase();
    if (q && !`${r.code} ${r.name} ${r.department}`.toLowerCase().includes(q)) return false;
    switch (filter) {
      case 'eligible': return r.eligible;
      case 'attention': return r.warnings.length > 0 || r.match.status !== 'matched';
      case 'excluded': return !r.eligible;
      case 'not_applied': return r.eligible && !r.applied;
      case 'not_sent': return r.eligible && !r.sent;
      case 'sent': return !!r.sent;
      case 'failed': return !!(r.send_error || r.apply_error);
      default: return true;
    }
  }), [rows, filter, query]);

  const selectable = shown.filter(r => r.eligible);
  const allSel = selectable.length > 0 && selectable.every(r => selected.has(r.code));
  const toggle = (code) => setSelected(s => { const n = new Set(s); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const toggleAll = () => setSelected(s => { const n = new Set(s); if (allSel) selectable.forEach(r => n.delete(r.code)); else selectable.forEach(r => n.add(r.code)); return n; });
  const codes = selected.size ? [...selected] : null; // null = every eligible row
  const scopeLabel = selected.size ? `${selected.size} selected` : `all ${batch?.counts.eligible ?? 0} eligible`;

  const viewLetter = (code, download) => run(`l-${code}`, async () => {
    const blob = await call(`/batches/${batch.id}/letter/${code}${download ? '?download=1' : ''}`, { raw: true });
    if (download) saveBlob(blob, `${code}_Salary_Revision_Letter.pdf`);
    else window.open(URL.createObjectURL(blob), '_blank');
  });
  const downloadZip = () => run('zip', async () => {
    toast.info('Preparing letters — this can take up to a minute for everyone.');
    const blob = await call(`/batches/${batch.id}/letters.zip`, { method: 'POST', body: { codes }, raw: true });
    saveBlob(blob, `Salary_Revision_Letters_${batch.effective_date}.zip`);
  });

  // Step 1 of apply/send: ask the server what WOULD happen (no change), then confirm the count.
  const ask = (kind) => run(`ask-${kind}`, async () => {
    const d = await call(`/batches/${batch.id}/${kind}`, { method: 'POST', body: { codes, resend: kind === 'send' && resend } });
    if (kind === 'apply') setConfirm({ kind, will: d.will_apply, already: d.already_applied });
    else setConfirm({ kind, will: d.will_send, already: d.already_sent, notApplied: d.not_applied });
  });
  const doConfirmed = () => run(`do-${confirm.kind}`, async () => {
    const c = confirm; setConfirm(null);
    const d = await call(`/batches/${batch.id}/${c.kind}`, { method: 'POST', body: { codes, resend: c.kind === 'send' && resend, confirm_count: c.will } });
    setLastResult({ kind: c.kind, ...d });
    if (c.kind === 'apply') toast.success(`Applied ${d.applied} salary structure(s)${d.failed ? `, ${d.failed} failed` : ''}`);
    else toast.success(`Sent ${d.sent} email(s)${d.failed ? `, ${d.failed} failed` : ''}`);
    await reload();
  });
  const sendTest = () => run('test', async () => {
    const d = await call(`/batches/${batch.id}/send`, { method: 'POST', body: { codes, test_to: testTo } });
    toast[d.failed ? 'error' : 'success'](d.failed ? `Test failed: ${d.results.find(r => !r.ok)?.error}` : `Test email${d.sent > 1 ? 's' : ''} sent to ${testTo} (first ${d.sent} letter${d.sent > 1 ? 's' : ''}; employees were NOT emailed)`);
  });

  const c = batch?.counts;
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FilePenLine className="w-6 h-6 text-orange-600" /> Salary Revision Letters</h1>
        <p className="text-sm text-slate-500 mt-1">Revised CTC after the change in PF rules: upload → review letters → apply to salary structures → email each employee. Nothing is changed or sent until you confirm a step.</p>
      </div>

      {/* 1 — upload */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">1 · Upload the revised CTC file</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label>File (.xls / .xlsx)</Label>
              <div className="flex gap-2 mt-1">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><UploadCloud className="w-4 h-4 mr-1" />{file ? file.name : 'Choose file'}</Button>
                <input ref={fileRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              </div>
            </div>
            <div><Label>File password (if protected)</Label><Input className="mt-1" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></div>
            <div><Label>Effective from</Label><Input className="mt-1" type="date" value={effective} onChange={e => setEffective(e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!file || busy === 'upload'} onClick={upload}>{busy === 'upload' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-1" />}Read file &amp; preview</Button>
            {batches.length > 0 && (
              <select className="border rounded-md h-9 px-2 text-sm bg-background" value={batch?.id || ''} onChange={e => e.target.value && openBatch(e.target.value)}>
                <option value="">Open an earlier upload…</option>
                {batches.map(b => <option key={b.id} value={b.id}>{b.filename} · {when(b.created_at)} · {b.counts.sent}/{b.counts.eligible} sent</option>)}
              </select>
            )}
          </div>
        </CardContent>
      </Card>

      {batch && (<>
        {/* summary */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            ['Rows in file', c.sheet_rows], ['Will get a letter', c.eligible], ['Unmatched', c.unmatched, c.unmatched ? 'text-red-600' : ''],
            ['Excluded', c.ineligible, ''], ['Applied', `${c.applied}/${c.eligible}`], ['Emailed', `${c.sent}/${c.eligible}`],
          ].map(([l, v, cls]) => (
            <Card key={l}><CardContent className="p-3"><div className="text-xs text-slate-500">{l}</div><div className={`text-xl font-semibold ${cls || ''}`}>{v}</div></CardContent></Card>
          ))}
        </div>
        <div className="text-sm text-slate-600">Monthly CTC of the {c.eligible} employees: <b>{inr(batch.totals.previous)}</b> → <b>{inr(batch.totals.revised)}</b> ({signed(batch.totals.revised - batch.totals.previous)}).</div>

        {/* letter settings */}
        {form && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Letter wording &amp; dates</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <div><Label>Effective from</Label><Input type="date" className="mt-1" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} /></div>
                <div><Label>Letter date</Label><Input type="date" className="mt-1" value={form.letter_date} onChange={e => setForm({ ...form, letter_date: e.target.value })} /></div>
                <div><Label>Signed by</Label><Input className="mt-1" value={form.signatory} onChange={e => setForm({ ...form, signatory: e.target.value })} /></div>
                <div><Label>Contact for queries</Label><Input className="mt-1" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></div>
              </div>
              <div><Label>Reason for the revision (printed in every letter)</Label><Textarea className="mt-1" rows={3} value={form.reason_text} onChange={e => setForm({ ...form, reason_text: e.target.value })} /></div>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.include_take_home} onCheckedChange={v => setForm({ ...form, include_take_home: v })} />Mention that the employee's own PF deduction raises and take-home reduces by the same amount</label>
                <Button variant="outline" disabled={busy === 'settings'} onClick={saveSettings}>{busy === 'settings' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Save wording</Button>
              </div>
              <p className="text-xs text-slate-500">Save, then open a letter below to see the change. Letters are generated on demand from these settings.</p>
            </CardContent>
          </Card>
        )}

        {/* table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2 · Review previous vs revised CTC &amp; letters</CardTitle>
            <div className="flex flex-wrap gap-2 pt-2">
              <div className="relative"><Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" /><Input className="pl-8 w-56" placeholder="Search name, code, dept" value={query} onChange={e => setQuery(e.target.value)} /></div>
              {FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} onClick={() => setFilter(k)}>{l}</Button>)}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="p-2 w-8"><Checkbox checked={allSel} onCheckedChange={toggleAll} /></th>
                    <th className="p-2 text-left">Employee</th><th className="p-2 text-right">Previous / mo</th><th className="p-2 text-right">Revised / mo</th>
                    <th className="p-2 text-right">Change</th><th className="p-2 text-right">PF prev → new</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Letter</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <React.Fragment key={r.code}>
                      <tr className={`border-t ${!r.eligible ? 'bg-slate-50 text-slate-500' : ''}`}>
                        <td className="p-2"><Checkbox disabled={!r.eligible} checked={selected.has(r.code)} onCheckedChange={() => toggle(r.code)} /></td>
                        <td className="p-2">
                          <button className="text-left" onClick={() => setOpen(s => { const n = new Set(s); n.has(r.code) ? n.delete(r.code) : n.add(r.code); return n; })}>
                            <div className="font-medium flex items-center gap-1">{open.has(r.code) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}{r.name}</div>
                            <div className="text-xs text-slate-500 ml-4">{r.code} · {r.department}{r.email_masked ? ` · ${r.email_masked}` : ''}</div>
                          </button>
                        </td>
                        <td className="p-2 text-right tabular-nums">{inr(r.previous.total)}</td>
                        <td className="p-2 text-right tabular-nums">{inr(r.revised.total)}</td>
                        <td className="p-2 text-right tabular-nums">{signed(r.diff.total)}</td>
                        <td className="p-2 text-right tabular-nums">{inr(r.previous.pf)} → {inr(r.revised.pf)}</td>
                        <td className="p-2 space-y-1">
                          {r.match.status === 'unmatched' && <Badge className="bg-red-100 text-red-800 border-0">No matching employee</Badge>}
                          {!r.eligible && r.match.status !== 'unmatched' && <Badge className="bg-slate-200 text-slate-700 border-0">{r.ineligible_reason}</Badge>}
                          {r.applied && <Badge className="bg-green-100 text-green-800 border-0 gap-1" title={`${when(r.applied.at)} by ${r.applied.by}`}><CheckCircle2 className="w-3 h-3" />Applied</Badge>}
                          {r.sent && <Badge className="bg-blue-100 text-blue-800 border-0 gap-1" title={`${when(r.sent.at)} by ${r.sent.by}`}><Mail className="w-3 h-3" />Sent{r.sent.count > 1 ? ` ×${r.sent.count}` : ''}</Badge>}
                          {(r.send_error || r.apply_error) && <Badge className="bg-red-100 text-red-800 border-0 gap-1" title={(r.send_error || r.apply_error).error}><XCircle className="w-3 h-3" />{r.apply_error ? 'Apply failed' : 'Send failed'}</Badge>}
                          {r.warnings.length > 0 && <div className="text-xs text-amber-700 flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{r.warnings.join('; ')}</div>}
                        </td>
                        <td className="p-2 text-right whitespace-nowrap">
                          {r.match.status !== 'unmatched' && !r.diff.unchanged && (<>
                            <Button size="sm" variant="ghost" disabled={busy === `l-${r.code}`} onClick={() => viewLetter(r.code, false)}><FileText className="w-4 h-4" /></Button>
                            <Button size="sm" variant="ghost" disabled={busy === `l-${r.code}`} onClick={() => viewLetter(r.code, true)}><Download className="w-4 h-4" /></Button>
                          </>)}
                        </td>
                      </tr>
                      {open.has(r.code) && (
                        <tr className="bg-slate-50/60"><td /><td colSpan={7} className="p-2">
                          <table className="text-xs"><thead><tr className="text-slate-500"><th className="pr-6 text-left">Component</th><th className="pr-6 text-right">Previous</th><th className="pr-6 text-right">Revised</th><th className="text-right">Change</th></tr></thead>
                            <tbody>{Object.keys(LABELS).filter(k => r.previous[k] || r.revised[k]).map(k => (
                              <tr key={k} className={r.diff[k] ? 'font-semibold' : ''}><td className="pr-6">{LABELS[k]}</td><td className="pr-6 text-right tabular-nums">{inr(r.previous[k])}</td><td className="pr-6 text-right tabular-nums">{inr(r.revised[k])}</td><td className="text-right tabular-nums">{r.diff[k] ? signed(r.diff[k]) : '—'}</td></tr>
                            ))}<tr className="font-bold border-t"><td>Total CTC / month</td><td className="pr-6 text-right">{inr(r.previous.total)}</td><td className="pr-6 text-right">{inr(r.revised.total)}</td><td className="text-right">{signed(r.diff.total)}</td></tr></tbody></table>
                          {r.db && <div className="text-xs text-slate-500 mt-1">In the system today: {r.db.has_structure ? `${inr(r.db.monthly_total)} / month (this will be kept as history)` : 'no active salary structure'}</div>}
                        </td></tr>
                      )}
                    </React.Fragment>
                  ))}
                  {!shown.length && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Nothing matches this filter.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* actions */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">3 · Download, apply, send — <span className="font-normal text-slate-500">scope: {scopeLabel}{selected.size > 0 && <button className="ml-2 underline" onClick={() => setSelected(new Set())}>clear selection</button>}</span></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              <Button variant="outline" disabled={busy === 'zip'} onClick={downloadZip}>{busy === 'zip' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Layers className="w-4 h-4 mr-1" />}Download all letters (ZIP)</Button>
              <span className="text-xs text-slate-500">Review first — open any letter above, or download them all.</span>
            </div>
            <div className="border-t pt-3 flex flex-wrap gap-3 items-center">
              <Button disabled={!!busy} onClick={() => ask('apply')}>{busy === 'ask-apply' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Apply revised CTC to salary structures</Button>
              <span className="text-xs text-slate-500">Creates a new structure effective {longDate(batch.effective_date)}; the old one stays as inactive history. Safe to repeat — already-applied employees are skipped.</span>
            </div>
            <div className="border-t pt-3 space-y-2">
              <div className="flex flex-wrap gap-3 items-center">
                <Button disabled={!!busy} onClick={() => ask('send')}>{busy === 'ask-send' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Email each employee their letter</Button>
                <label className="flex items-center gap-2 text-sm"><Switch checked={resend} onCheckedChange={setResend} />Include those already emailed (re-send)</label>
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Input className="w-64" placeholder="your email — send a test" value={testTo} onChange={e => setTestTo(e.target.value)} />
                <Button variant="outline" disabled={!/^\S+@\S+\.\S+$/.test(testTo) || busy === 'test'} onClick={sendTest}>{busy === 'test' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Send test to me</Button>
                <span className="text-xs text-slate-500">Sends up to 3 sample letters to this address only; employees are not emailed and nothing is recorded as sent.</span>
              </div>
            </div>
            {lastResult && (
              <div className="rounded-md border p-3 text-sm bg-slate-50">
                <b>{lastResult.kind === 'apply' ? 'Apply' : 'Send'} result:</b> {lastResult.kind === 'apply' ? `${lastResult.applied} applied` : `${lastResult.sent} sent`}{lastResult.failed ? `, ${lastResult.failed} failed` : ''}{lastResult.already_applied || lastResult.already_sent ? `, ${lastResult.already_applied ?? lastResult.already_sent} skipped (already done)` : ''}.
                {lastResult.results?.filter(x => !x.ok).slice(0, 20).map(x => <div key={x.code} className="text-red-700">{x.code}: {x.error}</div>)}
              </div>
            )}
          </CardContent>
        </Card>
      </>)}

      <AlertDialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'apply' ? `Apply revised CTC to ${confirm?.will} employee(s)?` : `Send ${confirm?.will} individual email(s)?`}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirm?.kind === 'apply' ? (<>
                  <p>New salary structures take effect {batch && longDate(batch.effective_date)}. Each employee's current structure is kept as inactive history. This changes the figures payroll reads.</p>
                  {confirm?.already > 0 && <p>{confirm.already} already applied — they will be skipped.</p>}
                </>) : (<>
                  <p>Each employee gets their own email with their own letter attached. Nobody is copied.</p>
                  {confirm?.notApplied > 0 && <p className="text-amber-700">{confirm.notApplied} of these have not had the revised CTC applied to their salary structure yet.</p>}
                  {confirm?.already > 0 && <p>{confirm.already} already emailed — skipped{resend ? '' : ' (turn on re-send to include them)'}.</p>}
                </>)}
                {confirm?.will === 0 && <p className="font-semibold">There is nothing to do for this selection.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={!confirm?.will} onClick={doConfirmed}>{confirm?.kind === 'apply' ? `Apply to ${confirm?.will}` : `Send ${confirm?.will} email(s)`}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}
