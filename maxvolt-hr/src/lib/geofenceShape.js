// Office geofence shapes (mirror of backend/utils/geofenceShape.js — keep the two in step).
// A location is a circle (latitude / longitude / geofence_radius) or a rectangle drawn on the map
// (geofence_shape: 'rectangle', geofence_bounds: { north, south, east, west }). For a rectangle the circle fields hold its
// centre and circumscribed circle, so anything coarse keeps working; the exact test is signedDistanceM().
const M_PER_DEG_LAT = 111195;

export function rectBounds(f) {
  const shape = f?.geofence_shape || f?.shape;
  if (shape !== 'rectangle') return null;
  const b = f.geofence_bounds || f.bounds;
  if (!b) return null;
  const n = Number(b.north), s = Number(b.south), e = Number(b.east), w = Number(b.west);
  if (![n, s, e, w].every(Number.isFinite) || n <= s || e <= w) return null;
  return { north: n, south: s, east: e, west: w };
}

export function havM(la1, lo1, la2, lo2) {
  const R = 6371000, a1 = la1 * Math.PI / 180, a2 = la2 * Math.PI / 180, dLa = a2 - a1, dLo = (lo2 - lo1) * Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLo / 2) ** 2));
}

export function rectSizeM(b) {
  const midLat = (b.north + b.south) / 2;
  return { width: (b.east - b.west) * M_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180), height: (b.north - b.south) * M_PER_DEG_LAT };
}

// Centre + circumscribed circle saved next to a rectangle.
export function circleFieldsForRect(b) {
  const { width, height } = rectSizeM(b);
  return {
    latitude: Math.round(((b.north + b.south) / 2) * 1e6) / 1e6,
    longitude: Math.round(((b.east + b.west) / 2) * 1e6) / 1e6,
    geofence_radius: Math.ceil(Math.hypot(width, height) / 2),
  };
}

// A free-form outline: 3-20 corners [lat, lng], each placed independently (shape 'polygon', geofence_vertices).
export function polyVertices(f) {
  if (f?.geofence_shape !== 'polygon' && f?.shape !== 'polygon') return null;
  const v = f.geofence_vertices || f.vertices;
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
export function rectRotation(f) {
  const r = Number(f?.geofence_rotation ?? f?.rotation);
  return Number.isFinite(r) ? ((((r + 90) % 180) + 180) % 180) - 90 : 0;
}

function rectFrame(f) {
  const b = rectBounds(f);
  if (!b) return null;
  const cLat = (b.north + b.south) / 2, cLng = (b.east + b.west) / 2, lonM = M_PER_DEG_LAT * Math.cos(cLat * Math.PI / 180);
  const rot = rectRotation(f) * Math.PI / 180;
  return { cLat, cLng, lonM, hw: (b.east - b.west) / 2 * lonM, hh: (b.north - b.south) / 2 * M_PER_DEG_LAT, cos: Math.cos(rot), sin: Math.sin(rot) };
}

// The four corners of the (possibly turned) rectangle as [lat, lng].
export function rectCorners(f) {
  const g = rectFrame(f);
  if (!g) return null;
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const x0 = sx * g.hw, y0 = sy * g.hh;
    return [g.cLat + (-x0 * g.sin + y0 * g.cos) / M_PER_DEG_LAT, g.cLng + (x0 * g.cos + y0 * g.sin) / g.lonM];
  });
}

// Metres from a point to the fence edge: NEGATIVE inside, 0 on the edge, POSITIVE outside. Works for circles, rectangles and turned rectangles.
export function signedDistanceM(f, lat, lng) {
  const pv = polyVertices(f);
  if (pv) return polyDistanceM(pv, lat, lng);
  const g = rectFrame(f);
  if (!g) return havM(Number(f.latitude), Number(f.longitude), lat, lng) - Number(f.geofence_radius ?? f.radius_m);
  const x = (lng - g.cLng) * g.lonM, y = (lat - g.cLat) * M_PER_DEG_LAT;
  const x0 = x * g.cos - y * g.sin, y0 = x * g.sin + y * g.cos;     // the point in the rectangle's own frame
  const dx = Math.abs(x0) - g.hw, dy = Math.abs(y0) - g.hh;
  if (dx > 0 || dy > 0) return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.max(dx, dy);
}

// A stored AppLocation as the map components draw it.
export function fenceOf(l) {
  const b = rectBounds(l), pv = polyVertices(l);
  return { id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, radius_m: l.geofence_radius, ...(pv ? { shape: 'polygon', vertices: pv } : b ? { shape: 'rectangle', bounds: b, rotation: rectRotation(l) } : {}) };
}

// The outline of any drawn fence as [lat, lng] corners (rectangle, turned rectangle or free-form), else null.
export function outlineOf(f) { return polyVertices(f) || rectCorners(f); }
