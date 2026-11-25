// Day-wise storage of Field Duty distance. One private FieldDaySummary row per employee per day (distance, duration, stops, checkpoints
// count, tracking gaps), recomputed from that day's recorded sessions whenever one closes. The sessions (FieldTrip) stay the source of truth;
// the summary is what reports and the daily list read.
import { all, one, run } from '../db.js';
import { buildRoute, daySummary, normalizeConfig } from '../utils/fieldTracking.js';

export async function loadFieldConfig() {
  let raw = null;
  try { const r = await one("SELECT value FROM settings WHERE key='field_tracking_config'"); raw = r ? JSON.parse(r.value) : null; } catch { raw = null; }
  return normalizeConfig(raw);
}

export async function loadFences() {
  const rows = await all("SELECT data FROM entities WHERE type='AppLocation'");
  return rows.map(r => { try { return JSON.parse(r.data); } catch { return null; } })
    .filter(l => l && l.is_active !== false && l.latitude != null && l.longitude != null && Number(l.geofence_radius) > 0);
}

export async function tripsOfDay(userId, date) {
  return (await all("SELECT data FROM entities WHERE type='FieldTrip' AND user_id=$1 AND data::jsonb->>'date'=$2", [userId, date])).map(r => JSON.parse(r.data));
}

export async function saveFieldDaySummary(userId, date, nowMs = Date.now()) {
  const trips = await tripsOfDay(userId, date);
  if (!trips.length) return null;
  const cfg = await loadFieldConfig();
  const route = buildRoute(trips, nowMs, cfg, 4000, await loadFences());
  const data = {
    id: `fds-${userId}-${date}`, user_id: userId, date, ...daySummary(route),
    stops_list: route.stops.map(s => ({ from: s.from, to: s.to, minutes: s.minutes, place: s.place, at_office: s.at_office, long: s.long, lat: s.lat, lng: s.lng })),
    open: route.on_duty_now, updated_at: new Date(nowMs).toISOString(),
  };
  await run("DELETE FROM entities WHERE id=$1 AND type='FieldDaySummary'", [data.id]);
  await run("INSERT INTO entities(id,type,user_id,status,data) VALUES($1,'FieldDaySummary',$2,'ready',$3)", [data.id, userId, JSON.stringify(data)]);
  return data;
}
