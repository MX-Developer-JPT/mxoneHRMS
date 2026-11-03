// Field trip GPS processing — simulated trips. Run: node backend/tests/fieldTrip.test.mjs
import assert from 'node:assert/strict';
import { processPoints, tripQuality, havM } from '../utils/fieldTrip.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const M = 111195;                                   // metres per degree of latitude
const O = { lat: 28.6, lng: 77.2 };
const mLng = M * Math.cos(O.lat * Math.PI / 180);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;   // ~N(0,1)
const T0 = Date.parse('2026-11-03T05:00:00Z');
const at = (x, y, sec, accM = 8, sp) => {                 // x east, y north (metres) -> a fix with GPS noise
  const nz = accM / 2;
  return { lat: O.lat + (y + gauss() * nz) / M, lng: O.lng + (x + gauss() * nz) / mLng, t: new Date(T0 + sec * 1000).toISOString(), acc: accM, ...(sp != null ? { sp } : {}) };
};
const trip = () => ({ id: 'x', status: 'active', points: [], distance_km: 0, point_count: 0 });
const run = (fixes, base = trip()) => processPoints(base, fixes, T0 + 24 * 3600 * 1000).trip;
// route = list of [x,y] corners; drive at v m/s, a fix every `every` seconds
function drive(corners, v, every, accM = 8, startSec = 0) {
  const out = []; let sec = startSec, truth = 0;
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1], [x1, y1] = corners[i]; const len = Math.hypot(x1 - x0, y1 - y0); truth += len;
    for (let d = i === 1 ? 0 : every * v; d < len; d += every * v) { const f = d / len; out.push(at(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, sec, accM, v)); sec += every; }
  }
  return { fixes: out, truthKm: truth / 1000, endSec: sec };
}
const err = (km, truth) => Math.abs(km - truth) / truth;

t('a 10 km drive at ~40 km/h with GPS noise is measured within 3%', () => {
  const { fixes, truthKm } = drive([[0, 0], [10000, 0]], 11, 5);
  const r = run(fixes); assert.ok(err(r.distance_km, truthKm) < 0.03, `${r.distance_km} vs ${truthKm}`);
});

t('a winding city route (many right-angle turns) is not under-measured by cutting corners', () => {
  const corners = []; let x = 0, y = 0; corners.push([x, y]);
  for (let i = 0; i < 24; i++) { if (i % 2 === 0) x += 220; else y += 160; corners.push([x, y]); }
  const { fixes, truthKm } = drive(corners, 6, 3, 10);
  const r = run(fixes); assert.ok(err(r.distance_km, truthKm) < 0.05, `${r.distance_km} vs ${truthKm}`);
});

t('parked at a client site for 40 minutes with GPS wander adds no distance', () => {
  const fixes = []; for (let s = 0; s < 2400; s += 5) fixes.push(at(gauss() * 18, gauss() * 18, s, 25, 0.1));
  const r = run(fixes); assert.ok(r.distance_km < 0.08, `parked trip recorded ${r.distance_km} km`);
});

t('stop-and-go: drive, park 15 min, drive on — only the driving counts', () => {
  const a = drive([[0, 0], [3000, 0]], 10, 4); const park = []; for (let s = a.endSec; s < a.endSec + 900; s += 5) park.push(at(3000 + gauss() * 12, gauss() * 12, s, 20, 0.2));
  const b = drive([[3000, 0], [3000, 2000]], 10, 4, 8, a.endSec + 900);
  const r = run([...a.fixes, ...park, ...b.fixes]); assert.ok(err(r.distance_km, 5) < 0.04, `${r.distance_km} vs 5`);
});

t('weak fixes (>50 m) are ignored without distorting the distance', () => {
  const { fixes, truthKm } = drive([[0, 0], [6000, 0]], 12, 4);
  const mixed = fixes.flatMap((f, i) => (i % 4 === 2 ? [f, { ...at(3000 * Math.sin(i), 3000 * Math.cos(i), 0, 140), t: f.t }] : [f]));
  const r = run(mixed.map((f, i) => ({ ...f, t: new Date(T0 + i * 1000 + 4000).toISOString() })));
  assert.ok(r.stats.rej_accuracy > 0); assert.ok(r.distance_km < truthKm * 1.15, `${r.distance_km} vs ${truthKm}`);
});

t('a GPS teleport (hundreds of km in seconds) is thrown away', () => {
  const { fixes } = drive([[0, 0], [2000, 0]], 10, 4);
  const jump = { lat: O.lat + 3, lng: O.lng + 3, t: new Date(T0 + 99 * 1000).toISOString(), acc: 10 };
  const mixed = [...fixes.slice(0, 20), jump, ...fixes.slice(20)];
  const r = run(mixed.map((f, i) => ({ ...f, t: new Date(T0 + i * 4000).toISOString() })));
  assert.equal(r.stats.rej_jump, 1); assert.ok(r.distance_km < 2.4, String(r.distance_km));
});

t('a signal gap is bridged by a straight line but flagged and reported', () => {
  const a = drive([[0, 0], [2000, 0]], 10, 4); const b = drive([[3500, 0], [5000, 0]], 10, 4, 8, a.endSec + 150);
  const r = run([...a.fixes, ...b.fixes]);
  assert.equal(r.stats.gap_count, 1); assert.ok(Math.abs(r.stats.gap_km - 1.5) < 0.1, String(r.stats.gap_km));
  assert.ok(r.points.some(p => p.g === 1)); assert.ok(err(r.distance_km, 5) < 0.04);
  assert.notEqual(tripQuality(r).level, 'good', 'a trip with a long gap is not labelled good');
});

t('a retried upload does not count twice, and uploads in two batches equal one', () => {
  const { fixes } = drive([[0, 0], [4000, 0]], 10, 4);
  const once = run(fixes); const twice = run(fixes, once); assert.equal(twice.distance_km, once.distance_km);
  const h = Math.floor(fixes.length / 2); const split = run(fixes.slice(h), run(fixes.slice(0, h)));
  assert.ok(Math.abs(split.distance_km - once.distance_km) < 0.02, `${split.distance_km} vs ${once.distance_km}`);
});

t('the first fix may be a rough one (cold start) so the trip start is kept', () => {
  const r = run([{ ...at(0, 0, 0, 90) }, ...drive([[40, 0], [1500, 0]], 10, 4, 8, 6).fixes]);
  assert.equal(r.points[0].acc, 90); assert.ok(r.distance_km > 1.4);
});

t('heartbeats keep the live position fresh without touching the trail or distance', () => {
  const base = run(drive([[0, 0], [500, 0]], 10, 4).fixes);
  const r = processPoints(base, [{ ...at(500, 5, 400, 10), hb: true }], T0 + 3600000).trip;
  assert.equal(r.points.length, base.points.length); assert.equal(r.distance_km, base.distance_km);
  assert.ok(Math.abs(havM(r.last_pos, { lat: O.lat + 5 / M, lng: O.lng + 500 / mLng })) < 25);
});

t('garbage input is ignored; future-dated fixes are ignored', () => {
  const r = processPoints(trip(), [{ lat: 'x', lng: 1 }, { lat: 95, lng: 1 }, { lat: 28, lng: 77, t: '2099-01-01T00:00:00Z', acc: 5 }, null, {}], T0);
  assert.equal(r.trip.points.length, 0); assert.equal(r.trip.distance_km, 0);
});

t('quality labels: good drive, weak trip, no data, legacy trip', () => {
  const good = run(drive([[0, 0], [5000, 0]], 10, 4).fixes); assert.equal(tripQuality(good).level, 'good');
  assert.equal(tripQuality(trip()).level, 'none');
  assert.equal(tripQuality({ points: [{}, {}, {}], distance_km: 3 }).level, 'legacy');
  const weak = { points: [{}, {}, {}, {}], distance_km: 10, stats: { accepted: 4, rej_accuracy: 20, rej_jump: 0, rej_still: 0, gap_count: 2, gap_km: 4 } };
  assert.equal(tripQuality(weak).level, 'poor');
});

console.log(`\n${n} field trip checks passed`);
