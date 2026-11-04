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

// Metres from a point to the fence edge: NEGATIVE inside, 0 on the edge, POSITIVE outside. Works for both shapes.
export function signedDistanceM(loc, lat, lng) {
  const b = rectBounds(loc);
  if (!b) return havM(Number(loc.latitude), Number(loc.longitude), lat, lng) - Number(loc.geofence_radius ?? loc.radius_m);
  const lonM = M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
  const dx = lng < b.west ? (b.west - lng) * lonM : lng > b.east ? (lng - b.east) * lonM : 0;
  const dy = lat < b.south ? (b.south - lat) * M_PER_DEG_LAT : lat > b.north ? (lat - b.north) * M_PER_DEG_LAT : 0;
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return -Math.min((lng - b.west) * lonM, (b.east - lng) * lonM, (lat - b.south) * M_PER_DEG_LAT, (b.north - lat) * M_PER_DEG_LAT);
}

// What clients (JS engine, native services) receive for one office.
export function publicFence(loc) {
  const b = rectBounds(loc);
  const base = { id: loc.id, name: loc.name, latitude: Number(loc.latitude), longitude: Number(loc.longitude), radius_m: Number(loc.geofence_radius) };
  if (!b) return base;
  const { width, height } = rectSizeM(b);
  return { ...base, shape: 'rectangle', bounds: b, inscribed_m: Math.floor(Math.min(width, height) / 2) };
}
