// Rectangle geofences. Run: node backend/tests/geofenceShape.test.mjs
import assert from 'node:assert/strict';
import { rectBounds, circleFieldsForRect, signedDistanceM, publicFence, rectSizeM, rectCorners, rectRotation } from '../utils/geofenceShape.js';
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

console.log(`\n${n} geofence shape checks passed`);
