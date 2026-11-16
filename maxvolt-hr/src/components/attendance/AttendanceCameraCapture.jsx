import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, RotateCcw, SwitchCamera, Check, Loader2 } from 'lucide-react';

const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalonePWA = () =>
  window.navigator?.standalone === true ||
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

// Full-screen selfie camera: mirrored live preview, face guide, big shutter, camera flip, review step.
// The saved JPEG is the true (un-mirrored) frame; only the on-screen preview is mirrored so it behaves like a mirror.
export default function AttendanceCameraCapture({ open, onClose, onCapture, mode = 'in' }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState('user');
  const [shot, setShot] = useState(false);       // a frame has been captured and is being reviewed
  const [flash, setFlash] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  const startCamera = useCallback(async (face) => {
    stopCamera();
    setError('');
    // navigator.mediaDevices is undefined outside a secure context (plain http / some webviews).
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser. Please open this page in Safari (iOS) or Chrome (Android) over a secure (https) connection.');
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: face, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = s;
      const v = videoRef.current;
      if (v) { v.srcObject = s; try { await v.play(); } catch { /* autoplay is retried by the playsInline attribute */ } }
    } catch (e) {
      console.error('Camera error:', e);
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(e.name)) setError('Please enable camera access in your device Settings to take a selfie.');
      else if (['NotFoundError', 'DevicesNotFoundError'].includes(e.name)) setError('No camera found on this device. Please use a device with a camera.');
      else if (['NotReadableError', 'TrackStartError'].includes(e.name)) setError('Your camera is currently in use by another app. Please close other apps using the camera and try again.');
      else setError('Unable to start camera. Please try again or refresh the page.');
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!open) { stopCamera(); setShot(false); setSaving(false); setError(''); return undefined; }
    setShot(false); setFacing('user');
    startCamera('user');
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; stopCamera(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const flip = () => { const next = facing === 'user' ? 'environment' : 'user'; setFacing(next); startCamera(next); };

  const capture = () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    setFlash(true); setTimeout(() => setFlash(false), 180);
    if (navigator.vibrate) navigator.vibrate(30);
    setShot(true);
  };

  const confirm = () => {
    const c = canvasRef.current; if (!c) return;
    setSaving(true);
    c.toBlob((blob) => {
      if (blob && blob.size > 0) {
        onCapture(new File([blob], `attendance-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        setShot(false); setSaving(false); onClose?.();
      } else { setSaving(false); alert('Failed to capture photo. Please try again.'); }
    }, 'image/jpeg', 0.92);
  };

  if (!open) return null;
  const mirror = facing === 'user' ? { transform: 'scaleX(-1)' } : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black md:bg-black/80 md:flex md:items-center md:justify-center" role="dialog" aria-modal="true" aria-label="Take a selfie">
      <div className="relative w-full h-[100dvh] md:h-[min(86vh,760px)] md:w-[min(92vw,520px)] md:rounded-2xl overflow-hidden bg-black text-white flex flex-col">
        {/* top bar */}
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)] pb-3 bg-gradient-to-b from-black/70 to-transparent">
          <button onClick={onClose} aria-label="Close camera" className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center active:scale-95"><X className="w-5 h-5" /></button>
          <div className="px-3 py-1 rounded-full bg-white/15 backdrop-blur text-sm font-medium">{mode === 'out' ? 'Check-out selfie' : 'Check-in selfie'}</div>
          {!error && !shot ? <button onClick={flip} aria-label="Switch camera" className="w-10 h-10 rounded-full bg-white/15 backdrop-blur flex items-center justify-center active:scale-95"><SwitchCamera className="w-5 h-5" /></button> : <div className="w-10 h-10" />}
        </div>

        {/* viewfinder */}
        <div className="relative flex-1 min-h-0">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-sm text-center space-y-3">
                <div className="mx-auto w-14 h-14 rounded-full bg-red-500/20 flex items-center justify-center"><AlertCircle className="w-7 h-7 text-red-400" /></div>
                <p className="font-medium">{error}</p>
                <p className="text-xs text-white/60">
                  {isIOSDevice()
                    ? <>On iPhone: Settings → Privacy &amp; Security → Camera → enable it for Safari.{isStandalonePWA() && ' Then close this app fully (swipe it away from the App Switcher) and reopen it from your Home Screen.'}</>
                    : 'On Android: tap the lock/site-info icon in the address bar (or Settings → Apps → this app/browser → Permissions) and allow Camera.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setReady(true)} style={mirror} className={`absolute inset-0 w-full h-full object-cover ${shot ? 'invisible' : ''}`} />
              <canvas ref={canvasRef} style={mirror} className={`absolute inset-0 w-full h-full object-cover ${shot ? '' : 'invisible'}`} />
              {!ready && !shot && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-white/70" /></div>}
              {/* face guide */}
              {ready && !shot && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                  <div className="w-[62%] max-w-[300px] aspect-[3/4] rounded-[50%] border-2 border-white/80" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.38)' }} />
                  <p className="mt-4 text-sm text-white/90 drop-shadow">Position your face inside the oval</p>
                </div>)}
              {flash && <div className="absolute inset-0 bg-white" />}
            </>
          )}
        </div>

        {/* controls */}
        <div className="relative z-20 bg-black px-6 pt-5 pb-[max(env(safe-area-inset-bottom),22px)] flex items-center justify-center">
          {error ? (
            <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-2.5 rounded-full bg-white/15 text-sm font-medium">Close</button>
              <button onClick={() => startCamera(facing)} className="px-5 py-2.5 rounded-full bg-blue-600 text-sm font-medium flex items-center gap-2"><RotateCcw className="w-4 h-4" />Try again</button>
            </div>
          ) : !shot ? (
            <button onClick={capture} disabled={!ready} aria-label="Take photo" className="w-[76px] h-[76px] rounded-full border-[4px] border-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform">
              <span className="w-[60px] h-[60px] rounded-full bg-white" />
            </button>
          ) : (
            <div className="w-full max-w-xs flex gap-3">
              <button onClick={() => setShot(false)} disabled={saving} className="flex-1 py-3 rounded-full bg-white/15 text-sm font-semibold flex items-center justify-center gap-2 active:scale-95"><RotateCcw className="w-4 h-4" />Retake</button>
              <button onClick={confirm} disabled={saving} className="flex-1 py-3 rounded-full bg-emerald-500 text-sm font-semibold flex items-center justify-center gap-2 active:scale-95">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}Use photo</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
