import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  QrCode, UserPlus, ArrowLeft, Home, CheckCircle2, XCircle, Camera, Search, Loader2, LogOut, Clock, ShieldCheck, Keyboard, MapPin, RotateCcw, AlertCircle,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────────
   Visitor Kiosk — a full-screen, touch-first front for Visitor Management.
   Public route (/kiosk), outside the normal app shell: no menus, no dashboard, no employee modules.
   It signs in with a *kiosk account* (own credentials + own token, kept only as the device's credential)
   and everything it can read or write is pinned, server-side, to that account's office location.
   Visitor details live only in this component's memory and are cleared on every reset.
   ───────────────────────────────────────────────────────────────────────────── */

const TOKEN_KEY = 'mx_kiosk_token';
const IDLE_LIMIT = 60;          // seconds of no touch before a half-finished visit is thrown away
const IDLE_WARN = 15;           // …with a "still there?" prompt for the last N seconds
const DONE_RESET = 15;          // seconds a result screen stays before returning home
const WALKIN_WAIT = 180;        // seconds the walk-in confirmation waits for the host's decision
const DURATIONS = [[0, 'Not sure'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [480, 'Full day']];
const CATEGORIES = [['guest', 'Guest'], ['client', 'Client'], ['vendor', 'Vendor'], ['interview', 'Interview'], ['delivery', 'Delivery'], ['other', 'Other']];
const ID_TYPES = ['Aadhaar', 'Driving Licence', 'Voter ID', 'Passport', 'PAN', 'Company ID', 'Other'];
const GUIDELINES = [
  'I will wear my visitor pass at all times and stay with my host or in the areas I am permitted to enter.',
  'I will follow the safety rules of the premises, including PPE where required.',
  'I will not photograph or record inside the premises without permission.',
  'I agree that my photograph and details may be recorded for security and visitor-register purposes.',
];

const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } };

async function kapi(path, { method = 'GET', body, token = getToken() } = {}) {
  try {
    const r = await fetch(`/api/kiosk${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
    let data = null; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data: data || {} };
  } catch { return { status: 0, data: { error: 'Cannot reach the server. Please check the connection.' } }; }
}

async function uploadPhoto(blob) {
  const fd = new FormData(); fd.append('file', blob, `kiosk_visitor_${Date.now()}.jpg`);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!r.ok) throw new Error('Photo upload failed');
  return (await r.json()).file_url;
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

const Spinner = ({ className = '' }) => <Loader2 className={`animate-spin ${className}`} />;

function BigButton({ children, onClick, disabled, tone = 'dark', className = '', type = 'button' }) {
  const tones = {
    dark: 'bg-slate-900 text-white active:bg-slate-700',
    amber: 'bg-amber-400 text-slate-900 active:bg-amber-500',
    green: 'bg-emerald-600 text-white active:bg-emerald-700',
    light: 'bg-white text-slate-800 border-2 border-slate-300 active:bg-slate-100',
    red: 'bg-red-600 text-white active:bg-red-700',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`min-h-[64px] px-8 rounded-2xl text-xl font-semibold flex items-center justify-center gap-3 transition-colors disabled:opacity-40 disabled:pointer-events-none ${tones[tone]} ${className}`}>
      {children}
    </button>
  );
}

function Field({ label, children, hint, required }) {
  return (
    <label className="block">
      <span className="block text-base font-medium text-slate-600 mb-1.5">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="block text-sm text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full h-16 px-5 rounded-2xl border-2 border-slate-300 bg-white text-xl text-slate-900 placeholder-slate-300 focus:outline-none focus:border-amber-500 select-text';

function Banner({ tone = 'red', children }) {
  const c = tone === 'red' ? 'bg-red-50 border-red-200 text-red-800' : tone === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900';
  return <div className={`flex items-start gap-3 rounded-2xl border-2 px-5 py-4 text-lg ${c}`}><AlertCircle className="w-6 h-6 shrink-0 mt-0.5" /><div>{children}</div></div>;
}

function TopBar({ title, onBack, onHome, step, steps }) {
  return (
    <div className="flex items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3 min-w-0">
        {onBack && <button onClick={onBack} className="h-14 w-14 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center active:bg-slate-100 shrink-0" aria-label="Back"><ArrowLeft className="w-7 h-7" /></button>}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-slate-900 truncate">{title}</h1>
          {steps && <p className="text-slate-500 text-lg">Step {step} of {steps}</p>}
        </div>
      </div>
      <button onClick={onHome} className="h-14 px-5 rounded-full bg-white border-2 border-slate-300 flex items-center gap-2 text-lg font-medium active:bg-slate-100 shrink-0"><Home className="w-6 h-6" />Home</button>
    </div>
  );
}

/* ── camera ───────────────────────────────────────────────────────────────── */

function useCamera(active, facing = 'user') {
  const videoRef = useRef(null); const streamRef = useRef(null);
  const [error, setError] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let dead = false; setError(''); setReady(false);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError('The camera is not available on this device.'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 720 } }, audio: false });
        if (dead) { s.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play?.().catch(() => {}); }
        setReady(true);
      } catch (e) { setError(e?.name === 'NotAllowedError' ? 'Camera permission is blocked for this kiosk.' : 'The camera could not be started.'); }
    })();
    return () => { dead = true; streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setReady(false); };
  }, [active, facing]);
  const snapshot = useCallback((maxW = 720) => new Promise((resolve) => {
    const v = videoRef.current; if (!v || !v.videoWidth) return resolve(null);
    const scale = Math.min(1, maxW / v.videoWidth); const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext('2d'); ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, c.width, c.height);   // un-mirror the selfie view
    c.toBlob(b => resolve(b), 'image/jpeg', 0.82);
  }), []);
  return { videoRef, error, ready, snapshot };
}

function QrScanner({ onCode }) {
  const { videoRef, error, ready } = useCamera(true, 'user');
  const canvasRef = useRef(null); const raf = useRef(0); const done = useRef(false);
  useEffect(() => {
    if (!ready) return undefined;
    const tick = () => {
      const v = videoRef.current, c = canvasRef.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA && !done.current) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, c.width, c.height);
        const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
        if (code?.data) { done.current = true; onCode(code.data); return; }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => { done.current = false; }, []);
  if (error) return <Banner tone="amber">{error} Please type your code instead.</Banner>;
  return (
    <div className="relative bg-black rounded-3xl overflow-hidden mx-auto" style={{ aspectRatio: '4/3', maxWidth: 640 }}>
      <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover -scale-x-100" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute inset-[18%] border-4 border-white/80 rounded-3xl pointer-events-none" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center text-white"><Spinner className="w-10 h-10" /></div>}
    </div>
  );
}

function PhotoCapture({ value, onChange, onCameraUnavailable }) {
  const [live, setLive] = useState(!value);
  const { videoRef, error, ready, snapshot } = useCamera(live, 'user');
  const [count, setCount] = useState(0);
  useEffect(() => { if (error) onCameraUnavailable?.(true); }, [error]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shoot = async () => {
    for (let i = 3; i > 0; i--) { setCount(i); await new Promise(r => setTimeout(r, 800)); }
    setCount(0);
    const blob = await snapshot(); if (!blob) return;
    onChange({ blob, url: URL.createObjectURL(blob) }); setLive(false);
  };
  const retake = () => { if (value?.url) URL.revokeObjectURL(value.url); onChange(null); setLive(true); };
  if (error) return <Banner tone="amber">{error} The reception will take your photograph.</Banner>;
  return (
    <div className="space-y-4">
      <div className="relative bg-black rounded-3xl overflow-hidden mx-auto" style={{ aspectRatio: '4/3', maxWidth: 560 }}>
        {value ? <img src={value.url} alt="Your photograph" className="w-full h-full object-cover" />
          : <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover -scale-x-100" />}
        {!value && !ready && <div className="absolute inset-0 flex items-center justify-center text-white"><Spinner className="w-10 h-10" /></div>}
        {count > 0 && <div className="absolute inset-0 flex items-center justify-center text-white text-9xl font-bold bg-black/30">{count}</div>}
      </div>
      <div className="flex justify-center">
        {value ? <BigButton tone="light" onClick={retake}><RotateCcw className="w-6 h-6" />Retake photo</BigButton>
          : <BigButton tone="amber" onClick={shoot} disabled={!ready || count > 0}><Camera className="w-6 h-6" />Take my photo</BigButton>}
      </div>
    </div>
  );
}

function GuidelinesBox({ accepted, onChange }) {
  return (
    <div className="rounded-3xl bg-white border-2 border-slate-200 p-6 space-y-4">
      <div className="flex items-center gap-3 text-xl font-semibold text-slate-800"><ShieldCheck className="w-7 h-7 text-emerald-600" />Visitor guidelines</div>
      <ul className="space-y-2 text-lg text-slate-600 list-disc pl-6">{GUIDELINES.map(g => <li key={g}>{g}</li>)}</ul>
      <button type="button" onClick={() => onChange(!accepted)} className={`w-full min-h-[64px] rounded-2xl border-2 flex items-center gap-4 px-5 text-xl font-medium ${accepted ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-700'}`}>
        <span className={`w-9 h-9 rounded-lg border-2 flex items-center justify-center ${accepted ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-400'}`}>{accepted && <CheckCircle2 className="w-6 h-6" />}</span>
        I have read and agree to the visitor guidelines
      </button>
    </div>
  );
}

/* ── sign-in (device set-up) ──────────────────────────────────────────────── */

function KioskLogin({ onDone, notice }) {
  const [u, setU] = useState(''); const [p, setP] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await kapi('/login', { method: 'POST', body: { username: u, password: p }, token: '' });
    setBusy(false);
    if (r.data?.token) { setToken(r.data.token); onDone(r.data.token); } else setErr(r.data?.error || 'Sign-in failed');
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-100">
      <form onSubmit={submit} className="w-full max-w-lg bg-white rounded-3xl shadow-xl p-10 space-y-6">
        <img src="/maxvolt-logo-letterhead.png" alt="MaxVolt Energy" className="h-28 w-28 object-contain mx-auto -my-3" />
        <div className="text-center"><h1 className="text-3xl font-bold text-slate-900">Visitor Kiosk set-up</h1><p className="text-slate-500 text-lg mt-1">Sign in with the kiosk account created by your administrator.</p></div>
        {(notice || err) && <Banner>{err || notice}</Banner>}
        <Field label="Kiosk username"><input className={inputCls} value={u} onChange={e => setU(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="off" /></Field>
        <Field label="Password"><input className={inputCls} type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="off" /></Field>
        <BigButton type="submit" tone="dark" className="w-full" disabled={busy || !u || !p}>{busy ? <Spinner className="w-6 h-6" /> : 'Start kiosk'}</BigButton>
      </form>
    </div>
  );
}

/* ── home ─────────────────────────────────────────────────────────────────── */

function HomeScreen({ kiosk, now, go }) {
  const date = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return (
    <div className="min-h-screen flex flex-col px-8 py-8 max-w-6xl mx-auto">
      <header className="flex items-start justify-between gap-6">
        <img src="/maxvolt-logo-letterhead.png" alt="MaxVolt Energy" className="h-28 w-28 object-contain mix-blend-multiply -my-2" />
        <div className="text-right">
          <div className="text-5xl font-bold text-slate-900 tabular-nums">{time}</div>
          <div className="text-xl text-slate-500 mt-1">{date}</div>
        </div>
      </header>
      <div className="text-center mt-10 sm:mt-14">
        <h1 className="text-5xl sm:text-6xl font-bold text-slate-900">Welcome to MaxVolt Energy</h1>
        <div className="inline-flex items-center gap-2 mt-5 px-6 py-2.5 rounded-full bg-amber-100 text-amber-900 text-2xl font-semibold"><MapPin className="w-6 h-6" />{kiosk.location_name}</div>
      </div>
      <div className="grid md:grid-cols-2 gap-6 mt-10 sm:mt-14 flex-1 content-start">
        <button onClick={() => go('invite')} className="text-left rounded-[2rem] bg-slate-900 text-white p-10 min-h-[260px] flex flex-col justify-between active:scale-[0.98] transition-transform shadow-xl">
          <QrCode className="w-20 h-20 text-amber-400" />
          <div><div className="text-4xl font-bold">I Have an Invitation</div><p className="text-xl text-slate-300 mt-3 leading-snug">Already have a visitor invitation? Check in using your invitation pass.</p></div>
        </button>
        <button onClick={() => go('walkin')} className="text-left rounded-[2rem] bg-amber-400 text-slate-900 p-10 min-h-[260px] flex flex-col justify-between active:scale-[0.98] transition-transform shadow-xl">
          <UserPlus className="w-20 h-20" />
          <div><div className="text-4xl font-bold">Walk-in Visitor Registration</div><p className="text-xl text-slate-800 mt-3 leading-snug">Visiting without a prior invitation? Register your details to request entry.</p></div>
        </button>
      </div>
      <footer className="flex justify-center mt-8">
        <button onClick={() => go('checkout')} className="h-16 px-8 rounded-full bg-white border-2 border-slate-300 text-xl font-medium text-slate-700 flex items-center gap-3 active:bg-slate-100"><LogOut className="w-6 h-6" />Leaving? Check out here</button>
      </footer>
    </div>
  );
}

/* ── invitation / check-out lookup ────────────────────────────────────────── */

function CodeScreen({ intent, go, setFlow, goHome }) {
  const [mode, setMode] = useState('scan');   // scan | type
  const [code, setCode] = useState(''); const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [needMobile, setNeedMobile] = useState(false);
  const busyRef = useRef(false);
  const isFull = /^[0-9a-f-]{32,36}$/i.test(code.trim());
  const submit = async (value = code, last4 = mobile) => {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setErr('');
    const r = await kapi('/lookup', { method: 'POST', body: { code: value, mobile_last4: last4, intent } });
    busyRef.current = false; setBusy(false);
    if (r.data?.success) { setFlow({ visit: r.data.visitor, ticket: r.data.ticket, intent }); go(intent === 'checkout' ? 'confirm_out' : 'confirm'); return; }
    if (r.data?.code === 'need_mobile') { setNeedMobile(true); setErr(r.data.error); return; }
    setErr(r.data?.error || 'Something went wrong. Please try again.'); setMode('type');
  };
  const title = intent === 'checkout' ? 'Check Out' : 'I Have an Invitation';
  return (
    <div className="min-h-screen px-8 py-8 max-w-4xl mx-auto">
      <TopBar title={title} onBack={goHome} onHome={goHome} />
      <p className="text-2xl text-slate-600 mb-6">{intent === 'checkout' ? 'Scan the QR code on your visitor pass, or type your Pass ID.' : 'Hold the QR code on your invitation pass in front of the camera.'}</p>
      {err && <div className="mb-6"><Banner>{err}</Banner></div>}
      <div className="flex gap-3 mb-6">
        <button onClick={() => setMode('scan')} className={`flex-1 h-16 rounded-2xl text-xl font-semibold flex items-center justify-center gap-3 ${mode === 'scan' ? 'bg-slate-900 text-white' : 'bg-white border-2 border-slate-300 text-slate-700'}`}><QrCode className="w-6 h-6" />Scan QR code</button>
        <button onClick={() => setMode('type')} className={`flex-1 h-16 rounded-2xl text-xl font-semibold flex items-center justify-center gap-3 ${mode === 'type' ? 'bg-slate-900 text-white' : 'bg-white border-2 border-slate-300 text-slate-700'}`}><Keyboard className="w-6 h-6" />Type my code</button>
      </div>
      {mode === 'scan' ? (
        <div className="space-y-4">
          {busy ? <div className="flex items-center justify-center gap-3 text-2xl text-slate-600 py-24"><Spinner className="w-8 h-8" />Checking your pass…</div>
            : <QrScanner key={err} onCode={(c) => submit(c, '')} />}
          <p className="text-center text-lg text-slate-500">The code is on your invitation message or printed pass.</p>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
          <Field label="Pass ID or invitation code" hint="The 8-character Pass ID printed under the QR code (or the full code)." required>
            <input className={`${inputCls} uppercase tracking-widest`} value={code} onChange={e => { setCode(e.target.value); setNeedMobile(false); }} autoCapitalize="characters" autoCorrect="off" autoComplete="off" autoFocus maxLength={40} />
          </Field>
          {(needMobile || (code.trim().length > 0 && !isFull)) && (
            <Field label="Last 4 digits of your mobile number" hint="The number your invitation was issued for." required>
              <input className={inputCls} inputMode="numeric" pattern="[0-9]*" value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 4))} autoComplete="off" />
            </Field>
          )}
          <BigButton type="submit" tone="dark" className="w-full" disabled={busy || code.trim().length < 8 || (!isFull && mobile.length !== 4)}>{busy ? <Spinner className="w-6 h-6" /> : 'Continue'}</BigButton>
        </form>
      )}
    </div>
  );
}

/* ── invited visitor: confirm + check in ──────────────────────────────────── */

function ConfirmScreen({ flow, goHome, setFlow, go }) {
  const v = flow.visit;
  const [idType, setIdType] = useState(''); const [idNo, setIdNo] = useState(''); const [vehicle, setVehicle] = useState('');
  const [photo, setPhoto] = useState(null); const [noCam, setNoCam] = useState(false); const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);
  const needPhoto = !v.has_photo && !noCam;
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let photo_url = '';
      if (photo?.blob) photo_url = await uploadPhoto(photo.blob);
      const r = await kapi('/checkin', { method: 'POST', body: { ticket: flow.ticket, declaration: ok, id_type: idType, id_number: idNo, vehicle_number: vehicle, photo_url } });
      if (r.data?.success) { setFlow({ result: { kind: 'checkin', message: r.data.message, host: r.data.host_name || v.host_name, name: v.visitor_name } }); go('done'); return; }
      setErr(r.data?.error || 'Check-in could not be completed.');
      if (['checked_in', 'ticket', 'expired', 'cancelled', 'wrong_location'].includes(r.data?.code)) setFlow({ result: { kind: 'error', message: r.data.error } }), go('done');
    } catch (e) { setErr(e.message || 'Check-in could not be completed.'); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen px-8 py-8 max-w-4xl mx-auto space-y-6">
      <TopBar title="Please confirm your details" onBack={goHome} onHome={goHome} />
      <div className="rounded-3xl bg-white border-2 border-slate-200 p-8 grid sm:grid-cols-2 gap-x-8 gap-y-5">
        {[['Name', v.visitor_name], ['Company', v.company || '—'], ['You are meeting', v.host_name], ['Purpose', v.purpose || '—'], ['Mobile', v.mobile_masked]].map(([k, val]) => (
          <div key={k}><div className="text-base text-slate-400 font-medium">{k}</div><div className="text-2xl font-semibold text-slate-900 break-words">{val}</div></div>
        ))}
      </div>
      {err && <Banner>{err}</Banner>}
      <div className="grid sm:grid-cols-2 gap-5">
        <Field label="ID type (optional)"><select className={inputCls} value={idType} onChange={e => setIdType(e.target.value)}><option value="">Select…</option>{ID_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="ID number (optional)" hint="Only the last 4 characters are kept."><input className={inputCls} value={idNo} onChange={e => setIdNo(e.target.value)} autoComplete="off" maxLength={30} /></Field>
        <Field label="Vehicle number (optional)"><input className={`${inputCls} uppercase`} value={vehicle} onChange={e => setVehicle(e.target.value)} autoComplete="off" maxLength={20} /></Field>
      </div>
      {!v.has_photo && <div><div className="text-xl font-semibold text-slate-800 mb-3">Your photograph</div><PhotoCapture value={photo} onChange={setPhoto} onCameraUnavailable={setNoCam} /></div>}
      <GuidelinesBox accepted={ok} onChange={setOk} />
      <BigButton tone="green" className="w-full" onClick={submit} disabled={busy || !ok || (needPhoto && !photo)}>{busy ? <Spinner className="w-7 h-7" /> : <><CheckCircle2 className="w-7 h-7" />Check me in</>}</BigButton>
    </div>
  );
}

function ConfirmOutScreen({ flow, goHome, setFlow, go }) {
  const v = flow.visit; const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    const r = await kapi('/checkout', { method: 'POST', body: { ticket: flow.ticket } });
    setBusy(false);
    if (r.data?.success) { setFlow({ result: { kind: 'checkout', message: r.data.message, name: v.visitor_name } }); go('done'); } else setErr(r.data?.error || 'Check-out could not be completed.');
  };
  return (
    <div className="min-h-screen px-8 py-8 max-w-3xl mx-auto space-y-6">
      <TopBar title="Check out" onBack={goHome} onHome={goHome} />
      <div className="rounded-3xl bg-white border-2 border-slate-200 p-8"><div className="text-base text-slate-400 font-medium">Visitor</div><div className="text-3xl font-bold text-slate-900">{v.visitor_name}</div><div className="text-xl text-slate-500 mt-1">{v.company}{v.company ? ' · ' : ''}Met {v.host_name}</div></div>
      {err && <Banner>{err}</Banner>}
      <BigButton tone="dark" className="w-full" onClick={submit} disabled={busy}>{busy ? <Spinner className="w-7 h-7" /> : <><LogOut className="w-7 h-7" />Confirm check-out</>}</BigButton>
    </div>
  );
}

/* ── walk-in registration ─────────────────────────────────────────────────── */

function HostPicker({ value, onChange }) {
  const [q, setQ] = useState(''); const [hits, setHits] = useState([]); const [busy, setBusy] = useState(false); const seq = useRef(0);
  useEffect(() => {
    if (value || q.trim().length < 2) { setHits([]); return undefined; }
    const my = ++seq.current; setBusy(true);
    const t = setTimeout(async () => {
      const r = await kapi(`/hosts?q=${encodeURIComponent(q.trim())}`);
      if (my === seq.current) { setHits(r.data?.hosts || []); setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border-2 border-emerald-400 bg-emerald-50 px-5 py-4">
      <div><div className="text-2xl font-semibold text-slate-900">{value.name}</div>{value.department && <div className="text-lg text-slate-500">{value.department}</div>}</div>
      <button onClick={() => { onChange(null); setQ(''); }} className="h-12 px-5 rounded-full bg-white border-2 border-slate-300 text-lg font-medium active:bg-slate-100">Change</button>
    </div>
  );
  return (
    <div>
      <div className="relative"><Search className="w-6 h-6 text-slate-400 absolute left-5 top-5" /><input className={`${inputCls} pl-14`} placeholder="Search by name, employee ID or department" value={q} onChange={e => setQ(e.target.value)} autoComplete="off" /></div>
      {busy && <div className="mt-3 text-slate-400 flex items-center gap-2 text-lg"><Spinner className="w-5 h-5" />Searching…</div>}
      {!busy && q.trim().length >= 2 && hits.length === 0 && <div className="mt-3 text-lg text-slate-500">No match found. Try another spelling.</div>}
      {hits.length > 0 && <div className="mt-3 rounded-2xl border-2 border-slate-200 bg-white overflow-hidden divide-y">{hits.map(h => (
        <button key={h.id} onClick={() => onChange(h)} className="w-full text-left px-5 py-4 active:bg-amber-50"><div className="text-xl font-semibold text-slate-900">{h.name}</div>{h.department && <div className="text-lg text-slate-500">{h.department}</div>}</button>
      ))}</div>}
    </div>
  );
}

const emptyWalk = { visitor_name: '', mobile_number: '', visitor_email: '', company: '', visitor_category: 'guest', purpose: '', duration_minutes: 0, vehicle_number: '', id_type: '', id_number: '' };

function WalkInScreen({ goHome, setFlow, go }) {
  const [step, setStep] = useState(1); const [f, setF] = useState(emptyWalk); const [host, setHost] = useState(null);
  const [photo, setPhoto] = useState(null); const [noCam, setNoCam] = useState(false); const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);
  const set = (k) => (e) => setF(p => ({ ...p, [k]: e.target.value }));
  const mobileOk = /^[6-9]\d{9}$/.test(f.mobile_number.replace(/\D/g, '').slice(-10)) && f.mobile_number.replace(/\D/g, '').length >= 10;
  const emailOk = !f.visitor_email || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.visitor_email);
  const can = {
    1: f.visitor_name.trim().length >= 2 && mobileOk && emailOk,
    2: !!host && f.purpose.trim().length >= 3,
    3: !!photo || noCam,
    4: ok,
  }[step];
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let photo_url = ''; if (photo?.blob) photo_url = await uploadPhoto(photo.blob);
      const r = await kapi('/walkin', { method: 'POST', body: { ...f, host_user_id: host.id, photo_url, photo_skipped: noCam && !photo_url, declaration: ok } });
      if (r.data?.success) {
        setFlow({ result: { kind: 'walkin', message: r.data.message, host: r.data.host_name, name: f.visitor_name, claim: r.data.claim, visit: { visitor_name: f.visitor_name, company: f.company, host_name: r.data.host_name, purpose: f.purpose, mobile_masked: 'XXXXXX' + f.mobile_number.replace(/\D/g, '').slice(-4), has_photo: !!photo_url } } });
        go('done'); return;
      }
      setErr(r.data?.error || 'Your registration could not be submitted.');
      if (['duplicate', 'RESTRICTED'].includes(r.data?.code)) { setFlow({ result: { kind: 'error', message: r.data.error } }); go('done'); return; }
    } catch (e) { setErr(e.message || 'Your registration could not be submitted.'); }
    setBusy(false);
  };
  const back = () => (step === 1 ? goHome() : setStep(step - 1));
  return (
    <div className="min-h-screen px-8 py-8 max-w-4xl mx-auto space-y-6">
      <TopBar title="Walk-in Visitor Registration" onBack={back} onHome={goHome} step={step} steps={4} />
      {err && <Banner>{err}</Banner>}
      {step === 1 && (
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Full name" required><input className={inputCls} value={f.visitor_name} onChange={set('visitor_name')} autoComplete="off" maxLength={80} autoFocus /></Field>
          <Field label="Mobile number" required hint={f.mobile_number && !mobileOk ? 'Enter a valid 10-digit mobile number' : ''}><input className={inputCls} inputMode="tel" value={f.mobile_number} onChange={set('mobile_number')} autoComplete="off" maxLength={16} /></Field>
          <Field label="Email (optional)" hint={!emailOk ? 'That email does not look right' : ''}><input className={inputCls} type="email" value={f.visitor_email} onChange={set('visitor_email')} autoCapitalize="none" autoComplete="off" maxLength={120} /></Field>
          <Field label="Company / organisation"><input className={inputCls} value={f.company} onChange={set('company')} autoComplete="off" maxLength={100} /></Field>
          <div className="sm:col-span-2"><div className="text-base font-medium text-slate-600 mb-2">I am a</div>
            <div className="flex flex-wrap gap-3">{CATEGORIES.map(([k, l]) => <button key={k} onClick={() => setF(p => ({ ...p, visitor_category: k }))} className={`h-14 px-6 rounded-full text-lg font-medium border-2 ${f.visitor_category === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700'}`}>{l}</button>)}</div></div>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-5">
          <Field label="Who are you here to meet?" required><HostPicker value={host} onChange={setHost} /></Field>
          <Field label="Purpose of visit" required><input className={inputCls} value={f.purpose} onChange={set('purpose')} autoComplete="off" maxLength={200} placeholder="e.g. Product demo, interview, delivery" /></Field>
          <div><div className="text-base font-medium text-slate-600 mb-2">Expected duration</div>
            <div className="flex flex-wrap gap-3">{DURATIONS.map(([m, l]) => <button key={m} onClick={() => setF(p => ({ ...p, duration_minutes: m }))} className={`h-14 px-6 rounded-full text-lg font-medium border-2 ${f.duration_minutes === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700'}`}>{l}</button>)}</div></div>
          <Field label="Vehicle number (optional)"><input className={`${inputCls} uppercase`} value={f.vehicle_number} onChange={set('vehicle_number')} autoComplete="off" maxLength={20} /></Field>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Photo ID type (optional)"><select className={inputCls} value={f.id_type} onChange={set('id_type')}><option value="">Select…</option>{ID_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
            <Field label="ID number (optional)" hint="Only the last 4 characters are kept."><input className={inputCls} value={f.id_number} onChange={set('id_number')} autoComplete="off" maxLength={30} /></Field>
          </div>
          <div><div className="text-xl font-semibold text-slate-800 mb-3">Your photograph</div><PhotoCapture value={photo} onChange={setPhoto} onCameraUnavailable={setNoCam} /></div>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-6">
          <div className="rounded-3xl bg-white border-2 border-slate-200 p-8 grid sm:grid-cols-2 gap-x-8 gap-y-5">
            {[['Name', f.visitor_name], ['Mobile', f.mobile_number], ['Company', f.company || '—'], ['Meeting', host?.name], ['Purpose', f.purpose]].map(([k, v]) => <div key={k}><div className="text-base text-slate-400 font-medium">{k}</div><div className="text-2xl font-semibold text-slate-900 break-words">{v}</div></div>)}
          </div>
          <GuidelinesBox accepted={ok} onChange={setOk} />
        </div>
      )}
      <div className="flex gap-4 pt-2">
        {step < 4
          ? <BigButton tone="dark" className="flex-1" disabled={!can} onClick={() => setStep(step + 1)}>Continue</BigButton>
          : <BigButton tone="green" className="flex-1" disabled={!can || busy} onClick={submit}>{busy ? <Spinner className="w-7 h-7" /> : <><CheckCircle2 className="w-7 h-7" />Submit registration</>}</BigButton>}
      </div>
    </div>
  );
}

/* ── result ───────────────────────────────────────────────────────────────── */

function DoneScreen({ flow, goHome, setFlow, go }) {
  const r = flow.result || { kind: 'error', message: 'Something went wrong.' };
  const [left, setLeft] = useState(r.kind === 'walkin' ? WALKIN_WAIT : DONE_RESET);
  const [status, setStatus] = useState('pending_approval'); const [ticket, setTicket] = useState('');
  useEffect(() => { const t = setInterval(() => setLeft(s => s - 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (left <= 0) goHome(); }, [left]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (r.kind !== 'walkin' || !r.claim) return undefined;
    let dead = false;
    const poll = async () => {
      const s = await kapi('/walkin-status', { method: 'POST', body: { ticket: r.claim } });
      if (dead || !s.data?.success) return;
      setStatus(s.data.status); if (s.data.ticket) setTicket(s.data.ticket);
    };
    const t = setInterval(poll, 4000); return () => { dead = true; clearInterval(t); };
  }, [r.kind, r.claim]);

  const ok = r.kind === 'checkin' || r.kind === 'checkout' || r.kind === 'walkin';
  let tone = ok ? 'green' : 'red'; let title = ''; let body = r.message;
  if (r.kind === 'checkin') title = 'Check-in Successful!';
  else if (r.kind === 'checkout') title = 'Thank you for visiting!';
  else if (r.kind === 'walkin') {
    if (status === 'approved') { title = 'You are approved!'; body = `${r.host} has approved your visit. Tap below to check in.`; }
    else if (status === 'rejected') { tone = 'red'; title = 'Request declined'; body = 'Your request was not approved. Please speak to the reception for help.'; }
    else if (status === 'cancelled') { tone = 'red'; title = 'Request cancelled'; body = 'Please speak to the reception for help.'; }
    else title = 'Registration Submitted Successfully';
  } else title = 'We could not complete that';
  const Icon = tone === 'green' ? CheckCircle2 : XCircle;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center max-w-3xl mx-auto gap-8">
      <Icon className={`w-32 h-32 ${tone === 'green' ? 'text-emerald-500' : 'text-red-500'}`} />
      <div><h1 className="text-5xl font-bold text-slate-900">{title}</h1>{body && <p className="text-2xl text-slate-600 mt-5 leading-snug">{body}</p>}</div>
      {r.kind === 'checkin' && <p className="text-2xl text-slate-500">Welcome, {r.name}</p>}
      {r.kind === 'walkin' && status === 'pending_approval' && <div className="flex items-center gap-3 text-xl text-slate-500"><Spinner className="w-6 h-6" />Waiting for {r.host} to respond… If this takes long, please wait at the reception.</div>}
      {r.kind === 'walkin' && status === 'approved' && ticket && <BigButton tone="green" onClick={() => { setFlow({ visit: r.visit, ticket, intent: 'checkin' }); go('confirm'); }}><CheckCircle2 className="w-7 h-7" />Check me in</BigButton>}
      <BigButton tone="light" onClick={goHome}><Home className="w-6 h-6" />Done</BigButton>
      <p className="text-slate-400 text-lg flex items-center gap-2"><Clock className="w-5 h-5" />Returning to the home screen in {left}s</p>
    </div>
  );
}

/* ── shell ────────────────────────────────────────────────────────────────── */

export default function KioskApp() {
  const [phase, setPhase] = useState('boot');           // boot | login | run
  const [kiosk, setKiosk] = useState(null); const [notice, setNotice] = useState('');
  const [screen, setScreen] = useState('home'); const [flow, setFlow] = useState({});
  const [offset, setOffset] = useState(0); const [now, setNow] = useState(new Date()); const [idle, setIdle] = useState(0);
  const lastTouch = useRef(Date.now()); const screenRef = useRef('home'); screenRef.current = screen;

  const signedOut = useCallback((msg) => { setToken(''); setKiosk(null); setFlow({}); setScreen('home'); setNotice(msg || ''); setPhase('login'); }, []);
  const goHome = useCallback(() => { setFlow({}); setScreen('home'); lastTouch.current = Date.now(); setIdle(0); }, []);
  const go = useCallback((s) => { setScreen(s); lastTouch.current = Date.now(); setIdle(0); }, []);

  const boot = useCallback(async () => {
    if (!getToken()) { setPhase('login'); return; }
    const r = await kapi('/me');
    if (r.status === 0) { setTimeout(boot, 5000); return; }                     // offline at start-up: keep trying
    if (r.data?.success) { if (r.data.token) setToken(r.data.token); setKiosk(r.data.kiosk); setOffset((r.data.server_time || Date.now()) - Date.now()); setPhase('run'); }
    else signedOut(r.data?.error);
  }, [signedOut]);
  useEffect(() => { boot(); }, [boot]);

  // heartbeat: keeps the session alive, re-reads the kiosk's location (changes apply at once) and ends the session if revoked
  useEffect(() => {
    if (phase !== 'run') return undefined;
    const t = setInterval(async () => {
      const r = await kapi('/me');
      if (r.data?.success) { if (r.data.token) setToken(r.data.token); setKiosk(r.data.kiosk); setOffset((r.data.server_time || Date.now()) - Date.now()); }
      else if (r.status === 401 || r.status === 403) signedOut(r.data?.error);
    }, 60000);
    return () => clearInterval(t);
  }, [phase, signedOut]);

  // clock + inactivity
  useEffect(() => {
    if (phase !== 'run') return undefined;
    const t = setInterval(() => {
      setNow(new Date(Date.now() + offset));
      const s = (Date.now() - lastTouch.current) / 1000;
      if (screenRef.current !== 'home' && screenRef.current !== 'done') { if (s >= IDLE_LIMIT) goHome(); else setIdle(s); } else setIdle(0);
    }, 1000);
    return () => clearInterval(t);
  }, [phase, offset, goHome]);

  // kiosk behaviour: any touch counts as activity; full screen; no context menu / back navigation / pinch zoom; keep awake
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); };
    const block = (e) => e.preventDefault();
    const fullscreen = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
    const keys = (e) => { if ((e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || e.key === 'F5' || (e.ctrlKey && /[lrnptw]/i.test(e.key))) e.preventDefault(); };
    const trap = () => history.pushState(null, '', location.href);
    let wake = null; const keepAwake = async () => { try { wake = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
    history.pushState(null, '', location.href);
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, touch, true));
    window.addEventListener('pointerdown', fullscreen, { once: true });
    window.addEventListener('contextmenu', block); window.addEventListener('popstate', trap); window.addEventListener('keydown', keys, true);
    document.addEventListener('gesturestart', block); document.addEventListener('visibilitychange', keepAwake); keepAwake();
    const prev = document.title; document.title = 'MaxVolt Visitor Kiosk';
    const meta = document.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'; document.head.appendChild(meta);
    return () => {
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.removeEventListener(ev, touch, true));
      window.removeEventListener('contextmenu', block); window.removeEventListener('popstate', trap); window.removeEventListener('keydown', keys, true);
      document.removeEventListener('gesturestart', block); document.removeEventListener('visibilitychange', keepAwake);
      document.title = prev; meta.remove(); wake?.release?.().catch(() => {});
    };
  }, []);

  // a server answer of "signed out" anywhere ends the session cleanly
  useEffect(() => {
    if (phase !== 'run') return undefined;
    const orig = window.fetch;
    window.fetch = async (...a) => {
      const res = await orig(...a);
      try { if (String(a[0]).startsWith('/api/kiosk') && res.status === 401 && !String(a[0]).includes('/login')) { const j = await res.clone().json(); if (j.code === 'signed_out') signedOut(j.error); } } catch { /* ignore */ }
      return res;
    };
    return () => { window.fetch = orig; };
  }, [phase, signedOut]);

  const warn = screen !== 'home' && screen !== 'done' && idle >= IDLE_LIMIT - IDLE_WARN;
  const props = { flow, setFlow, go, goHome, kiosk };

  if (phase === 'boot') return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Spinner className="w-12 h-12 text-slate-400" /></div>;
  if (phase === 'login') return <KioskLogin notice={notice} onDone={() => { setNotice(''); setPhase('boot'); boot(); }} />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-200 text-slate-900 select-none overflow-x-hidden" style={{ touchAction: 'manipulation', WebkitUserSelect: 'none' }}>
      {screen === 'home' && <HomeScreen kiosk={kiosk} now={now} go={(s) => { setFlow({}); go(s); }} />}
      {screen === 'invite' && <CodeScreen intent="checkin" {...props} />}
      {screen === 'checkout' && <CodeScreen intent="checkout" {...props} />}
      {screen === 'confirm' && flow.visit && <ConfirmScreen {...props} />}
      {screen === 'confirm_out' && flow.visit && <ConfirmOutScreen {...props} />}
      {screen === 'walkin' && <WalkInScreen {...props} />}
      {screen === 'done' && <DoneScreen {...props} />}
      {warn && (
        <div className="fixed inset-0 bg-slate-900/70 flex items-center justify-center z-50 p-8" onClick={() => { lastTouch.current = Date.now(); }}>
          <div className="bg-white rounded-3xl p-10 max-w-lg text-center space-y-5">
            <Clock className="w-16 h-16 mx-auto text-amber-500" />
            <h2 className="text-3xl font-bold">Are you still there?</h2>
            <p className="text-xl text-slate-600">This screen will clear and return to the start in {Math.max(0, Math.ceil(IDLE_LIMIT - idle))} seconds to protect your information.</p>
            <BigButton tone="dark" className="w-full">I am still here</BigButton>
          </div>
        </div>
      )}
    </div>
  );
}
