// Road matching. Run: node --test backend/tests/mapMatch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRuns, chunkRun, buildMatchUrl, parseMatch, snapTrip, MM } from '../utils/mapMatch.js';

const T0 = Date.parse('2026-11-25T05:00:00Z');
const M = 111195;
const pt = (i, sec, extra = {}) => ({ lat: 28.6, lng: 77.2 + (i * 20) / (M * Math.cos(28.6 * Math.PI / 180)), t: new Date(T0 + sec * 1000).toISOString(), acc: 8, ...extra });
const trail = (n, step = 5) => Array.from({ length: n }, (_, i) => pt(i, i * step));

test('runs break at flagged gaps and long silences, never inside a normal drive', () => {
  const pts = [...trail(5), pt(5, 25 + 900), pt(6, 25 + 905), { ...pt(7, 25 + 910), g: 1 }];
  const runs = splitRuns(pts);
  assert.deepEqual(runs.map(r => r.length), [5, 2, 1]);
});

test('chunks share one point so the pieces join, and respect the request limit', () => {
  const run = trail(200, 2);
  const ch = chunkRun(run, 90);
  assert.ok(ch.every(c => c.length <= 90));
  assert.equal(ch[0][89].t, ch[1][0].t);
  assert.equal(ch.at(-1).at(-1).t, run.at(-1).t);
  assert.equal(chunkRun(trail(10)).length, 1);
});

test('url: lng,lat order, bounded radiuses, unix timestamps', () => {
  const u = buildMatchUrl('http://osrm.internal:5000/', [pt(0, 0, { acc: 3 }), pt(1, 5, { acc: 200 })]);
  assert.match(u, /^http:\/\/osrm\.internal:5000\/match\/v1\/driving\/77\.2\d+,28\.6\d+;/);
  assert.match(u, /radiuses=20;60/);
  assert.match(u, new RegExp(`timestamps=${Math.floor(T0 / 1000)};${Math.floor(T0 / 1000) + 5}`));
});

const okJson = (pts, conf = 0.9, wobble = 0) => ({ code: 'Ok', matchings: [{ confidence: conf, geometry: { coordinates: pts.map(p => [p.lng, p.lat + wobble]) } }] });

test('parse: confident match is used, low confidence / error / detour is refused', () => {
  const pts = trail(6);
  assert.equal(parseMatch(okJson(pts), pts).length, 6);
  assert.equal(parseMatch(okJson(pts, 0.2), pts), null);
  assert.equal(parseMatch({ code: 'NoMatch' }, pts), null);
  assert.equal(parseMatch(null, pts), null);
  const detour = { code: 'Ok', matchings: [{ confidence: 0.9, geometry: { coordinates: [[77.2, 28.6], [77.2, 28.7], [77.2001, 28.6]] } }] };
  assert.equal(parseMatch(detour, pts), null);
});

test('snapTrip: matched stretches use road geometry, failed ones keep raw GPS, gaps are never bridged', async () => {
  const a = trail(100, 3);                                   // two chunks
  const b = [pt(200, 5000), pt(201, 5005), pt(202, 5010)];   // after a long silence
  let calls = 0;
  const fetchJson = async (url) => {
    calls++;
    if (calls === 3) throw new Error('osrm down');           // the run after the gap fails
    const n = url.split('/driving/')[1].split('?')[0].split(';').length;
    const src = calls === 1 ? a.slice(0, n) : a.slice(89, 89 + n);
    return okJson(src, 0.9, 0.00001);                       // snapped slightly off the raw line
  };
  const r = await snapTrip([...a, ...b], fetchJson, 'http://x');
  assert.equal(r.total, 103);
  assert.equal(r.matched, 100);
  assert.equal(r.pieces.length, 2);                          // the silence is not bridged
  assert.ok(Math.abs(r.pieces[0][0][0] - 28.60001) < 1e-9); // road-snapped coordinates
  assert.equal(r.pieces[0].length, 100);                     // 90 + 10 joined without a duplicate point
  assert.deepEqual(r.pieces[1][0], [b[0].lat, b[0].lng]);    // raw fallback
});

test('snapTrip: a single stray point and an empty trail are harmless', async () => {
  const r = await snapTrip([pt(0, 0)], async () => { throw new Error('no call expected'); }, 'http://x');
  assert.equal(r.pieces.length, 1);
  assert.deepEqual((await snapTrip([], async () => null, 'http://x')).pieces, []);
  assert.ok(MM.MIN_CONFIDENCE > 0);
});

test('gap links: a sensible road estimate is added, absurd or missing ones are not, snapTrip returns them', async () => {
  const { linkGaps, buildRouteUrl } = await import('../utils/mapMatch.js');
  const A = [[28.6, 77.2], [28.6, 77.201]], B = [[28.62, 77.22], [28.62, 77.221]];   // ~2.9 km apart
  assert.match(buildRouteUrl('http://x/', A[1], B[0]), /^http:\/\/x\/route\/v1\/driving\/77\.201000,28\.600000;77\.220000,28\.620000\?/);
  const ok = async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[77.201, 28.6], [77.21, 28.61], [77.22, 28.62]] } }] });
  const l = await linkGaps([A, B], ok, 'http://x');
  assert.equal(l.length, 1); assert.deepEqual(l[0][0], A[1]); assert.deepEqual(l[0].at(-1), B[0]);
  const absurd = async () => ({ code: 'Ok', routes: [{ geometry: { coordinates: [[77.201, 28.6], [79, 30], [77.22, 28.62]] } }] });
  assert.equal((await linkGaps([A, B], absurd, 'http://x')).length, 0);
  assert.equal((await linkGaps([A, B], async () => { throw new Error('down'); }, 'http://x')).length, 0);
  assert.equal((await linkGaps([A, [[28.6001, 77.2011]]], ok, 'http://x')).length, 0);   // gap too small to estimate
  const run1 = trail(5), run2 = trail(5).map((p, i) => ({ ...p, lat: 28.62, lng: 77.22 + i * 1e-4, t: new Date(T0 + (5000 + i * 5) * 1000).toISOString() }));
  const r = await snapTrip([...run1, ...run2], async (u) => u.includes('/route/') ? ok() : { code: 'NoMatch' }, 'http://x');
  assert.equal(r.pieces.length, 2); assert.equal(r.links.length, 1);
});
