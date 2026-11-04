// Office geofence shapes. An AppLocation is either a circle (latitude / longitude / geofence_radius — the original model)
// or a RECTANGLE drawn on the map (geofence_shape: 'rectangle', geofence_bounds: { north, south, east, west }).
//
// For a rectangle, latitude / longitude / geofence_radius still hold the rectangle's CENTRE and its circumscribed circle
// (half-diagonal). Everything that only needs a coarse "is the phone anywhere near this office" check — the OS wake-up
// circles, the server's plausibility window — therefore keeps working unchanged, while the real inside/outside decision
// (check-in on entering, check-out on leaving) uses the exact rectangle through signedDistanceM().
const M_PER_DEG_LAT = 111195;

export function rectBounds(loc) {
  if (!loc || loc.geofence_shape !== 'rectangle') return null;
  const b = loc.geofence_bounds || loc.bounds;
  if (!b) return null;
  const n = Number(b.north), s = Number(b.south), e = Number(b.east), w = Number(b.west);
  if (![n, s, e, w].every(Number.isFinite) || n <= s || e <= w) return null;
  if (Math.abs(n) > 90 || Math.abs(s) > 90 || Math.abs(e) > 180 || Math.abs(w) > 180) return null;
  return { north: n, south: s, east: e, west: w };
}

export function havM(la1, lo1, la2, lo2) {
  const R = 6371000, a1 = la1 * Math.PI / 180, a2 = la2 * Math.PI / 180, dLa = a2 - a1, dLo = (lo2 - lo1) * Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLo / 2) ** 2));
}

// Side lengths in metres (east-west at the middle latitude, north-south).
export function rectSizeM(b) {
  const midLat = (b.north + b.south) / 2;
  return { width: (b.east - b.west) * M_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180), height: (b.north - b.south) * M_PER_DEG_LAT };
}

// The circle fields stored next to a rectangle.
export function circleFieldsForRect(b) {
  const { width, height } = rectSizeM(b);
  return {
    latitude: Math.round(((b.north + b.south) / 2) * 1e6) / 1e6,
    longitude: Math.round(((b.east + b.west) / 2) * 1e6) / 1e6,
    geofence_radius: Math.ceil(Math.hypot(width, height) / 2),
  };
}

// A free-form outline: 3-20 corners [lat, lng], each placed independently (shape 'polygon', geofence_vertices).
export function polyVertices(loc) {
  if (loc?.geofence_shape !== 'polygon' && loc?.shape !== 'polygon') return null;
  const v = loc.geofence_vertices || loc.vertices;
  if (!Array.isArray(v) || v.length < 3 || v.length > 20) return null;
  const out = v.map(p => [Number(p?.[0]), Number(p?.[1])]);
  if (out.some(([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180)) return null;
  return out;
}

// Signed distance (metres, negative inside) from a point to a polygon, in a local flat frame centred on the point.
function polyDistanceM(verts, lat, lng) {
  const lonM = M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
  const pts = verts.map(([a, b]) => [(b - lng) * lonM, (a - lat) * M_PER_DEG_LAT]);
  let inside = false, minD = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > 0) !== (yj > 0) && (xj - xi) * (0 - yi) / (yj - yi) + xi > 0) inside = !inside;
    const dx = xj - xi, dy = yj - yi, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(xi * dx + yi * dy) / len2)) : 0;
    minD = Math.min(minD, Math.hypot(xi + t * dx, yi + t * dy));
  }
  return inside ? -minD : minD;
}

// Centre + circumscribed circle saved next to a polygon (same role as for a rectangle).
export function circleFieldsForPoly(verts) {
  const lats = verts.map(v => v[0]), lngs = verts.map(v => v[1]);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2, cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const radius = Math.max(...verts.map(([a, b]) => havM(cLat, cLng, a, b)));
  return { latitude: Math.round(cLat * 1e6) / 1e6, longitude: Math.round(cLng * 1e6) / 1e6, geofence_radius: Math.ceil(radius) };
}

// Polygon area in square metres (shoelace, flat approximation) — used to reject degenerate outlines.
export function polyAreaM2(verts) {
  const lat0 = verts[0][0], lonM = M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);
  const p = verts.map(([a, b]) => [(b - verts[0][1]) * lonM, (a - lat0) * M_PER_DEG_LAT]);
  let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return Math.abs(s) / 2;
}

// A rectangle may be turned (geofence_rotation, degrees clockwise from north, about its centre) to follow a road or a
// building line. bounds always describe the UNTURNED box around the centre.
export function rectRotation(loc) {
  const r = Number(loc?.geofence_rotation ?? loc?.rotation);
  return Number.isFinite(r) ? ((((r + 90) % 180) + 180) % 180) - 90 : 0;
}

function rectFrame(loc) {
  const b = rectBounds(loc);
  if (!b) return null;
  const cLat = (b.north + b.south) / 2, cLng = (b.east + b.west) / 2, lonM = M_PER_DEG_LAT * Math.cos(cLat * Math.PI / 180);
  const rot = rectRotation(loc) * Math.PI / 180;
  return { cLat, cLng, lonM, hw: (b.east - b.west) / 2 * lonM, hh: (b.north - b.south) / 2 * M_PER_DEG_LAT, cos: Math.cos(rot), sin: Math.sin(rot) };
}

// The four corners of the (possibly turned) rectangle as [lat, lng].
export function rectCorners(loc) {
  const g = rectFrame(loc);
  if (!g) return null;
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const x0 = sx * g.hw, y0 = sy * g.hh;
    return [g.cLat + (-x0 * g.sin + y0 * g.cos) / M_PER_DEG_LAT, g.cLng + (x0 * g.cos + y0 * g.sin) / g.lonM];
  });
}

// Metres from a point to the fence edge: NEGATIVE inside, 0 on the edge, POSITIVE outside. Works for circles, rectangles and turned rectangles.
export function signedDistanceM(loc, lat, lng) {
  const pv = polyVertices(loc);
  if (pv) return polyDistanceM(pv, lat, lng);
  const g = rectFrame(loc);
  if (!g) return havM(Number(loc.latitude), Number(loc.longitude), lat, lng) - Number(loc.geofence_radius ?? loc.radius_m);
  const x = (lng - g.cLng) * g.lonM, y = (lat - g.cLat) * M_PER_DEG_LAT;
  const x0 = x * g.cos - y * g.sin, y0 = x * g.sin + y * g.cos;     // the point in the rectangle's own frame
  const dx = Math.abs(x0) - g.hw, dy = Math.abs(y0) - g.hh;
  if (dx > 0 || dy > 0) return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.max(dx, dy);
}

// What clients (JS engine, native services) receive for one office.
export function publicFence(loc) {
  const b = rectBounds(loc);
  const base = { id: loc.id, name: loc.name, latitude: Number(loc.latitude), longitude: Number(loc.longitude), radius_m: Number(loc.geofence_radius) };
  const pv = polyVertices(loc);
  if (pv) return { ...base, shape: 'polygon', vertices: pv, inscribed_m: Math.max(30, Math.floor(-polyDistanceM(pv, base.latitude, base.longitude))) };
  if (!b) return base;
  const { width, height } = rectSizeM(b);
  return { ...base, shape: 'rectangle', bounds: b, rotation: rectRotation(loc), inscribed_m: Math.floor(Math.min(width, height) / 2) };
}

// True when the office is drawn on the map (rectangle or free-form outline) rather than a plain circle.
export function isShaped(loc) { return !!(rectBounds(loc) || polyVertices(loc)); }
