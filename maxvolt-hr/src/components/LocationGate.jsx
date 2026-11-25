import React, { useEffect, useRef, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { MapPinOff, ShieldAlert, Settings, RefreshCw, LogOut, BellRing } from 'lucide-react';
import { readLocationState, problemsFor, requestLocationAccess, openLocationSettings, PROBLEM_TEXT, PROBLEM_STEPS } from '@/lib/locationAccess';

const POLICY_KEY = 'mv_location_policy_v1';
const DISMISS_KEY = 'mv_location_guide_dismissed_v1';
const REMIND_MS = 30 * 60000;
const loadPolicy = () => { try { return JSON.parse(localStorage.getItem(POLICY_KEY) || 'null'); } catch { return null; } };
const loadDismiss = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null'); } catch { return null; } };
const signedIn = () => !!localStorage.getItem('base44_access_token');

// Location access for employees who are tracked (field duty / geofence attendance; HR's tracking rules decide who).
//  - Access already granted: nothing is shown, the app opens normally.
//  - Not granted: a guide with numbered steps for this phone. It is NOT a block (unless HR turns blocking on in the rules, then it
//    covers the app and cannot be closed). "Remind me later" closes it for 30 minutes.
//  - Granted and later switched off: an alert appears immediately, even if the guide was dismissed, and the server notifies the phone
//    too if tracking goes silent. The phone's state is also reported to the server so HR can see when and why tracking stopped.
export default function LocationGate() {
  const [policy, setPolicy] = useState(loadPolicy);
  const [problems, setProblems] = useState([]);
  const [justOff, setJustOff] = useState(false);
  const [dismissed, setDismissed] = useState(loadDismiss);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(null);
  const policyRef = useRef(policy);
  const prevOk = useRef(null);            // was everything fine at the previous check? (null = not checked yet)
  const lastReport = useRef({ at: 0, sig: '' });
  policyRef.current = policy;

  const refreshPolicy = useCallback(async () => {
    if (!signedIn()) { setPolicy(null); return null; }
    try {
      const r = await base44.functions.invoke('getMyTrackingPolicy', {}); const d = r?.data || r;
      if (d?.success) {
        const p = { required: !!d.required, guide: !!d.guide, background: !!d.background, battery: !!d.battery, report_minutes: d.report_minutes || 5 };
        localStorage.setItem(POLICY_KEY, JSON.stringify(p)); setPolicy(p); return p;
      }
    } catch { /* offline: keep the last known policy */ }
    return loadPolicy();
  }, []);

  const check = useCallback(async () => {
    const p = policyRef.current;
    if (!p || !signedIn() || !(p.required || p.guide)) { setProblems([]); return; }
    const s = await readLocationState();
    stateRef.current = s;
    const probs = problemsFor(s, p);
    // Access was fine a moment ago and now is not: alert immediately, whatever was dismissed before.
    if (probs.length && prevOk.current === true) { setJustOff(true); try { localStorage.removeItem(DISMISS_KEY); } catch { /* */ } setDismissed(null); }
    if (!probs.length) { setJustOff(false); try { localStorage.removeItem(DISMISS_KEY); } catch { /* */ } setDismissed(null); }
    prevOk.current = probs.length === 0;
    setProblems(probs);
    const sig = JSON.stringify(probs);
    const due = Date.now() - lastReport.current.at > (p.report_minutes || 5) * 60000;
    if (due || sig !== lastReport.current.sig) {
      lastReport.current = { at: Date.now(), sig };
      base44.functions.invoke('reportTrackingDevice', { platform: s.platform, fg: s.fg, bg: s.bg, gps: s.gps, battery: s.battery, notif: s.notif }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    refreshPolicy().then(() => check());
    const t = setInterval(() => refreshPolicy().then(() => check()), 600000);
    return () => clearInterval(t);
  }, [refreshPolicy, check]);

  const open = problems.length > 0;
  useEffect(() => {
    check();
    const t = setInterval(check, open ? 4000 : 20000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [check, open, policy]);

  if (!policy || !(policy.required || policy.guide) || !open) return null;

  const sig = JSON.stringify(problems);
  const blocking = !!policy.required;
  const snoozed = !blocking && dismissed && dismissed.sig === sig && Date.now() - dismissed.at < REMIND_MS;
  const later = () => { const d = { sig, at: Date.now() }; try { localStorage.setItem(DISMISS_KEY, JSON.stringify(d)); } catch { /* */ } setDismissed(d); };
  const fix = async () => { setBusy(true); try { await requestLocationAccess(stateRef.current || {}); } finally { setBusy(false); check(); } };
  const logout = async () => { try { await base44.auth.logout(); } catch { /* ignore */ } };

  // dismissed for now: a slim reminder stays at the top
  if (snoozed) {
    return (
      <button onClick={() => setDismissed(null)} className="fixed top-0 inset-x-0 z-[99990] bg-orange-600 text-white text-xs py-1.5 px-3 flex items-center justify-center gap-2" style={{ paddingTop: 'max(0.375rem, env(safe-area-inset-top))' }}>
        <MapPinOff className="w-3.5 h-3.5" /> Location is not fully enabled - tap to fix
      </button>
    );
  }

  return (
    <div role="alertdialog" aria-modal="true" className={`fixed inset-0 z-[100000] flex items-center justify-center p-6 overflow-y-auto ${blocking ? 'bg-white dark:bg-gray-950' : 'bg-black/60'}`} style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      <div className={`max-w-md w-full space-y-5 text-center ${blocking ? '' : 'bg-white dark:bg-gray-950 rounded-2xl p-6 shadow-2xl'}`}>
        <div className="mx-auto w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">{justOff ? <BellRing className="w-8 h-8 text-red-600" /> : <MapPinOff className="w-8 h-8 text-orange-600" />}</div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{justOff ? 'Location was just switched off' : 'Please enable location access'}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {justOff ? 'Your attendance and field duty are not being recorded while location is off. Please turn it back on.' : 'Maxvolt One needs location access for attendance and field duty. It is only used for that. Follow the steps below.'}
          </p>
        </div>
        <ul className="text-left space-y-2">
          {problems.map(k => {
            const steps = (PROBLEM_STEPS[stateRef.current?.platform] || PROBLEM_STEPS.web)[k];
            return (
              <li key={k} className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
                <div className="flex gap-2"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /><span className="font-medium">{PROBLEM_TEXT[k] || k}</span></div>
                {steps && <ol className="list-decimal ml-10 mt-1.5 space-y-0.5 text-xs text-orange-800">{steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
              </li>);
          })}
        </ul>
        <div className="space-y-2">
          <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white" disabled={busy} onClick={fix}>{busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}Enable location access</Button>
          <Button variant="outline" className="w-full" onClick={() => openLocationSettings()}><Settings className="w-4 h-4 mr-2" />Open phone settings</Button>
          <Button variant="outline" className="w-full" disabled={busy} onClick={() => { setBusy(true); check().finally(() => setBusy(false)); }}>I have done this - check again</Button>
          {blocking
            ? <button className="text-xs text-gray-500 underline inline-flex items-center gap-1" onClick={logout}><LogOut className="w-3 h-3" />Sign out</button>
            : <button className="text-sm text-gray-600 underline" onClick={later}>Remind me later</button>}
          <p className="text-xs text-gray-500">This closes by itself as soon as everything is allowed. If location is already allowed on your phone you will not see it.</p>
        </div>
      </div>
    </div>
  );
}
