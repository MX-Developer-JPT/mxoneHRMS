// Rectangle geofences. Run: node backend/tests/geofenceShape.test.mjs
import assert from 'node:assert/strict';
import { rectBounds, circleFieldsForRect, signedDistanceM, publicFence, rectSizeM, rectCorners, rectRotation, polyVertices, circleFieldsForPoly, polyAreaM2, isShaped } from '../utils/geofenceShape.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ', name); };

const M = 111195, lat0 = 28.6, lng0 = 77.2, mLng = M * Math.cos(lat0 * Math.PI / 180);
// a 200 m (east-west) x 100 m (north-south) office
const b = { north: lat0 + 50 / M, south: lat0 - 50 / M, east: lng0 + 100 / mLng, west: lng0 - 100 / mLng };
const office = { id: 'o1', name: 'Office', is_active: true, geofence_shape: 'rectangle', geofence_bounds: b, ...circleFieldsForRect(b) };
const at = (x, y) => [lat0 + y / M, lng0 + x / mLng];   // x east, y north, metres from the centre

t('size and the circle stored beside a rectangle', () => {
  const s = rectSizeM(b); assert.ok(Math.abs(s.width - 200) < 1 && Math.abs(s.height - 100) < 1);
  assert.ok(Math.abs(office.geofence_radius - 112) <= 1, String(office.geofence_radius));            // half-diagonal sqrt(100^2+50^2)
  assert.ok(Math.abs(office.latitude - lat0) < 1e-5 && Math.abs(office.longitude - lng0) < 1e-5);
});
t('inside is negative, outside positive, the edge is zero', () => {
  assert.ok(signedDistanceM(office, ...at(0, 0)) < 0); assert.ok(Math.abs(signedDistanceM(office, ...at(0, 0)) + 50) < 1);   // 50 m from the nearest (north/south) edge
  assert.ok(Math.abs(signedDistanceM(office, ...at(100, 0))) < 1);
  assert.ok(Math.abs(signedDistanceM(office, ...at(130, 0)) - 30) < 1);                              // 30 m east of the east edge
  assert.ok(Math.abs(signedDistanceM(office, ...at(0, -80)) - 30) < 1);
});
t('corners: distance outside a corner is the diagonal, not the larger axis', () => {
  assert.ok(Math.abs(signedDistanceM(office, ...at(130, 90)) - 50) < 1);                              // 30 east, 40 north of the NE corner
});
t('a point can be inside the circumscribed circle yet outside the rectangle — the rectangle decides', () => {
  const [la, lo] = at(0, 80);                                                                         // 80 m north of centre: inside the 112 m circle
  assert.ok(signedDistanceM({ ...office, geofence_shape: 'circle' }, la, lo) < 0, 'circle model says inside');
  assert.ok(signedDistanceM(office, la, lo) > 0, 'rectangle says outside');
});
t('circles still work as before', () => {
  const c = { latitude: lat0, longitude: lng0, geofence_radius: 100 };
  assert.ok(Math.abs(signedDistanceM(c, ...at(60, 0)) + 40) < 1); assert.ok(Math.abs(signedDistanceM(c, ...at(130, 0)) - 30) < 1);
});
t('bad bounds are not a rectangle; clients get bounds and the inscribed radius', () => {
  assert.equal(rectBounds({ geofence_shape: 'rectangle', geofence_bounds: { north: 1, south: 2, east: 3, west: 4 } }), null);
  assert.equal(rectBounds({ geofence_shape: 'rectangle' }), null); assert.equal(rectBounds({ latitude: 1, longitude: 1, geofence_radius: 5 }), null);
  const f = publicFence(office); assert.equal(f.shape, 'rectangle'); assert.deepEqual(f.bounds, b); assert.ok(Math.abs(f.inscribed_m - 50) <= 1);
  assert.equal(publicFence({ id: 'c', name: 'C', latitude: 1, longitude: 2, geofence_radius: 90 }).shape, undefined);
});

t('a turned rectangle: 90 degrees swaps the long axis; the corners sit exactly on the edge', () => {
  const turned = { ...office, geofence_rotation: 90 };                                               // 200 m x 100 m box, turned a quarter
  assert.ok(signedDistanceM(turned, ...at(0, 90)) < 0, 'now long north-south: 90 m north is inside');
  assert.ok(Math.abs(signedDistanceM(turned, ...at(90, 0)) - 40) < 1.5, 'and 90 m east is 40 m outside (half-width is 50 m)');
  for (const [la, lo] of rectCorners({ ...office, geofence_rotation: 33 })) assert.ok(Math.abs(signedDistanceM({ ...office, geofence_rotation: 33 }, la, lo)) < 0.5);
});
t('45 degrees along a diagonal road: inside along the diagonal, outside across it', () => {
  const diag = { ...office, geofence_rotation: 45 };
  const along = 80 / Math.SQRT2;                                                                      // 80 m out along the turned long axis (clockwise from east = south-east)
  assert.ok(signedDistanceM(diag, ...at(along, -along)) < 0);
  assert.ok(signedDistanceM(diag, ...at(along, along)) > 20, 'the same distance across the road is outside');
  assert.ok(signedDistanceM({ ...office, geofence_rotation: 0 }, ...at(along, -along)) > 0, 'an unturned box would miss that stretch of the road');
});
t('rotation is normalised (a box looks the same every 180 degrees)', () => {
  assert.equal(rectRotation({ geofence_rotation: 180 }), 0); assert.equal(rectRotation({ geofence_rotation: 135 }), -45); assert.equal(rectRotation({ rotation: -90 }), -90); assert.equal(rectRotation({}), 0);
  assert.equal(publicFence({ ...office, geofence_rotation: 30 }).rotation, 30);
});

// a slanted four-corner plot along a road: every corner placed independently (metres east/north of the centre)
const plot = [[-120, -30], [90, -60], [140, 40], [-100, 80]].map(([x, y]) => at(x, y));
const slanted = { id: 'p1', name: 'Plot', geofence_shape: 'polygon', geofence_vertices: plot, ...circleFieldsForPoly(plot) };
t('a free-form outline: inside is negative, outside positive, distance is to the nearest edge', () => {
  assert.ok(signedDistanceM(slanted, ...at(0, 0)) < 0);
  assert.ok(signedDistanceM(slanted, ...at(-85, 60)) < 0, 'near the north-west corner, still inside');
  assert.ok(signedDistanceM(slanted, ...at(-140, 100)) > 0, 'beyond that corner is outside');
  const south = signedDistanceM(slanted, ...at(0, -80));                                              // below the south edge (about y=-45 there)
  assert.ok(south > 25 && south < 45, String(south));
  for (const [la, lo] of plot) assert.ok(Math.abs(signedDistanceM(slanted, la, lo)) < 0.5, 'each corner is on the edge');
});
t('a concave outline (L shape): the notch is outside', () => {
  const L = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]].map(([x, y]) => at(x, y));
  const f = { geofence_shape: 'polygon', geofence_vertices: L, ...circleFieldsForPoly(L) };
  assert.ok(signedDistanceM(f, ...at(20, 70)) < 0); assert.ok(signedDistanceM(f, ...at(80, 20)) < 0);
  assert.ok(signedDistanceM(f, ...at(80, 80)) > 0, 'inside the bounding box but in the notch');
});
t('the circle stored beside an outline covers every corner; clients get vertices and an inscribed radius', () => {
  const c = circleFieldsForPoly(plot);
  for (const [la, lo] of plot) assert.ok(Math.hypot((la - c.latitude) * M, (lo - c.longitude) * mLng) <= c.geofence_radius + 0.5);
  const f = publicFence(slanted); assert.equal(f.shape, 'polygon'); assert.equal(f.vertices.length, 4); assert.ok(f.inscribed_m >= 30);
  assert.ok(isShaped(slanted) && isShaped(office) && !isShaped({ latitude: 1, longitude: 1, geofence_radius: 5 }));
});
t('bad outlines are ignored: too few / too many corners, junk values; a sliver has almost no area', () => {
  assert.equal(polyVertices({ geofence_shape: 'polygon', geofence_vertices: [[1, 1], [2, 2]] }), null);
  assert.equal(polyVertices({ geofence_shape: 'polygon', geofence_vertices: Array.from({ length: 25 }, (_, i) => [i / 100, i / 100]) }), null);
  assert.equal(polyVertices({ geofence_shape: 'polygon', geofence_vertices: [[1, 1], ['x', 2], [3, 3]] }), null);
  assert.ok(polyAreaM2(plot) > 20000); assert.ok(polyAreaM2([at(0, 0), at(100, 0), at(200, 0)]) < 1);
});

console.log(`\n${n} geofence shape checks passed`);
