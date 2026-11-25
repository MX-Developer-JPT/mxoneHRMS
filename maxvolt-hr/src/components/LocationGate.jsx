import React, { useEffect, useRef, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { MapPinOff, ShieldAlert, Settings, RefreshCw, LogOut } from 'lucide-react';
import { readLocationState, problemsFor, requestLocationAccess, openLocationSettings, PROBLEM_TEXT } from '@/lib/locationAccess';

const POLICY_KEY = 'mv_location_policy_v1';
const loadPolicy = () => { try { return JSON.parse(localStorage.getItem(POLICY_KEY) || 'null'); } catch { return null; } };
const signedIn = () => !!localStorage.getItem('base44_access_token');

// Full-screen, non-dismissable block for employees who must grant location access (HR's tracking rules decide who) and have not.
// It sits above the whole app, re-checks every few seconds and on return from the phone settings, and also reports the phone's
// state to the server so HR can see when tracking was switched off. Sign-out is the only other action.
export default function LocationGate() {
  const [policy, setPolicy] = useState(loadPolicy);
  const [problems, setProblems] = useState([]);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(null);
  const policyRef = useRef(policy);
  const lastReport = useRef({ at: 0, sig: '' });
  policyRef.current = policy;

  const refreshPolicy = useCallback(async () => {
    if (!signedIn()) { setPolicy(null); return null; }
    try {
      const r = await base44.functions.invoke('getMyTrackingPolicy', {}); const d = r?.data || r;
      if (d?.success) {
        const p = { required: !!d.required, background: !!d.background, battery: !!d.battery, report_minutes: d.report_minutes || 5 };
        localStorage.setItem(POLICY_KEY, JSON.stringify(p)); setPolicy(p); return p;
      }
    } catch { /* offline: keep the last known policy */ }
    return loadPolicy();
  }, []);

  const check = useCallback(async () => {
    const p = policyRef.current;
    if (!p || !signedIn()) { setProblems([]); return; }
    const s = await readLocationState();
    stateRef.current = s;
    const probs = problemsFor(s, p);
    setProblems(p.required ? probs : []);
    if (p.required) {
      const sig = JSON.stringify(probs);
      const due = Date.now() - lastReport.current.at > (p.report_minutes || 5) * 60000;
      if (due || sig !== lastReport.current.sig) {
        lastReport.current = { at: Date.now(), sig };
        base44.functions.invoke('reportTrackingDevice', { platform: s.platform, fg: s.fg, bg: s.bg, gps: s.gps, battery: s.battery, notif: s.notif }).catch(() => {});
      }
    }
  }, []);

  // policy now and every 10 minutes
  useEffect(() => {
    refreshPolicy().then(() => check());
    const t = setInterval(() => refreshPolicy().then(() => check()), 600000);
    return () => clearInterval(t);
  }, [refreshPolicy, check]);

  // phone state on a timer (fast while blocked) and whenever the app returns to the foreground
  const blocked = problems.length > 0;
  useEffect(() => {
    check();
    const t = setInterval(check, blocked ? 3000 : 30000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [check, blocked, policy]);

  if (!policy?.required || !blocked) return null;

  const fix = async () => { setBusy(true); try { await requestLocationAccess(stateRef.current || {}); } finally { setBusy(false); check(); } };
  const logout = async () => { try { await base44.auth.logout(); } catch { /* ignore */ } };

  return (
    <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-[100000] bg-white dark:bg-gray-950 flex items-center justify-center p-6 overflow-y-auto" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      <div className="max-w-md w-full space-y-5 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center"><MapPinOff className="w-8 h-8 text-orange-600" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Location access is required</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">You cannot use Maxvolt One until the settings below are fixed. Your location is used only for attendance and field duty.</p>
        </div>
        <ul className="text-left space-y-2">
          {problems.map(k => (
            <li key={k} className="flex gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900"><ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /><span>{PROBLEM_TEXT[k] || k}</span></li>
          ))}
        </ul>
        <div className="space-y-2">
          <Button className="w-full bg-orange-600 hover:bg-orange-700 text-white" disabled={busy} onClick={fix}>{busy ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}Enable location access</Button>
          <Button variant="outline" className="w-full" onClick={() => openLocationSettings()}><Settings className="w-4 h-4 mr-2" />Open phone settings</Button>
          <p className="text-xs text-gray-500">Set Location to "Allow all the time" and Battery to "Unrestricted", then come back. This screen closes by itself.</p>
          <button className="text-xs text-gray-500 underline inline-flex items-center gap-1" onClick={logout}><LogOut className="w-3 h-3" />Sign out</button>
        </div>
      </div>
    </div>
  );
}
