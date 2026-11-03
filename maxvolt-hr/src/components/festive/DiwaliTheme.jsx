import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles } from 'lucide-react';

// Temporary Diwali dressing for the home screen: a string of twinkling lights, lamps (diyas), floating lanterns, a greeting
// ribbon and a canvas of rockets, flower-pot fountains and firework bursts. Purely decorative — it never blocks a click
// (pointer-events: none), pauses when the tab is hidden, and shows only still lights for people who prefer reduced motion.
// It switches itself on and off by date: change FESTIVE below (or delete the component from Dashboard.jsx) — nothing else to clean up.
export const FESTIVE = { key: 'diwali-2026', from: '2026-11-01', to: '2026-11-12', greeting: 'Happy Diwali', sub: 'from all of us at Maxvolt Energy — may your year be bright' };
const todayIST = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
export const festiveActive = () => { const d = todayIST(); return d >= FESTIVE.from && d <= FESTIVE.to; };
const OFF_KEY = `festive-off:${FESTIVE.key}`;

const BULB = ['#FFB703', '#FB5607', '#FF006E', '#8338EC', '#3A86FF', '#06D6A0', '#FFD60A'];
const PALETTES = [['#ffd60a', '#ffb703', '#fb8500'], ['#ff4d6d', '#ff758f', '#ffb3c1'], ['#80ed99', '#38b000', '#c7f9cc'], ['#4cc9f0', '#4895ef', '#bde0fe'], ['#f72585', '#b5179e', '#ffd60a'], ['#ffffff', '#ffe66d', '#ffa62b']];

// ── fireworks canvas ─────────────────────────────────────────────────────────────────────────────────────────────────
function useFireworks(ref, enabled) {
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !enabled) return undefined;
    const ctx = canvas.getContext('2d'); let w = 0, h = 0, raf = 0, last = 0, nextLaunch = 0, nextFountain = 0, dead = false;
    const rockets = [], sparks = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { w = window.innerWidth; h = window.innerHeight; canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const MAX_SPARKS = w < 700 ? 320 : 900;
    const rnd = (a, b) => a + Math.random() * (b - a), pick = (a) => a[(Math.random() * a.length) | 0];
    const burst = (x, y, pal, kind) => {
      const n = Math.round((kind === 'ring' ? 46 : kind === 'willow' ? 60 : 70) * (w < 700 ? 0.65 : 1));
      for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
        const a = kind === 'ring' ? (i / n) * Math.PI * 2 : Math.random() * Math.PI * 2;
        const sp = kind === 'ring' ? 3.2 : rnd(1, kind === 'willow' ? 3.2 : 4.6);
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: kind === 'willow' ? rnd(0.006, 0.01) : rnd(0.011, 0.02), c: pick(pal), g: kind === 'willow' ? 0.035 : 0.05, r: rnd(1.2, 2.4) });
      }
    };
    const launch = () => { const x = rnd(w * 0.08, w * 0.92); rockets.push({ x, y: h + 10, vx: rnd(-0.6, 0.6), vy: -rnd(h * 0.011, h * 0.0145), tx: rnd(h * 0.18, h * 0.5), pal: pick(PALETTES), kind: pick(['burst', 'burst', 'ring', 'willow']) }); };
    // flower-pot (anaar) fountain from the bottom edge
    const fountain = () => { const x = pick([rnd(w * 0.05, w * 0.18), rnd(w * 0.82, w * 0.95)]); const t0 = performance.now(); const dur = rnd(1400, 2200); const id = setInterval(() => { if (dead || performance.now() - t0 > dur) { clearInterval(id); return; } for (let i = 0; i < 4 && sparks.length < MAX_SPARKS; i++) sparks.push({ x: x + rnd(-6, 6), y: h - 4, vx: rnd(-1.1, 1.1), vy: -rnd(4, 8), life: 1, decay: rnd(0.012, 0.022), c: pick(['#ffd60a', '#ffb703', '#fff3b0', '#fb8500']), g: 0.12, r: rnd(1, 1.9) }); }, 40); };
    const frame = (t) => {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = t; return; }
      const dt = Math.min(2, (t - last) / 16.7 || 1); last = t;
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'lighter';
      if (t > nextLaunch) { launch(); nextLaunch = t + rnd(900, 2300) * (w < 700 ? 1.4 : 1); }
      if (t > nextFountain) { fountain(); nextFountain = t + rnd(6000, 11000); }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.x += r.vx * dt; r.y += r.vy * dt; r.vy *= 0.985;
        ctx.beginPath(); ctx.arc(r.x, r.y, 2, 0, 6.283); ctx.fillStyle = '#fff3b0'; ctx.fill();
        if (sparks.length < MAX_SPARKS) sparks.push({ x: r.x, y: r.y, vx: rnd(-0.3, 0.3), vy: rnd(0.4, 1.2), life: 0.6, decay: 0.05, c: '#ffb703', g: 0.02, r: 1.2 });
        if (r.y <= r.tx || r.vy > -1.2) { burst(r.x, r.y, r.pal, r.kind); rockets.splice(i, 1); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += s.g * dt; s.vx *= 0.99; s.life -= s.decay * dt;
        if (s.life <= 0 || s.y > h + 20) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fillStyle = s.c; ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => { dead = true; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [ref, enabled]);
}

// ── a diya (clay lamp) with a flickering flame ───────────────────────────────────────────────────────────────────────
const Diya = ({ size = 56, delay = 0, className = '' }) => (
  <svg className={className} width={size} height={size * 0.78} viewBox="0 0 64 50" aria-hidden="true">
    <defs>
      <radialGradient id={`glow${size}${delay}`} cx="50%" cy="40%" r="60%"><stop offset="0%" stopColor="#ffd60a" stopOpacity=".85" /><stop offset="100%" stopColor="#ffd60a" stopOpacity="0" /></radialGradient>
      <linearGradient id={`clay${size}${delay}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e8833a" /><stop offset="100%" stopColor="#9a3412" /></linearGradient>
    </defs>
    <g className="dw-flame" style={{ animationDelay: `${delay}s` }}>
      <ellipse cx="32" cy="14" rx="22" ry="16" fill={`url(#glow${size}${delay})`} />
      <path d="M32 3 C27 11 25 15 28 20 C30 23 34 23 36 20 C39 15 36 10 32 3 Z" fill="#ffb703" /><path d="M32 10 C30 14 30 17 32 19 C34 17 34 14 32 10 Z" fill="#fff3b0" />
    </g>
    <path d="M6 24 C6 24 14 24 20 25 L44 25 C50 24 58 24 58 24 C58 38 48 47 32 47 C16 47 6 38 6 24 Z" fill={`url(#clay${size}${delay})`} />
    <path d="M10 28 C20 31 44 31 54 28" stroke="#fcd9b6" strokeWidth="1.6" fill="none" opacity=".7" /><circle cx="22" cy="37" r="1.6" fill="#fcd9b6" opacity=".7" /><circle cx="32" cy="40" r="1.6" fill="#fcd9b6" opacity=".7" /><circle cx="42" cy="37" r="1.6" fill="#fcd9b6" opacity=".7" />
  </svg>
);

export default function DiwaliTheme() {
  const [off, setOff] = useState(() => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } });
  const reduced = useMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }, []);
  const canvasRef = useRef(null);
  const on = festiveActive() && !off;
  useFireworks(canvasRef, on && !reduced);
  const bulbs = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ i, c: BULB[i % BULB.length], d: (i * 0.23) % 1.6 })), []);
  const lanterns = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ i, left: 6 + i * 14 + (i % 2) * 3, dur: 16 + (i % 4) * 4, delay: i * 2.3, size: 14 + (i % 3) * 5 })), []);

  if (!festiveActive()) return null;
  const turnOff = () => { try { localStorage.setItem(OFF_KEY, '1'); } catch { /* private mode */ } setOff(true); };
  if (off) return (
    <button onClick={() => { try { localStorage.removeItem(OFF_KEY); } catch { /* */ } setOff(false); }} className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-3 left-3 z-40 text-[11px] rounded-full bg-white/90 border border-amber-300 text-amber-800 px-2.5 py-1 shadow hover:bg-amber-50" aria-label="Turn the Diwali theme back on"><Sparkles className="inline w-3 h-3 mr-1" />Diwali theme</button>
  );

  return (
    <>
      <style>{`
        @keyframes dw-twinkle { 0%,100% { opacity: 1; filter: brightness(1.25); } 50% { opacity: .45; filter: brightness(.8); } }
        @keyframes dw-flame { 0%,100% { transform: scale(1) rotate(-1deg); } 25% { transform: scale(1.06,.94) rotate(1.5deg); } 50% { transform: scale(.96,1.05) rotate(-2deg); } 75% { transform: scale(1.04,.97) rotate(1deg); } }
        @keyframes dw-rise { 0% { transform: translateY(0) translateX(0) scale(.9); opacity: 0; } 8% { opacity: .9; } 50% { transform: translateY(-55vh) translateX(14px) scale(1); } 92% { opacity: .8; } 100% { transform: translateY(-112vh) translateX(-10px) scale(1.05); opacity: 0; } }
        @keyframes dw-banner { 0% { transform: translateY(-110%); } 100% { transform: translateY(0); } }
        @keyframes dw-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .dw-flame { transform-origin: 32px 22px; animation: dw-flame 1.3s ease-in-out infinite; }
        .dw-bulb { width: 6px; height: 9px; }
        .dw-bulb.dw-hi { margin-top: 4px; } .dw-bulb.dw-lo { margin-top: 11px; }
        .dw-strand { height: 30px; } .dw-strand svg { height: 30px; }
        @media (min-width: 768px) { .dw-bulb { width: 9px; height: 12px; } .dw-bulb.dw-hi { margin-top: 8px; } .dw-bulb.dw-lo { margin-top: 16px; } .dw-strand, .dw-strand svg { height: 48px; } }
        @media (prefers-reduced-motion: reduce) { .dw-flame, .dw-bulb, .dw-lantern, .dw-banner { animation: none !important; } }
      `}</style>

      {/* fireworks, rockets and fountains */}
      <canvas ref={canvasRef} aria-hidden="true" className="fixed inset-0 z-30 pointer-events-none" />

      {/* string of lights */}
      <div aria-hidden="true" className="dw-strand fixed top-0 left-0 right-0 z-40 pointer-events-none overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <svg width="100%" height="48" viewBox="0 0 1300 48" preserveAspectRatio="none" className="absolute inset-0">
          <path d="M0 6 Q 50 30 100 8 T 200 8 T 300 8 T 400 8 T 500 8 T 600 8 T 700 8 T 800 8 T 900 8 T 1000 8 T 1100 8 T 1200 8 T 1300 8" stroke="#5b3a14" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="absolute inset-x-0 top-0 flex justify-between px-1">
          {bulbs.map(b => (
            <span key={b.i} className={`dw-bulb block rounded-full ${b.i % 2 ? 'dw-lo' : 'dw-hi'}`} style={{ background: b.c, boxShadow: `0 0 8px 2px ${b.c}99`, animation: `dw-twinkle ${1.1 + (b.i % 4) * 0.3}s ease-in-out ${b.d}s infinite` }} />
          ))}
        </div>
      </div>

      {/* greeting ribbon — in the page flow on phones (never on top of content), floating under the lights on larger screens */}
      <div className="relative z-40 flex justify-center pointer-events-none px-2 pt-7 md:fixed md:inset-x-0 md:top-9 md:pt-0">
        <div className="dw-banner pointer-events-auto flex items-center gap-1.5 md:gap-2 rounded-full border border-amber-300/80 bg-gradient-to-r from-amber-50 via-white to-amber-50 px-2.5 py-1 md:px-4 md:py-1.5 shadow-lg shadow-amber-200/60 max-w-full" style={{ animation: 'dw-banner .9s cubic-bezier(.2,.8,.2,1) both' }}>
          <Diya size={26} />
          <div className="leading-tight text-center">
            <div className="text-xs md:text-base font-extrabold tracking-wide whitespace-nowrap bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(90deg,#b45309,#f59e0b,#dc2626,#f59e0b,#b45309)', backgroundSize: '200% 100%', animation: 'dw-shimmer 4s linear infinite' }}>{FESTIVE.greeting} 🪔</div>
            <div className="hidden sm:block text-[10px] text-amber-900/70">{FESTIVE.sub}</div>
          </div>
          <Diya size={26} delay={0.4} className="hidden md:block" />
          <button onClick={turnOff} className="ml-1 rounded-full p-0.5 text-amber-800/60 hover:text-amber-900 hover:bg-amber-100" aria-label="Turn off the Diwali theme" title="Turn off the Diwali theme"><X className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* floating lanterns */}
      {!reduced && (
        <div aria-hidden="true" className="fixed inset-0 z-30 pointer-events-none overflow-hidden">
          {lanterns.map(l => (
            <span key={l.i} className={`dw-lantern absolute bottom-0 rounded-b-xl rounded-t-md ${l.i >= 4 ? 'hidden md:block' : ''}`} style={{ left: `${l.left}%`, width: l.size, height: l.size * 1.25, background: 'radial-gradient(circle at 50% 70%, #ffe29a, #ff9f1c 60%, #d62828)', boxShadow: '0 0 18px 6px rgba(255,170,40,.55)', opacity: 0, animation: `dw-rise ${l.dur}s linear ${l.delay}s infinite` }} />
          ))}
        </div>
      )}

      {/* lamps along the bottom corners */}
      <div aria-hidden="true" className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-30 pointer-events-none flex items-end justify-between px-1 md:px-6 pb-1 scale-[.72] md:scale-100 origin-bottom">
        <div className="flex items-end gap-1 sm:gap-3"><Diya size={44} /><Diya size={58} delay={0.3} /><Diya size={44} delay={0.7} className="hidden sm:block" /></div>
        <div className="flex items-end gap-1 sm:gap-3"><Diya size={44} delay={0.5} className="hidden sm:block" /><Diya size={58} delay={0.9} /><Diya size={44} delay={0.2} /></div>
      </div>
    </>
  );
}
