import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldCheck, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

// Opened from the onboarding email HR sends: the new joiner sets a password and goes straight to the onboarding form.
export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [info, setInfo] = useState(null);
  const [problem, setProblem] = useState('');
  const [alreadyUsed, setAlreadyUsed] = useState(false);
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) { setProblem('This link is incomplete. Please use the link from the email HR sent you.'); return; }
    fetch(`/api/onboarding-invite/${encodeURIComponent(token)}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) { setProblem(j.error || 'This link is not valid.'); setAlreadyUsed(!!j.already_used); } else setInfo(j); })
      .catch(() => setProblem('Could not reach the server. Please check your connection and try again.'));
  }, [token]);

  const rules = [
    ['At least 8 characters', pwd.length >= 8],
    ['A letter', /[A-Za-z]/.test(pwd)],
    ['A number', /\d/.test(pwd)],
    ['Both passwords match', pwd.length > 0 && pwd === pwd2],
  ];
  const ok = rules.every(r => r[1]);

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/onboarding-invite/${encodeURIComponent(token)}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not set your password');
      base44.auth.setToken(j.access_token);
      window.location.replace('/OnboardingForm');
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-white to-slate-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border p-6 md:p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="mx-auto w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-orange-600" /></div>
          <h1 className="text-xl font-bold text-gray-900">Welcome to Maxvolt Energy</h1>
          <p className="text-sm text-gray-500">Set a password to start your onboarding</p>
        </div>

        {!info && !problem && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>}

        {problem && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div>{problem}{alreadyUsed && <div className="mt-2"><Link to="/login" className="font-semibold underline">Go to sign in</Link></div>}</div>
          </div>
        )}

        {info && (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm space-y-0.5">
              <div className="font-semibold text-gray-900">{info.name}</div>
              {(info.designation || info.department) && <div className="text-gray-600">{[info.designation, info.department].filter(Boolean).join(' · ')}</div>}
              {info.date_of_joining && <div className="text-gray-600">Joining: {info.date_of_joining}</div>}
              <div className="text-gray-600">Your login ID: <b>{info.login_email}</b></div>
            </div>
            {info.checklist?.length > 0 && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-semibold text-gray-900">Documents you will need (about 15–20 minutes)</summary>
                <div className="mt-2 space-y-2">
                  {info.checklist.map(g => (
                    <div key={g.group}><div className="text-xs font-semibold text-gray-800">{g.group}{g.required ? '' : ' — if applicable'}</div><ul className="list-disc pl-5 text-xs text-gray-600 space-y-0.5">{g.items.map(i => <li key={i}>{i}</li>)}</ul></div>
                  ))}
                  <div className="text-[11px] text-gray-500">Each step is saved as you go, so you can stop and continue later.</div>
                </div>
              </details>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pw">Create a password</Label>
              <div className="relative">
                <Input id="pw" type={show ? 'text' : 'password'} autoComplete="new-password" value={pwd} onChange={e => setPwd(e.target.value)} className="pr-10" />
                <button type="button" className="absolute right-2 top-2.5 text-gray-400" onClick={() => setShow(s => !s)} aria-label="Show or hide password">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw2">Confirm password</Label>
              <Input id="pw2" type={show ? 'text' : 'password'} autoComplete="new-password" value={pwd2} onChange={e => setPwd2(e.target.value)} />
            </div>
            <ul className="text-xs space-y-0.5">{rules.map(([t, v]) => <li key={t} className={`flex items-center gap-1.5 ${v ? 'text-green-700' : 'text-gray-400'}`}><CheckCircle2 className="w-3.5 h-3.5" />{t}</li>)}</ul>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <Button type="submit" className="w-full" disabled={!ok || busy}>{busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Continue to onboarding</Button>
            <p className="text-[11px] text-gray-400 text-center">This link works once. Afterwards, sign in with your login ID and this password.</p>
          </form>
        )}
      </div>
    </div>
  );
}
