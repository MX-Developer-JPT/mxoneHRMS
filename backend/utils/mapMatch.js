// Road matching ("snap to roads") for Field Duty routes, against a self-hosted OSRM (OpenStreetMap data) service.
// DISPLAY ONLY: distance is always computed from the filtered raw points (utils/fieldTracking.js), never from the snapped line.
// Pure except for the injected `fetchJson`, so the whole flow is unit-tested without a network.
import { havM } from './fieldTrip.js';

export const MM = {
  MAX_PER_REQ: 90,       // OSRM allows 100 coordinates per match request by default
  BREAK_S: 300,          // a silence longer than this is never bridged by a road line (it is a tracking gap)
  MIN_CONFIDENCE: 0.45,  // OSRM's own confidence for a matching; lower = keep the raw GPS line for that stretch
  MAX_DETOUR: 1.6,       // a snapped stretch longer than this x the raw stretch (+ slack) is a wrong detour -> raw
  DETOUR_SLACK_M: 250,
};

// Break the trail into runs that may be matched as one piece: at flagged gaps and at long silences.
export function splitRuns(points, breakS = MM.BREAK_S) {
  const runs = []; let cur = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const dt = (Date.parse(p.t) - Date.parse(prev.t)) / 1000;
      if (p.g || !(dt > 0) || dt > breakS) { runs.push(cur); cur = []; }
    }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

// A run longer than one request allows is cut into chunks that share one point so the pieces join up.
export function chunkRun(run, max = MM.MAX_PER_REQ) {
  if (run.length <= max) return [run];
  const out = []; let i = 0;
  while (i < run.length - 1) { out.push(run.slice(i, i + max)); i += max - 1; }
  return out;
}

export function buildMatchUrl(base, pts) {
  const coords = pts.map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
  const radiuses = pts.map(p => Math.min(60, Math.max(20, Math.round((Number(p.acc) || 10) * 2)))).join(';');
  const times = pts.map(p => Math.floor(Date.parse(p.t) / 1000)).join(';');
  return `${String(base).replace(/\/+$/, '')}/match/v1/driving/${coords}?overview=full&geometries=geojson&steps=false&annotations=false&gaps=ignore&tidy=false&radiuses=${radiuses}&timestamps=${times}`;
}

const lineLenM = (line) => { let m = 0; for (let i = 1; i < line.length; i++) m += havM({ lat: line[i - 1][0], lng: line[i - 1][1] }, { lat: line[i][0], lng: line[i][1] }); return m; };
const rawLenM = (pts) => { let m = 0; for (let i = 1; i < pts.length; i++) m += havM(pts[i - 1], pts[i]); return m; };

// OSRM answer -> one [lat,lng] line for these points, or null when it cannot be trusted.
export function parseMatch(json, rawPts, cfg = MM) {
  if (!json || json.code !== 'Ok' || !Array.isArray(json.matchings) || !json.matchings.length) return null;
  const line = [];
  for (const m of json.matchings) {
    if (!(Number(m.confidence) >= cfg.MIN_CONFIDENCE)) return null;
    for (const c of (m.geometry?.coordinates || [])) {
      const ll = [c[1], c[0]];
      const last = line[line.length - 1];
      if (!last || last[0] !== ll[0] || last[1] !== ll[1]) line.push(ll);
    }
  }
  if (line.length < 2) return null;
  if (lineLenM(line) > cfg.MAX_DETOUR * rawLenM(rawPts) + cfg.DETOUR_SLACK_M) return null;   // a detour no phone drove
  return line;
}

// Where tracking was lost the phone kept moving: estimate the likely road path across each gap (driving route between the last
// fix before and the first fix after). Drawn dashed as an ESTIMATE, never counted as distance.
export function buildRouteUrl(base, a, b) {
  return `${String(base).replace(/\/+$/, '')}/route/v1/driving/${Number(a[1]).toFixed(6)},${Number(a[0]).toFixed(6)};${Number(b[1]).toFixed(6)},${Number(b[0]).toFixed(6)}?overview=full&geometries=geojson&steps=false`;
}
export async function linkGaps(pieces, fetchJson, base, cfg = MM) {
  const links = [];
  for (let i = 1; i < pieces.length && links.length < 20; i++) {
    const a = pieces[i - 1][pieces[i - 1].length - 1], b = pieces[i][0];
    if (!a || !b) continue;
    const straight = havM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    if (straight < 150 || straight > 60000) continue;
    try {
      const j = await fetchJson(buildRouteUrl(base, a, b));
      const coords = j?.code === 'Ok' ? j.routes?.[0]?.geometry?.coordinates : null;
      if (!coords || coords.length < 2) continue;
      const line = [a, ...coords.map(c => [c[1], c[0]]), b];
      if (lineLenM(line) <= 2.2 * straight + 500) links.push(line);   // a route far longer than the crow-flies gap is a wrong guess
    } catch { /* no estimate for this gap */ }
  }
  return links;
}

// Snap a whole trail. Returns { pieces: [[ [lat,lng], ... ], ...], matched, total }:
// each piece is one continuous polyline (road-snapped where OSRM was confident, the raw GPS otherwise).
export async function snapTrip(points, fetchJson, base, cfg = MM) {
  const clean = (points || []).filter(p => Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)) && Number.isFinite(Date.parse(p.t)));
  const pieces = []; let matched = 0, total = 0;
  for (const run of splitRuns(clean, cfg.BREAK_S)) {
    total += run.length;
    if (run.length < 2) { if (run.length === 1) pieces.push([[Number(run[0].lat), Number(run[0].lng)]]); continue; }
    let piece = [], runMatched = 0;
    for (const chunk of chunkRun(run, cfg.MAX_PER_REQ)) {
      let line = null;
      try { line = parseMatch(await fetchJson(buildMatchUrl(base, chunk)), chunk, cfg); } catch { line = null; }
      if (line) runMatched += chunk.length;
      const use = line || chunk.map(p => [Number(p.lat), Number(p.lng)]);
      const last = piece[piece.length - 1];
      piece.push(...(last && use[0] && last[0] === use[0][0] && last[1] === use[0][1] ? use.slice(1) : use));
    }
    matched += Math.min(runMatched, run.length);   // chunks share a joint point
    pieces.push(piece);
  }
  return { pieces, matched, total, links: await linkGaps(pieces, fetchJson, base, cfg) };
}
