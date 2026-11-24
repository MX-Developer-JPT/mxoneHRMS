import React, { useCallback, useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, FileSpreadsheet, UserPlus, Inbox, Mail, CheckCircle2, AlertTriangle, Copy, Users } from 'lucide-react';
import { toast } from 'sonner';
import { rh, fmtDT } from '@/lib/hiring';

const cls = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
const SRC = { careers_portal: 'Careers portal', naukri: 'Naukri', linkedin: 'LinkedIn', indeed: 'Indeed', email: 'Direct email', agency: 'Agency', walk_in: 'Walk-in', referral: 'Referral', internal_database: 'Internal database', other: 'Other' };
const OUT = { created: ['New candidate', 'bg-green-50 text-green-700'], merged: ['Already in the app — CV added', 'bg-blue-50 text-blue-700'], needs_review: ['Needs your review', 'bg-amber-50 text-amber-800'], failed: ['Failed', 'bg-red-50 text-red-700'] };
const call = (fn, p) => rh(fn, p);

function Pick({ opts, v, set, source, setSource, req, setReq, needReq }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-xs text-gray-500 flex flex-col gap-1">Source<select className={cls} value={source} onChange={(e) => setSource(e.target.value)}>{(opts.sources || Object.keys(SRC)).map((s) => <option key={s} value={s}>{SRC[s] || s}</option>)}</select></label>
      <label className="text-xs text-gray-500 flex flex-col gap-1">Requisition {needReq ? '' : '(optional)'}
        <select className={`${cls} min-w-[260px]`} value={req} onChange={(e) => setReq(e.target.value)}><option value="">— none yet (talent pool) —</option>{(opts.requisitions || []).map((r) => <option key={r.id} value={r.id}>{r.mrf_no ? `${r.mrf_no} — ` : ''}{r.title}{r.department ? ` (${r.department})` : ''}</option>)}</select>
      </label>
    </div>
  );
}

function BulkCv({ opts, onDone }) {
  const [source, setSource] = useState('naukri'); const [req, setReq] = useState('');
  const [files, setFiles] = useState([]); const [busy, setBusy] = useState(false); const [prog, setProg] = useState(''); const [results, setResults] = useState([]);
  const ref = useRef(null);
  const run = async () => {
    setBusy(true); setResults([]); const all = [];
    try {
      const up = [];
      for (let i = 0; i < files.length; i++) {
        setProg(`Uploading ${i + 1} of ${files.length}…`);
        try { const { file_url } = await base44.integrations.Core.UploadFile({ file: files[i] }); up.push({ file_url, filename: files[i].name }); } catch (e) { all.push({ filename: files[i].name, outcome: 'failed', reason: `Upload failed: ${e.message}` }); }
      }
      for (let i = 0; i < up.length; i += 10) {
        setProg(`Reading CVs ${Math.min(i + 10, up.length)} of ${up.length}…`);
        try { const d = await call('ci_bulk_cv', { files: up.slice(i, i + 10), source, requisition_id: req }); all.push(...d.results); } catch (e) { up.slice(i, i + 10).forEach((f) => all.push({ filename: f.filename, outcome: 'failed', reason: e.message })); }
      }
      setResults(all); setFiles([]); onDone?.();
      const n = (o) => all.filter((r) => r.outcome === o).length;
      toast.success(`${n('created')} new, ${n('merged')} already in the app, ${n('needs_review')} need review${n('failed') ? `, ${n('failed')} failed` : ''}`);
    } finally { setBusy(false); setProg(''); }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Drop CVs (PDF, DOCX, TXT, RTF) from Naukri, LinkedIn, email or anywhere. Each CV is read, matched against the candidates already in the app (email, phone, name + company), and either added as a new candidate or attached to the person who is already there.</p>
      <Pick opts={opts} source={source} setSource={setSource} req={req} setReq={setReq} />
      <div className="border-2 border-dashed rounded-xl p-8 text-center bg-white cursor-pointer hover:bg-blue-50" onClick={() => ref.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 100)); }}>
        <Upload className="w-8 h-8 mx-auto text-blue-500" /><p className="mt-2 font-medium">Click or drop up to 100 CVs here</p>
        <input ref={ref} type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf" className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files)].slice(0, 100)); e.target.value = ''; }} />
      </div>
      {files.length > 0 && <div className="text-sm"><b>{files.length}</b> file(s) ready: <span className="text-gray-500">{files.slice(0, 6).map((f) => f.name).join(', ')}{files.length > 6 ? '…' : ''}</span> <button className="text-blue-600 underline ml-2" onClick={() => setFiles([])}>clear</button></div>}
      <Button onClick={run} disabled={busy || !files.length} className="bg-blue-600 hover:bg-blue-700">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}{busy ? prog : `Add ${files.length || ''} CV(s)`}</Button>
      {results.length > 0 && (
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-xs"><thead className="bg-gray-50"><tr><th className="text-left p-2">File</th><th className="text-left p-2">Candidate</th><th className="text-left p-2">Result</th></tr></thead><tbody>
          {results.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{r.filename}</td><td className="p-2">{r.name || '—'}</td><td className="p-2"><span className={`px-2 py-0.5 rounded ${(OUT[r.outcome] || OUT.failed)[1]}`}>{(OUT[r.outcome] || OUT.failed)[0]}</span>{r.matched_on ? <span className="text-gray-500"> · matched on {r.matched_on}</span> : ''}{r.reason ? <span className="text-gray-500"> · {r.reason}</span> : ''}</td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}

function Sheet({ opts, onDone }) {
  const [source, setSource] = useState('naukri'); const [req, setReq] = useState(''); const [file, setFile] = useState(null); const [url, setUrl] = useState('');
  const [pv, setPv] = useState(null); const [busy, setBusy] = useState(false); const ref = useRef(null);
  const preview = async (f) => {
    setBusy(true); setPv(null);
    try { const { file_url } = await base44.integrations.Core.UploadFile({ file: f }); setUrl(file_url); setFile(f); setPv(await call('ci_sheet', { file_url, source, requisition_id: req, mode: 'preview' })); }
    catch (e) { toast.error(e.message); setFile(null); }
    setBusy(false);
  };
  const apply = async () => {
    setBusy(true);
    try { const d = await call('ci_sheet', { file_url: url, source, requisition_id: req, mode: 'apply', preview_hash: pv.preview_hash, filename: file?.name }); toast.success(`${d.created} new candidate(s), ${d.merged} already in the app${d.skipped ? `, ${d.skipped} skipped` : ''}`); setPv(null); setFile(null); onDone?.(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Upload an Excel / CSV export (Naukri, LinkedIn Recruiter, Indeed, an agency sheet). Columns are recognised by name (Name, Email, Mobile, Experience, Company, CTC, Notice period, Skills, Resume link). You see exactly what will happen before anything is added.</p>
      <Pick opts={opts} source={source} setSource={setSource} req={req} setReq={setReq} />
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) preview(f); }} />
      <Button variant="outline" onClick={() => ref.current?.click()} disabled={busy}>{busy && !pv ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1" />}Choose Excel / CSV file</Button>
      {pv && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap text-xs">
            <span className="px-2 py-1 rounded bg-green-50 text-green-700">{pv.summary.new} new</span><span className="px-2 py-1 rounded bg-blue-50 text-blue-700">{pv.summary.merge} already in the app</span><span className="px-2 py-1 rounded bg-red-50 text-red-700">{pv.summary.invalid} skipped</span>
          </div>
          <p className="text-xs text-gray-500">Columns used: {Object.entries(pv.mapping).map(([k, v]) => `${k.replace(/_/g, ' ')} ← “${v}”`).join(' · ')}</p>
          <div className="border rounded-lg overflow-auto max-h-[40vh]"><table className="w-full text-xs"><thead className="bg-gray-50 sticky top-0"><tr><th className="text-left p-2">Row</th><th className="text-left p-2">Name</th><th className="text-left p-2">Email / phone</th><th className="text-left p-2">Company</th><th className="text-left p-2">Will</th></tr></thead><tbody>
            {pv.rows.map((r) => <tr key={r.row} className="border-t"><td className="p-2">{r.row}</td><td className="p-2">{r.name || '—'}</td><td className="p-2">{[r.email, r.phone].filter(Boolean).join(' · ')}</td><td className="p-2">{r.company}</td>
              <td className="p-2">{r.action === 'new' ? <span className="text-green-700">Add as new</span> : r.action === 'merge' ? <span className="text-blue-700">Already there ({r.match}) — add source</span> : <span className="text-red-600">Skip — {r.reason}</span>}</td></tr>)}
          </tbody></table></div>
          <div className="flex gap-2"><Button onClick={apply} disabled={busy || (pv.summary.new + pv.summary.merge === 0)} className="bg-green-600 hover:bg-green-700">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Confirm and add</Button><Button variant="ghost" onClick={() => { setPv(null); setFile(null); }}>Cancel</Button></div>
        </div>
      )}
    </div>
  );
}

function Quick({ opts, onDone }) {
  const empty = { full_name: '', email: '', phone: '', source: 'walk_in', requisition_id: '', current_company: '', experience_years: '', expected_ctc: '', notice_period: '', profile_url: '', notes: '' };
  const [f, setF] = useState(empty); const [file, setFile] = useState(null); const [busy, setBusy] = useState(false); const ref = useRef(null);
  const save = async () => {
    setBusy(true);
    try {
      let up = {}; if (file) up = await base44.integrations.Core.UploadFile({ file });
      const d = await call('ci_quick_add', { ...f, file_url: up.file_url, filename: file?.name });
      toast.success(d.outcome === 'merged' ? `${d.name} is already in the app (matched on ${d.matched_on}) — added to the same profile` : `${d.name} added`); setF(empty); setFile(null); onDone?.();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const inp = (k, label, props = {}) => <label className="text-xs text-gray-500 flex flex-col gap-1">{label}<input className={cls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></label>;
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-gray-600">For a call, a walk-in, a manager’s referral or a profile you found online: type the few details you have. A CV or a profile link is optional.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {inp('full_name', 'Full name *')}{inp('phone', 'Phone')}{inp('email', 'Email')}{inp('current_company', 'Current company')}{inp('experience_years', 'Experience (years)', { type: 'number', min: 0 })}{inp('expected_ctc', 'Expected CTC (lakhs per annum)')}{inp('notice_period', 'Notice period')}{inp('profile_url', 'Profile link (LinkedIn / Naukri)')}
      </div>
      <Pick opts={opts} source={f.source} setSource={(s) => setF({ ...f, source: s })} req={f.requisition_id} setReq={(r) => setF({ ...f, requisition_id: r })} />
      <textarea className="w-full rounded-md border border-gray-300 p-2 text-sm" rows={2} placeholder="Notes (where you met, what they said…)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      <div className="flex items-center gap-3 flex-wrap"><input ref={ref} type="file" accept=".pdf,.doc,.docx,.txt,.rtf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} /><Button variant="outline" size="sm" onClick={() => ref.current?.click()}><Upload className="w-4 h-4 mr-1" />{file ? file.name : 'Attach CV (optional)'}</Button>
        <Button onClick={save} disabled={busy} className="bg-blue-600 hover:bg-blue-700">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Add candidate</Button></div>
    </div>
  );
}

function InboxTab({ opts, onChanged }) {
  const [d, setD] = useState(null); const [open, setOpen] = useState(null); const [busy, setBusy] = useState(false); const [assign, setAssign] = useState({});
  const load = useCallback(async () => { try { setD(await call('ci_inbox_list', {})); } catch (e) { toast.error(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (payload, ok) => { setBusy(true); try { await call(payload.fn, payload.p); toast.success(ok); setOpen(null); await load(); onChanged?.(); } catch (e) { toast.error(e.message); } setBusy(false); };
  if (!d) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  return (
    <div className="space-y-6">
      <div>
        <p className="font-semibold mb-2">Needs your review ({d.items.length})</p>
        {d.items.length === 0 ? <p className="text-sm text-gray-400">Nothing waiting. CVs the app cannot place on its own (scanned, no contact details, an email with no CV) appear here.</p> : (
          <div className="space-y-2">{d.items.map((it) => (
            <div key={it.id} className="border rounded-lg p-3 bg-white">
              <div className="flex justify-between gap-2 flex-wrap text-sm"><span><b>{it.filename || it.subject || 'Item'}</b> <span className="text-gray-500">· {SRC[it.source] || it.source} · {it.channel} · {fmtDT(it.at)}{it.from ? ` · ${it.from}` : ''}</span></span><span className="text-amber-700">{it.reason}</span></div>
              {it.excerpt && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{it.excerpt}</p>}
              <div className="flex gap-2 mt-2 flex-wrap">{it.file_url && <a className="text-xs text-blue-600 underline self-center" href={it.file_url} target="_blank" rel="noreferrer">Open CV</a>}
                <Button size="sm" variant="outline" onClick={() => setOpen({ it, full_name: it.guessed_name || '', email: '', phone: '', requisition_id: it.requisition_id || '' })}>Add as candidate</Button>
                <Button size="sm" variant="ghost" onClick={() => act({ fn: 'ci_inbox_resolve', p: { intake_id: it.id, action: 'dismiss' } }, 'Dismissed')}>Dismiss</Button></div>
              {open?.it.id === it.id && (
                <div className="mt-3 grid sm:grid-cols-4 gap-2 items-end border-t pt-3">
                  <input className={cls} placeholder="Full name" value={open.full_name} onChange={(e) => setOpen({ ...open, full_name: e.target.value })} /><input className={cls} placeholder="Email" value={open.email} onChange={(e) => setOpen({ ...open, email: e.target.value })} /><input className={cls} placeholder="Phone" value={open.phone} onChange={(e) => setOpen({ ...open, phone: e.target.value })} />
                  <select className={cls} value={open.requisition_id} onChange={(e) => setOpen({ ...open, requisition_id: e.target.value })}><option value="">No requisition yet</option>{(opts.requisitions || []).map((r) => <option key={r.id} value={r.id}>{r.mrf_no ? `${r.mrf_no} — ` : ''}{r.title}</option>)}</select>
                  <Button size="sm" disabled={busy} onClick={() => act({ fn: 'ci_inbox_resolve', p: { intake_id: it.id, action: 'create', full_name: open.full_name, email: open.email, phone: open.phone, requisition_id: open.requisition_id } }, 'Candidate added')}>Save</Button>
                </div>)}
            </div>))}</div>)}
      </div>
      <div>
        <p className="font-semibold mb-2">Candidates with no requisition yet ({d.without_requisition.length})</p>
        {d.without_requisition.length === 0 ? <p className="text-sm text-gray-400">Everyone is linked to a requisition.</p> : (
          <div className="space-y-1.5">{d.without_requisition.map((c) => (
            <div key={c.id} className="flex items-center gap-2 flex-wrap border rounded-lg px-3 py-2 bg-white text-sm"><span className="flex-1 min-w-[180px]"><b>{c.name}</b> <span className="text-gray-500">· {SRC[c.source] || c.source} · {c.email || '—'}</span></span>
              <select className={`${cls} max-w-[260px]`} value={assign[c.id] || ''} onChange={(e) => setAssign({ ...assign, [c.id]: e.target.value })}><option value="">Link to a requisition…</option>{(opts.requisitions || []).map((r) => <option key={r.id} value={r.id}>{r.mrf_no ? `${r.mrf_no} — ` : ''}{r.title}</option>)}</select>
              <Button size="sm" disabled={!assign[c.id] || busy} onClick={() => act({ fn: 'ci_assign_requisition', p: { candidate_id: c.id, requisition_id: assign[c.id] } }, 'Linked')}>Link</Button></div>))}</div>)}
      </div>
    </div>
  );
}

function EmailTab({ onChanged }) {
  const [d, setD] = useState(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => call('ci_email_info', {}).then(setD).catch(() => setD({ mailbox: '', state: {}, recent: [] })), []);
  useEffect(() => { load(); }, [load]);
  const check = async () => {
    setBusy(true);
    try { const r = await call('ci_email_poll_now', {}); toast.success(`Checked ${r.mailbox}: ${r.created} new candidate(s), ${r.merged} added to existing, ${r.needs_review} for review`); onChanged?.(); } catch (e) { toast.error(e.message); }
    await load(); setBusy(false);
  };
  const copy = (t) => { try { navigator.clipboard.writeText(t); toast.success('Copied'); } catch { /* ignore */ } };
  if (!d) return <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  const s = d.state || {};
  return (
    <div className="space-y-4 max-w-3xl text-sm">
      <div className={`rounded-lg border p-3 ${d.mailbox_enabled && s.last_ok !== false ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        {d.mailbox_enabled ? (
          <div className="space-y-1">
            <p className={`flex items-center gap-1 font-medium ${s.last_ok === false ? 'text-amber-900' : 'text-green-800'}`}>{s.last_ok === false ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />} Reading <b>{d.mailbox}</b> every 5 minutes</p>
            <p className="text-xs text-gray-600">{s.last_run_at ? `Last checked ${fmtDT(s.last_run_at)}` : 'Not checked yet'}{s.total_processed ? ` · ${s.total_processed} email(s) processed · ${s.total_created || 0} new candidates · ${s.total_merged || 0} added to existing · ${s.total_review || 0} sent to the Inbox` : ''}</p>
            {s.last_ok === false && <p className="text-xs text-red-700 bg-white/70 rounded p-2 break-words">{s.last_error}</p>}
            {s.backlog && <p className="text-xs text-gray-600">More emails are waiting; the next check continues with them.</p>}
          </div>
        ) : <span className="text-amber-900 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Email intake is not switched on yet.</span>}
      </div>
      {d.mailbox_enabled && <Button onClick={check} disabled={busy} variant="outline">{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}Check the mailbox now</Button>}
      <p className="text-gray-600">Every email that reaches the hiring mailbox becomes a candidate automatically: the CV attachment is stored and read, the person is matched against existing candidates, and the source is detected (Naukri, LinkedIn, Indeed, or direct email). The requisition comes from an MRF number in the address (<b>careers+MRF-2026-0007@…</b>) or the subject. Emails the app cannot place go to the Inbox tab. The app only <b>reads</b> the mailbox — nothing is changed or deleted in it.</p>
      <div className="border rounded-lg p-3 bg-white space-y-2">
        <p className="font-semibold">Setup</p>
        <ol className="list-decimal ml-5 space-y-1 text-gray-700">
          <li>Use a real Google Workspace mailbox for hiring (for example <b>careers@maxvoltenergy.com</b>) and tell candidates, job boards and recruiters to send CVs there.</li>
          <li>In the Google Admin Console, add the read-only Gmail permission (<code className="bg-gray-100 px-1 rounded">https://www.googleapis.com/auth/gmail.readonly</code>) to the same service account that Max Mail uses (Security → API controls → Domain-wide delegation).</li>
          <li>In Railway set <code className="bg-gray-100 px-1 rounded">INTAKE_MAILBOX</code> to that address and <code className="bg-gray-100 px-1 rounded">INTAKE_GOOGLE_KEY_B64</code> to the service account key.</li>
        </ol>
      </div>
      {d.recent?.length > 0 && <div><p className="font-semibold mb-1">Recent emails</p><ul className="text-xs text-gray-600 space-y-0.5">{d.recent.map((r, i) => <li key={i}>{fmtDT(r.at)} · {r.from} · {r.subject} · {r.status}</li>)}</ul></div>}
      <details className="text-xs text-gray-500"><summary className="cursor-pointer">Other mail services (web address instead of a mailbox)</summary>
        <div className="mt-2 space-y-1"><p>A service that can post incoming email to a web address can use: {d.enabled ? '' : '(not switched on — set INBOUND_EMAIL_SECRET)'}</p>
          <div className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5 font-mono break-all"><span className="flex-1">{d.endpoint}?key=&lt;secret&gt;</span><button onClick={() => copy(`${d.endpoint}?key=`)}><Copy className="w-3.5 h-3.5" /></button></div></div></details>
    </div>
  );
}

export default function CandidateIntake() {
  const [tab, setTab] = useState('bulk'); const [opts, setOpts] = useState({ sources: Object.keys(SRC), requisitions: [], inbox_count: 0 });
  const loadOpts = useCallback(() => call('ci_options', {}).then(setOpts).catch((e) => toast.error(e.message)), []);
  useEffect(() => { loadOpts(); }, [loadOpts]);
  const tabs = [['bulk', 'Upload CVs', Upload], ['sheet', 'Import Excel / CSV', FileSpreadsheet], ['quick', 'Quick add', UserPlus], ['inbox', 'Inbox', Inbox], ['email', 'Email intake', Mail]];
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Users className="w-6 h-6 text-blue-600" />Add Candidates</h1>
        <p className="text-sm text-gray-500 mt-1">One place for every candidate and CV — Naukri, LinkedIn, Indeed, email, agencies, walk-ins and referrals. Repeat candidates are matched, never duplicated.</p>
      </div>
      <div className="flex gap-1 border-b overflow-x-auto">{tabs.map(([id, label, Icon]) => (
        <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'}`}><Icon className="w-4 h-4" />{label}{id === 'inbox' && opts.inbox_count > 0 && <span className="ml-1 text-xs bg-amber-500 text-white rounded-full px-1.5">{opts.inbox_count}</span>}</button>))}</div>
      <Card><CardContent className="p-5">
        {tab === 'bulk' && <BulkCv opts={opts} onDone={loadOpts} />}
        {tab === 'sheet' && <Sheet opts={opts} onDone={loadOpts} />}
        {tab === 'quick' && <Quick opts={opts} onDone={loadOpts} />}
        {tab === 'inbox' && <InboxTab opts={opts} onChanged={loadOpts} />}
        {tab === 'email' && <EmailTab onChanged={loadOpts} />}
      </CardContent></Card>
    </div>
  );
}
