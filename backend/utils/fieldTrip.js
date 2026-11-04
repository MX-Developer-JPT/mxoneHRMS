// Field trip GPS processing — the authoritative place where recorded fixes become a trail and a distance.
// Pure functions (no DB / no Express) so the rules can be tested with simulated trips.
//
// Goals, in order: (1) never invent distance (parked GPS wander, jumps, bad fixes), (2) never lose real distance
// (corners, slow city driving, short signal gaps), (3) be honest about what is estimated (signal gaps are flagged).
export const FT = {
  MAX_ACC_M: 50,          // a fix less accurate than this never extends the trail
  FIRST_MAX_ACC_M: 100,   // the very first fix may be a little rougher so the trip start is not lost
  MAX_KMH: 150,           // faster than this between two fixes = GPS jump
  GAP_SECONDS: 120,       // no accepted fix for this long = signal gap
  GAP_MIN_M: 150,         // …and it moved at least this far across the gap
  MIN_MOVE_M: 12,         // floor for "has really moved"
  STILL_MS: 0.6,          // reported speed under this (m/s) = standing still
  TURN_DEG: 30,           // a heading change this big keeps shorter hops so corners are not cut
  TURN_MIN_M: 8,
  MAX_POINTS: 6000,
};

export function havM(a, b) {
  const R = 6371000, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function bearing(a, b) {
  const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const turnDeg = (b1, b2) => Math.abs(((b2 - b1 + 540) % 360) - 180);

const emptyStats = () => ({ accepted: 0, rej_accuracy: 0, rej_jump: 0, rej_still: 0, gap_count: 0, gap_km: 0 });

// ft: stored trip; incoming: [{ lat, lng, t, acc, sp?, hb? }]. Returns { trip, addedKm }.
export function processPoints(ft, incoming, nowMs = Date.now()) {
  const points = [...(ft.points || [])];
  const st = { ...emptyStats(), ...(ft.stats || {}) };
  let livePos = ft.last_pos || null;
  let last = points[points.length - 1] || null;
  let prev = points[points.length - 2] || null;
  let addedM = 0;

  const sorted = [...(incoming || [])].sort((a, b) => new Date(a?.t || 0) - new Date(b?.t || 0));
  for (const pt of sorted) {
    const lat = Number(pt?.lat), lng = Number(pt?.lng), acc = Number(pt?.acc || 0);
    const t = pt?.t ? new Date(pt.t) : new Date(nowMs);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || isNaN(t.getTime())) continue;
    if (t.getTime() > nowMs + 5 * 60000) continue;                      // a clock running in the future
    const tIso = t.toISOString();

    // live position: newest usable fix, even if it adds no distance (parked at a client site)
    if (acc <= 200 && (!livePos || t >= new Date(livePos.t))) livePos = { lat, lng, acc, t: tIso };
    if (pt.hb) continue;                                                // heartbeat: liveness only

    const q = { lat, lng, t: tIso, acc };
    if (last && t <= new Date(last.t)) continue;                        // retried upload / out of order
    if (acc > (last ? FT.MAX_ACC_M : FT.FIRST_MAX_ACC_M)) { st.rej_accuracy++; continue; }

    if (last) {
      const d = havM(last, q);
      const dt = Math.max((t - new Date(last.t)) / 1000, 1);
      if (d / dt * 3.6 > FT.MAX_KMH) { st.rej_jump++; continue; }
      const sp = Number(pt.sp);
      const standing = Number.isFinite(sp) && sp >= 0 && sp < FT.STILL_MS;
      if (standing && d < Math.max(30, 3 * acc) + (sp * dt)) { st.rej_still++; continue; }
      // A hop smaller than the combined GPS uncertainty cannot be told apart from noise; it is kept as pending until the phone has really moved on.
      const minMove = Math.max(FT.MIN_MOVE_M, 1.5 * (last.acc + acc) / 2);
      const isTurn = !!prev && d >= FT.TURN_MIN_M && turnDeg(bearing(prev, last), bearing(last, q)) >= FT.TURN_DEG && !standing;
      if (d < minMove && !isTurn) { st.rej_still++; continue; }
      if (dt > FT.GAP_SECONDS && d > FT.GAP_MIN_M) { q.g = 1; st.gap_count++; st.gap_km += d / 1000; }
      addedM += d;
    }
    points.push(q); prev = last; last = q; st.accepted++;
  }

  let all = points;
  if (all.length > FT.MAX_POINTS) all = all.filter((_, i) => i % 2 === 0 || i >= all.length - 2000);   // thin only the older part
  st.gap_km = Math.round(st.gap_km * 100) / 100;
  return {
    addedKm: addedM / 1000,
    trip: {
      ...ft, points: all, last_pos: livePos, stats: st,
      point_count: (ft.point_count || 0) + (st.accepted - (ft.stats?.accepted || 0)),
      distance_km: Math.round(((ft.distance_km || 0) + addedM / 1000) * 100) / 100,
      last_point_at: new Date(nowMs).toISOString(),
    },
  };
}

// Trips recorded before the accuracy checks have no stats: work the gaps out from the stored points.
function legacyQuality(ft) {
  const pts = [...(ft.points || [])].sort((a, b) => new Date(a.t) - new Date(b.t));
  let gapKm = 0, gaps = 0, totalKm = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = havM(pts[i - 1], pts[i]) / 1000; totalKm += d;
    if ((new Date(pts[i].t) - new Date(pts[i - 1].t)) / 1000 > FT.GAP_SECONDS && d * 1000 > FT.GAP_MIN_M) { gaps++; gapKm += d; }
  }
  gapKm = Math.round(gapKm * 100) / 100;
  const share = totalKm > 0 ? gapKm / totalKm : 0;
  const level = pts.length < 5 || share > 0.2 ? 'poor' : share > 0.05 ? 'fair' : 'good';
  return { label: { good: 'GPS good', fair: 'GPS fair', poor: 'GPS weak' }[level], level, gap_km: gapKm, gap_count: gaps, weak_fix_pct: 0, legacy: true };
}

// A plain-language reliability label for a recorded trip, shown to managers next to the distance.
export function tripQuality(ft) {
  const st = ft.stats;
  const n = (ft.points || []).length;
  if (!n) return { label: 'No GPS data', level: 'none', gap_km: 0, gap_count: 0 };
  if (!st) return legacyQuality(ft);
  const dist = Math.max(ft.distance_km || 0, 0.001);
  const gapShare = st.gap_km / dist;
  const seen = st.accepted + st.rej_accuracy;
  const badFix = seen ? st.rej_accuracy / seen : 0;
  let level = 'good';
  if (gapShare > 0.2 || badFix > 0.6 || n < 3) level = 'poor';
  else if (gapShare > 0.05 || badFix > 0.3) level = 'fair';
  const label = { good: 'GPS good', fair: 'GPS fair', poor: 'GPS weak' }[level];
  return { label, level, gap_km: st.gap_km, gap_count: st.gap_count, weak_fix_pct: Math.round(badFix * 100) };
}
