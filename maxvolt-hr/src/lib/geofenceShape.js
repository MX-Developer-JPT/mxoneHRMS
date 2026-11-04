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

// Metres to the fence edge: negative inside, positive outside. `f` may be a stored location or a server fence ({ radius_m, shape, bounds }).
export function signedDistanceM(f, lat, lng) {
  const b = rectBounds(f);
  if (!b) return havM(Number(f.latitude), Number(f.longitude), lat, lng) - Number(f.radius_m ?? f.geofence_radius);
  const lonM = M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);
  const dx = lng < b.west ? (b.west - lng) * lonM : lng > b.east ? (lng - b.east) * lonM : 0;
  const dy = lat < b.south ? (b.south - lat) * M_PER_DEG_LAT : lat > b.north ? (lat - b.north) * M_PER_DEG_LAT : 0;
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return -Math.min((lng - b.west) * lonM, (b.east - lng) * lonM, (lat - b.south) * M_PER_DEG_LAT, (b.north - lat) * M_PER_DEG_LAT);
}

// A stored AppLocation as the map components draw it.
export function fenceOf(l) {
  const b = rectBounds(l);
  return { id: l.id, name: l.name, latitude: l.latitude, longitude: l.longitude, radius_m: l.geofence_radius, ...(b ? { shape: 'rectangle', bounds: b } : {}) };
}
