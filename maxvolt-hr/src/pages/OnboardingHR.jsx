import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import MobileSelect from '@/components/MobileSelect';
import { toast } from 'sonner';
import { Loader2, Send, Copy, RefreshCw, Trash2, UserPlus, CheckCircle2, Mail, FolderOpen } from 'lucide-react';
import { ob, EMPLOYMENT_TYPES, DESIGNATION_TIERS, RELATIONS, employmentLabel, PAN_RE, IFSC_RE, digits } from '@/lib/onboarding';

const blank = () => ({
  first_name: '', middle_name: '', last_name: '', gender: '', date_of_birth: '', father_spouse_name: '',
  personal_email: '', official_email: '', login_with: 'official', phone: '', official_phone: '',
  employee_code: '', biometric_id: '', department: '', designation: '', designation_tier: '', employment_type: 'full_time',
  date_of_joining: '', employee_confirmation_date: '', work_location: '', shift_id: '', reporting_manager_id: '', no_reporting_manager: false,
  overtime_eligible: false, wfh_eligible: false,
  pan_number: '', uan_number: '', pf_applicable: true, pf_account_number: '', is_esi_applicable: false, esi_number: '', aadhar_number: '',
  bank_account: { account_holder_name: '', account_number: '', ifsc_code: '', bank_name: '', branch: '' },
  emergency_contact: { name: '', relationship: '', phone: '', address: '' },
  hr_notes: '',
});

const STAGES = {
  invited: { label: 'Link sent', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress: { label: 'Filling details', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  completed: { label: 'Completed', cls: 'bg-green-50 text-green-700 border-green-200' },
  expired: { label: 'Link expired', cls: 'bg-red-50 text-red-700 border-red-200' },
  revoked: { label: 'Replaced', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};
const fmt = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? String(d).slice(0, 10) : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

function F({ label, req, hint, children, className = '' }) {
  return <div className={`space-y-1 ${className}`}><Label className="text-xs text-gray-600">{label}{req && <span className="text-red-500"> *</span>}</Label>{children}{hint && <div className="text-[11px] text-gray-400">{hint}</div>}</div>;
}
function Sec({ title, children, note }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle>{note && <p className="text-xs text-gray-500">{note}</p>}</CardHeader><CardContent><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div></CardContent></Card>;
}
const Sel = ({ value, onChange, children }) => <select className="h-9 w-full rounded-md border bg-white px-2 text-sm" value={value} onChange={e => onChange(e.target.value)}>{children}</select>;

function Tracker({ refreshKey, onResent }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [busy, setBusy] = useState('');
  const [cancel, setCancel] = useState(null);

  const load = useCallback(async () => {
    try { setData(await ob('ob_getTracker')); } catch (e) { toast.error(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const resend = async (r) => {
    setBusy(r.user_id);
    try { const d = await ob('ob_resendInvite', { user_id: r.user_id }); onResent({ ...d, name: r.name, login_email: r.login_email }); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  const doCancel = async () => {
    if ((cancel.reason || '').trim().length < 3) { toast.error('Please give a reason'); return; }
    setBusy(cancel.row.user_id);
    try { await ob('ob_cancel', { user_id: cancel.row.user_id, reason: cancel.reason }); toast.success('Onboarding cancelled'); setCancel(null); await load(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };

  if (!data) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>;
  const rows = data.rows.filter(r => (stage === 'all' || r.stage === stage) && (!q || `${r.name} ${r.employee_code} ${r.department} ${r.login_email}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input className="w-56" placeholder="Search name, code, department…" value={q} onChange={e => setQ(e.target.value)} />
        {[['all', 'All', data.rows.length], ...Object.entries(STAGES).filter(([k]) => data.counts[k]).map(([k, v]) => [k, v.label, data.counts[k]])].map(([k, l, n]) => (
          <button key={k} onClick={() => setStage(k)} className={`px-3 py-1 rounded-full border text-xs ${stage === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{l} <b>{n}</b></button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
        <Link to="/OnboardingApproval"><Button size="sm" variant="ghost" className="text-gray-500">Older sign-ups awaiting approval</Button></Link>
      </div>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr className="text-left text-xs text-gray-500 border-b bg-gray-50"><th className="p-2">Employee</th><th>Job</th><th>Joining</th><th>Status</th><th>Timeline</th><th>Documents</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-500">No onboarding found. Use “Start onboarding” to invite a new joiner.</td></tr>}
            {rows.map(r => (
              <tr key={r.user_id} className="border-b last:border-0 align-top hover:bg-gray-50">
                <td className="p-2"><div className="font-medium">{r.name}</div><div className="text-[11px] text-gray-500">{r.employee_code} · {r.login_email}</div></td>
                <td className="text-xs">{r.designation}<div className="text-gray-500">{r.department} · {employmentLabel(r.employment_type)}</div></td>
                <td className="text-xs">{fmt(r.date_of_joining)}</td>
                <td><Badge variant="outline" className={`${STAGES[r.stage]?.cls} text-[11px]`}>{STAGES[r.stage]?.label || r.stage}</Badge>{r.correction_note && <div className="text-[11px] text-amber-700 mt-1 max-w-[220px]" title={r.correction_note}>Reported a correction: “{r.correction_note.slice(0, 60)}{r.correction_note.length > 60 ? '…' : ''}”</div>}</td>
                <td className="text-[11px] text-gray-500 leading-5">Invited {fmt(r.invited_at)}{r.send_count > 1 ? ` (×${r.send_count})` : ''}<br />{r.accepted_at ? `Opened ${fmt(r.accepted_at)}` : r.expires_at && r.stage !== 'completed' ? `Expires ${fmt(r.expires_at)}` : ''}{r.submitted_at ? <><br />Submitted {fmt(r.submitted_at)}</> : r.draft_saved_at ? <><br />Draft saved {fmt(r.draft_saved_at)}</> : null}</td>
                <td className="text-xs">{r.docs.total === 0 ? '—' : <>{r.docs.total} uploaded{r.docs.pending > 0 && <div className="text-amber-700">{r.docs.pending} to verify</div>}{r.docs.rejected > 0 && <div className="text-red-600">{r.docs.rejected} rejected</div>}{r.docs.verified > 0 && <div className="text-green-700">{r.docs.verified} verified</div>}</>}</td>
                <td className="pr-2 whitespace-nowrap text-right">
                  {r.stage !== 'completed' && <Button size="sm" variant="outline" className="h-7 px-2 text-xs mr-1" disabled={busy === r.user_id} onClick={() => resend(r)}><Mail className="w-3.5 h-3.5 mr-1" />Resend link</Button>}
                  {r.stage !== 'completed' && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600" onClick={() => setCancel({ row: r, reason: '' })}><Trash2 className="w-3.5 h-3.5" /></Button>}
                  {r.stage === 'completed' && <Link to="/EmployeeDocuments"><Button size="sm" variant="outline" className="h-7 px-2 text-xs"><FolderOpen className="w-3.5 h-3.5 mr-1" />Verify documents</Button></Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
      <Dialog open={!!cancel} onOpenChange={o => !o && setCancel(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel onboarding — {cancel?.row?.name}</DialogTitle></DialogHeader>
          <p className="text-xs text-gray-500">The login and everything entered so far are deleted, so the employee code and emails can be used again. This cannot be undone.</p>
          <Textarea placeholder="Reason (required)" value={cancel?.reason || ''} onChange={e => setCancel(c => ({ ...c, reason: e.target.value }))} />
          <Button variant="destructive" onClick={doCancel} disabled={!!busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Cancel onboarding</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function OnboardingHR() {
  const [f, setF] = useState(blank());
  const [depts, setDepts] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [locs, setLocs] = useState([]);
  const [people, setPeople] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [tab, setTab] = useState('tracker');
  const [tick, setTick] = useState(0);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [d, s, l, u] = await Promise.all([base44.entities.Department.list(), base44.entities.Shift.list(), base44.entities.AppLocation.list(), base44.functions.invoke('getAllUsers', {})]);
        setDepts(d || []); setShifts(s || []); setLocs(l || []);
        setPeople(((u?.data?.users || u?.users || [])).filter(x => (x.custom_role || x.role) !== 'onboarding_pending').map(x => ({ value: x.id, label: x.display_name || x.full_name || x.email })).sort((a, b) => a.label.localeCompare(b.label)));
      } catch (e) { toast.error('Could not load the lists: ' + e.message); }
    })();
    try { // details handed over from the recruitment screen
      const pre = JSON.parse(sessionStorage.getItem('onboarding_prefill') || 'null');
      if (pre) { sessionStorage.removeItem('onboarding_prefill'); setF(x => ({ ...x, first_name: pre.first_name || '', last_name: pre.last_name || '', personal_email: pre.personal_email || '', phone: pre.phone || '' })); setTab('start'); }
    } catch { /* ignore */ }
  }, []);

  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setIn = (g, k, v) => setF(x => ({ ...x, [g]: { ...x[g], [k]: v } }));
  const fullName = [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(' ');

  const problems = useMemo(() => {
    const p = [];
    if (!f.first_name.trim()) p.push('first name');
    if (!f.employee_code.trim()) p.push('employee code');
    if (!f.personal_email.trim()) p.push('personal email');
    if (digits(f.phone).length < 10) p.push('personal mobile');
    if (!f.date_of_birth) p.push('date of birth');
    if (!f.father_spouse_name.trim()) p.push("father's name");
    if (!f.department) p.push('department');
    if (!f.designation.trim()) p.push('designation');
    if (!f.designation_tier) p.push('designation tier');
    if (!f.date_of_joining) p.push('date of joining');
    if (!f.work_location) p.push('work location');
    if (!f.shift_id) p.push('shift');
    if (!f.no_reporting_manager && !f.reporting_manager_id) p.push('reporting manager');
    if (!f.emergency_contact.name.trim() || !f.emergency_contact.relationship || digits(f.emergency_contact.phone).length < 10) p.push('emergency contact');
    if (f.pan_number && !PAN_RE.test(f.pan_number.toUpperCase())) p.push('PAN format');
    if (f.uan_number && digits(f.uan_number).length !== 12) p.push('UAN (12 digits)');
    if (f.bank_account.account_number || f.bank_account.ifsc_code || f.bank_account.bank_name) {
      if (!/^\d{6,20}$/.test(digits(f.bank_account.account_number)) || !IFSC_RE.test(f.bank_account.ifsc_code.toUpperCase()) || !f.bank_account.bank_name.trim()) p.push('bank details (account no., IFSC, bank)');
    }
    return p;
  }, [f]);

  const submit = async () => {
    setBusy(true); setErrors([]);
    try {
      const d = await ob('ob_initiate', { details: { ...f, bank_account: { ...f.bank_account, account_holder_name: f.bank_account.account_holder_name || fullName } } });
      setSent({ ...d, name: fullName }); setF(blank()); setTick(t => t + 1);
    } catch (e) { setErrors(e.errors || [e.message]); toast.error(e.message); }
    setBusy(false);
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast.success('Link copied'); } catch { toast.error('Could not copy — select and copy it manually'); } };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><UserPlus className="w-6 h-6 text-orange-600" />Onboarding</h1>
        <p className="text-sm text-gray-500">HR starts the onboarding and fills in the official details. The new joiner gets an email link, sets a password and submits personal details and documents — the app opens for them as soon as they submit. Nobody can sign up on their own.</p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="tracker">Tracker</TabsTrigger><TabsTrigger value="start">Start onboarding</TabsTrigger></TabsList>

        <TabsContent value="tracker">{tab === 'tracker' && <Tracker refreshKey={tick} onResent={setSent} />}</TabsContent>

        <TabsContent value="start" className="space-y-4">
          <Sec title="1 · Person">
            <F label="First name" req><Input value={f.first_name} onChange={e => set('first_name', e.target.value)} /></F>
            <F label="Middle name"><Input value={f.middle_name} onChange={e => set('middle_name', e.target.value)} /></F>
            <F label="Last name"><Input value={f.last_name} onChange={e => set('last_name', e.target.value)} /></F>
            <F label="Date of birth" req><Input type="date" value={f.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></F>
            <F label="Gender" hint="The employee can also confirm this"><Sel value={f.gender} onChange={v => set('gender', v)}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></Sel></F>
            <F label="Father's name" req><Input value={f.father_spouse_name} onChange={e => set('father_spouse_name', e.target.value)} /></F>
          </Sec>

          <Sec title="2 · Contact & login" note="The onboarding link is emailed to the personal email. The login ID is the official email when given.">
            <F label="Personal email" req><Input type="email" value={f.personal_email} onChange={e => set('personal_email', e.target.value)} /></F>
            <F label="Official email"><Input type="email" value={f.official_email} onChange={e => set('official_email', e.target.value)} placeholder="name@maxvoltenergy.com" /></F>
            <F label="Login ID" hint="Password-reset codes go to the login email">
              <Sel value={f.official_email ? f.login_with : 'personal'} onChange={v => set('login_with', v)}>
                <option value="official" disabled={!f.official_email}>Official email{f.official_email ? '' : ' (not entered)'}</option><option value="personal">Personal email</option>
              </Sel>
            </F>
            <F label="Personal mobile" req><Input value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="10-digit number" /></F>
            <F label="Official number"><Input value={f.official_phone} onChange={e => set('official_phone', e.target.value)} /></F>
          </Sec>

          <Sec title="3 · Job">
            <F label="Employee code" req><Input value={f.employee_code} onChange={e => set('employee_code', e.target.value)} /></F>
            <F label="Biometric ID" hint="Only if different from the employee code"><Input value={f.biometric_id} onChange={e => set('biometric_id', e.target.value)} /></F>
            <F label="Employment type" req><Sel value={f.employment_type} onChange={v => set('employment_type', v)}>{EMPLOYMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</Sel></F>
            <F label="Department" req><Sel value={f.department} onChange={v => set('department', v)}><option value="">Select…</option>{depts.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</Sel></F>
            <F label="Designation" req><Input value={f.designation} onChange={e => set('designation', e.target.value)} /></F>
            <F label="Designation tier" req><Sel value={f.designation_tier} onChange={v => set('designation_tier', v)}><option value="">Select…</option>{DESIGNATION_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</Sel></F>
            <F label="Date of joining" req><Input type="date" value={f.date_of_joining} onChange={e => set('date_of_joining', e.target.value)} /></F>
            <F label="Confirmation due date" hint={f.employment_type === 'trainee' ? 'Not applicable to trainees' : 'Leave empty for 6 months after joining'}><Input type="date" disabled={f.employment_type === 'trainee'} value={f.employee_confirmation_date} onChange={e => set('employee_confirmation_date', e.target.value)} /></F>
            <F label="Work location" req><Sel value={f.work_location} onChange={v => set('work_location', v)}><option value="">Select…</option>{locs.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}</Sel></F>
            <F label="Shift" req><Sel value={f.shift_id} onChange={v => set('shift_id', v)}><option value="">Select…</option>{shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.start_time}–{s.end_time})</option>)}</Sel></F>
            <F label="Reporting manager" req>
              <MobileSelect value={f.reporting_manager_id} onValueChange={v => set('reporting_manager_id', v)} placeholder={f.no_reporting_manager ? 'None' : 'Select manager'} label="Reporting manager" options={people} disabled={f.no_reporting_manager} />
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-1"><input type="checkbox" checked={f.no_reporting_manager} onChange={e => { set('no_reporting_manager', e.target.checked); if (e.target.checked) set('reporting_manager_id', ''); }} />No reporting manager (top management)</label>
            </F>
            <div className="flex flex-col gap-1.5 justify-end text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.overtime_eligible} onChange={e => set('overtime_eligible', e.target.checked)} />Overtime eligible</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.wfh_eligible} onChange={e => set('wfh_eligible', e.target.checked)} />Work-from-home eligible</label>
            </div>
          </Sec>

          <Sec title="4 · Statutory" note="Optional here — anything left empty is asked from the employee. Aadhaar number and photo are always collected from the employee.">
            <F label="PAN"><Input value={f.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} /></F>
            <F label="UAN"><Input value={f.uan_number} onChange={e => set('uan_number', e.target.value)} placeholder="12 digits" /></F>
            <F label="PF account number"><Input value={f.pf_account_number} onChange={e => set('pf_account_number', e.target.value)} /></F>
            <div className="flex items-end text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.pf_applicable} onChange={e => set('pf_applicable', e.target.checked)} />PF applicable</label></div>
            <div className="flex items-end text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={f.is_esi_applicable} onChange={e => set('is_esi_applicable', e.target.checked)} />ESI applicable</label></div>
            <F label="ESI number"><Input disabled={!f.is_esi_applicable} value={f.esi_number} onChange={e => set('esi_number', e.target.value)} /></F>
          </Sec>

          <Sec title="5 · Bank details" note="Optional here — if left empty the employee enters them with a cancelled cheque / passbook.">
            <F label="Account holder name"><Input value={f.bank_account.account_holder_name} onChange={e => setIn('bank_account', 'account_holder_name', e.target.value)} placeholder={fullName || 'As in bank records'} /></F>
            <F label="Account number"><Input value={f.bank_account.account_number} onChange={e => setIn('bank_account', 'account_number', e.target.value)} /></F>
            <F label="IFSC"><Input value={f.bank_account.ifsc_code} onChange={e => setIn('bank_account', 'ifsc_code', e.target.value.toUpperCase())} maxLength={11} /></F>
            <F label="Bank name"><Input value={f.bank_account.bank_name} onChange={e => setIn('bank_account', 'bank_name', e.target.value)} /></F>
            <F label="Branch"><Input value={f.bank_account.branch} onChange={e => setIn('bank_account', 'branch', e.target.value)} /></F>
          </Sec>

          <Sec title="6 · Emergency contact">
            <F label="Name" req><Input value={f.emergency_contact.name} onChange={e => setIn('emergency_contact', 'name', e.target.value)} /></F>
            <F label="Relationship" req><Sel value={f.emergency_contact.relationship} onChange={v => setIn('emergency_contact', 'relationship', v)}><option value="">Select…</option>{RELATIONS.map(r => <option key={r}>{r}</option>)}</Sel></F>
            <F label="Phone" req><Input value={f.emergency_contact.phone} onChange={e => setIn('emergency_contact', 'phone', e.target.value)} /></F>
            <F label="Address" className="sm:col-span-2 lg:col-span-3"><Input value={f.emergency_contact.address} onChange={e => setIn('emergency_contact', 'address', e.target.value)} /></F>
          </Sec>

          <Card><CardContent className="p-4 space-y-3">
            <F label="Internal notes for HR (never shown to the employee)"><Textarea rows={2} value={f.hr_notes} onChange={e => set('hr_notes', e.target.value)} /></F>
            {errors.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-0.5">{errors.map((e, i) => <div key={i}>• {e}</div>)}</div>}
            {problems.length > 0 && <div className="text-xs text-amber-700">Still needed: {problems.join(', ')}.</div>}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={submit} disabled={busy || problems.length > 0} className="gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Start onboarding &amp; email the link</Button>
              <span className="text-xs text-gray-500">The employee receives a link (valid 7 days) to set a password and submit documents. The app opens for them once they submit.</span>
            </div>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!sent} onOpenChange={o => !o && setSent(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-600" />{sent?.login_email && !sent?.user_id ? 'New link created' : 'Onboarding started'} — {sent?.name}</DialogTitle></DialogHeader>
          {sent && (
            <div className="space-y-3 text-sm">
              {sent.email_sent ? <p>The link was emailed to <b>{sent.sent_to}</b>.</p> : <p className="text-amber-700">The email could not be sent{sent.email_error ? ` (${sent.email_error})` : ''}. Copy the link below and send it yourself (WhatsApp, SMS…).</p>}
              <p className="text-gray-600">Login ID: <b>{sent.login_email}</b> · the link works once and expires {fmt(sent.expires_at)}.</p>
              <div className="flex gap-2"><Input readOnly value={sent.invite_link} onFocus={e => e.target.select()} /><Button variant="outline" onClick={() => copy(sent.invite_link)}><Copy className="w-4 h-4" /></Button></div>
              <p className="text-[11px] text-gray-400">This link is only shown now. If it is lost, use “Resend link” in the Tracker to create a new one.</p>
              <Button onClick={() => { setSent(null); setTab('tracker'); }}>Go to tracker</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
