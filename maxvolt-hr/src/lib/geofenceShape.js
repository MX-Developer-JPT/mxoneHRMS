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
  const b = rectBounds(l);
  return { id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, radius_m: l.geofence_radius, ...(b ? { shape: 'rectangle', bounds: b, rotation: rectRotation(l) } : {}) };
}
