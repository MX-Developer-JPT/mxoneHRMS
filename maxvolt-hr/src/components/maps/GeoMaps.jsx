import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Circle, Polygon, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { rectSizeM, rectCorners } from '@/lib/geofenceShape';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Map pieces for geofencing: the office-circle picker (Location Master), a trip route viewer and the live field map.
// OpenStreetMap tiles (no key). The site sends a Referrer-Policy of no-referrer, which OSM rejects with 403 — so tiles and searches explicitly send the origin. For heavy use switch to a keyed tile provider (MapTiler, Stadia).

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const INDIA = [22.5, 79];

const dot = (color, size = 16) => L.divIcon({
  className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.45)"></div>`,
});
const pinIcon = L.divIcon({
  className: '', iconSize: [28, 36], iconAnchor: [14, 34],
  html: '<svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 0C6.3 0 0 6.2 0 13.8 0 24 14 36 14 36s14-12 14-22.2C28 6.2 21.7 0 14 0z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#fff"/></svg>',
});

const ok = (n) => Number.isFinite(Number(n)) && n !== '' && n !== null;

function Resize() { const map = useMap(); useEffect(() => { const t = setTimeout(() => map.invalidateSize(), 250); return () => clearTimeout(t); }, [map]); return null; }

function FitTo({ points, pad = 40, max = 16 }) {
  const map = useMap();
  const key = points.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], Math.min(max, 16));
    else map.fitBounds(L.latLngBounds(points), { padding: [pad, pad], maxZoom: max });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

function KeepVisible({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos && !map.getBounds().contains(pos)) map.setView(pos, Math.max(map.getZoom(), 16)); }, [pos?.[0], pos?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function ClickToSet({ onPick }) { useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) }); return null; }

const Fences = ({ fences = [], exclude }) => fences.filter(f => f.id !== exclude && ok(f.latitude) && ok(f.longitude) && Number(f.radius_m) > 0).map(f => (
  f.shape === 'rectangle' && f.bounds
    ? (
      <Polygon key={f.id || f.name} positions={rectCorners(f)} pathOptions={{ color: '#2563eb', weight: 1.5, fillOpacity: 0.08 }}>
        <Tooltip sticky>{f.name} · drawn boundary</Tooltip>
      </Polygon>
    )
    : (
      <Circle key={f.id || f.name} center={[Number(f.latitude), Number(f.longitude)]} radius={Number(f.radius_m)} pathOptions={{ color: '#2563eb', weight: 1.5, fillOpacity: 0.08 }}>
        <Tooltip sticky>{f.name} · {f.radius_m} m</Tooltip>
      </Circle>
    )
));

// Click the map or drag the pin to place the office; the circle shows exactly what the geofence will cover.
export function OfficePickerMap({ latitude, longitude, radius, onChange, otherFences = [], excludeId, height = 280 }) {
  const has = ok(latitude) && ok(longitude);
  const pos = has ? [Number(latitude), Number(longitude)] : null;
  const [q, setQ] = useState(''); const [searching, setSearching] = useState(false); const [msg, setMsg] = useState('');
  const set = (lat, lng) => onChange(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
  const [jump, setJump] = useState(null);
  const search = async (e) => {
    e?.preventDefault(); if (!q.trim()) return; setSearching(true); setMsg('');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q.trim())}`, { headers: { Accept: 'application/json' }, referrerPolicy: 'origin' });
      const j = await r.json();
      if (j[0]) { const lat = Number(j[0].lat), lng = Number(j[0].lon); set(lat, lng); setJump([lat, lng]); } else setMsg('Place not found — try a fuller address or click the map.');
    } catch { setMsg('Search is unavailable right now — click the map instead.'); }
    setSearching(false);
  };
  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex gap-2">
        <input className="flex-1 h-8 rounded-md border bg-background px-2 text-sm" placeholder="Search a place or address…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="submit" disabled={searching} className="h-8 px-3 rounded-md border text-sm hover:bg-muted">{searching ? '…' : 'Find'}</button>
      </form>
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
      <div className="rounded-lg overflow-hidden border" style={{ height }}>
        <MapContainer center={pos || INDIA} zoom={pos ? 17 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer url={TILES} attribution={ATTR} maxZoom={19} referrerPolicy="origin" />
          <Resize />
          <ClickToSet onPick={set} />
          <Fences fences={otherFences} exclude={excludeId} />
          {jump && <FitTo points={[jump]} />}
          <KeepVisible pos={pos} />
          {pos && Number(radius) > 0 && <Circle center={pos} radius={Number(radius)} pathOptions={{ color: '#dc2626', weight: 2, fillOpacity: 0.18 }} />}
          {pos && <Marker position={pos} icon={pinIcon} draggable eventHandlers={{ dragend: (e) => { const p = e.target.getLatLng(); set(p.lat, p.lng); } }} />}
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground">Click the map or drag the pin to set the office centre. Blue circles are other offices.</p>
    </div>
  );
}

const fmtT = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }); };

// A finished or running trip's route: start, end/last position and the path between.
export function RouteMap({ points = [], lastPos, fences = [], height = 360 }) {
  const line = useMemo(() => points.filter(p => ok(p.lat) && ok(p.lng)).map(p => [Number(p.lat), Number(p.lng)]), [points]);
  const end = lastPos && ok(lastPos.lat) ? [Number(lastPos.lat), Number(lastPos.lng)] : line[line.length - 1];
  const all = [...line, ...(end ? [end] : [])];
  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <MapContainer center={all[0] || INDIA} zoom={all.length ? 14 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILES} attribution={ATTR} maxZoom={19} referrerPolicy="origin" />
        <Resize />
        <Fences fences={fences} />
        {all.length > 0 && <FitTo points={all} />}
        {line.length > 1 && <Polyline positions={line} pathOptions={{ color: '#ea580c', weight: 4, opacity: 0.85 }} />}
        {line[0] && <Marker position={line[0]} icon={dot('#16a34a', 18)}><Tooltip>Start{points[0]?.t ? ` · ${fmtT(points[0].t)}` : ''}</Tooltip></Marker>}
        {end && <Marker position={end} icon={dot('#dc2626', 18)}><Tooltip>Latest{lastPos?.t ? ` · ${fmtT(lastPos.t)}` : ''}</Tooltip></Marker>}
      </MapContainer>
    </div>
  );
}

// Everyone on an active trip right now. Grey = no recent fix (phone offline / app closed).
export function LiveMap({ people = [], fences = [], selected, onSelect, trail = [], height = 460 }) {
  const trailLine = trail.filter(p => ok(p.lat) && ok(p.lng)).map(p => [Number(p.lat), Number(p.lng)]);
  const placed = people.filter(p => p.position);
  const pts = placed.map(p => [p.position.lat, p.position.lng]);
  const sel = placed.find(p => p.trip_id === selected);
  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <MapContainer center={pts[0] || INDIA} zoom={pts.length ? 13 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILES} attribution={ATTR} maxZoom={19} referrerPolicy="origin" />
        <Resize />
        <Fences fences={fences} />
        {sel ? <FitTo points={trailLine.length > 1 ? trailLine : [[sel.position.lat, sel.position.lng]]} max={16} /> : pts.length > 0 && <FitTo points={pts} />}
        {trailLine.length > 1 && <Polyline positions={trailLine} pathOptions={{ color: '#ea580c', weight: 4, opacity: 0.85 }} />}
        {trailLine.length > 0 && <Marker position={trailLine[0]} icon={dot('#16a34a', 14)}><Tooltip>Trip start</Tooltip></Marker>}
        {placed.map(p => (
          <Marker key={p.trip_id} position={[p.position.lat, p.position.lng]} icon={dot(p.stale ? '#6b7280' : '#16a34a', p.trip_id === selected ? 24 : 18)} eventHandlers={{ click: () => onSelect?.(p.trip_id) }}>
            <Tooltip direction="top" offset={[0, -8]}>{p.employee?.name || 'Employee'} · {p.age_minutes == null ? 'no fix' : p.age_minutes < 1 ? 'just now' : `${p.age_minutes} min ago`}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// Pins for check-in / check-out places (selfie attendance). markers: [{ id, lat, lng, color, label }]
export function PlacesMap({ markers = [], fences = [], height = 420 }) {
  const pts = markers.filter(m => ok(m.lat) && ok(m.lng)).map(m => [Number(m.lat), Number(m.lng)]);
  const fencePts = fences.filter(f => ok(f.latitude) && ok(f.longitude)).map(f => [Number(f.latitude), Number(f.longitude)]);
  return (
    <div className="rounded-lg overflow-hidden border" style={{ height }}>
      <MapContainer center={pts[0] || fencePts[0] || INDIA} zoom={pts.length ? 15 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILES} attribution={ATTR} maxZoom={19} referrerPolicy="origin" />
        <Resize />
        <Fences fences={fences} />
        {pts.length > 0 && <FitTo points={pts.length === 1 ? [...pts, ...fencePts.slice(0, 1)] : pts} max={17} />}
        {markers.filter(m => ok(m.lat) && ok(m.lng)).map(m => (
          <Marker key={m.id} position={[Number(m.lat), Number(m.lng)]} icon={dot(m.color || '#2563eb', 18)}><Tooltip direction="top" offset={[0, -8]}>{m.label}</Tooltip></Marker>
        ))}
      </MapContainer>
    </div>
  );
}

// Draw the office boundary as a rectangle: tap two opposite corners (works with a finger as well as a mouse), then drag the
// corner handles to adjust or the centre pin to move the whole outline. onChange receives { north, south, east, west } or null.
function CornerClicks({ active, onCorner, onMove }) {
  useMapEvents({ click: (e) => active && onCorner(e.latlng), mousemove: (e) => active && onMove?.(e.latlng) });
  return null;
}

const boundsFrom = (a, b) => ({
  north: Math.max(a.lat, b.lat), south: Math.min(a.lat, b.lat), east: Math.max(a.lng, b.lng), west: Math.min(a.lng, b.lng),
});
const r6 = (n) => Math.round(n * 1e6) / 1e6;

const M_LAT = 111195;
// keep an angle in [-90, 90): a rectangle looks the same every 180 degrees
const normRot = (d) => ((((d + 90) % 180) + 180) % 180) - 90;
const frameOf = (b, rotDeg) => {
  const cLat = (b.north + b.south) / 2, cLng = (b.east + b.west) / 2, lonM = M_LAT * Math.cos(cLat * Math.PI / 180), r = rotDeg * Math.PI / 180;
  return { cLat, cLng, lonM, hw: (b.east - b.west) / 2 * lonM, hh: (b.north - b.south) / 2 * M_LAT, c: Math.cos(r), s: Math.sin(r) };
};
const toLocal = (g, ll) => { const x = (ll.lng - g.cLng) * g.lonM, y = (ll.lat - g.cLat) * M_LAT; return { x: x * g.c - y * g.s, y: x * g.s + y * g.c }; };
const toWorld = (g, p) => ({ lat: g.cLat + (-p.x * g.s + p.y * g.c) / M_LAT, lng: g.cLng + (p.x * g.c + p.y * g.s) / g.lonM });

export function RectangleEditorMap({ bounds, rotation = 0, onChange, otherFences = [], excludeId, height = 320 }) {
  const [drawing, setDrawing] = useState(!bounds);
  const [first, setFirst] = useState(null);
  const [hover, setHover] = useState(null);
  const [q, setQ] = useState(''); const [searching, setSearching] = useState(false); const [msg, setMsg] = useState(''); const [jump, setJump] = useState(null);
  const [initialFit] = useState(() => (bounds ? rectCorners({ shape: 'rectangle', bounds, rotation }) : null));

  const finish = (b, rot = rotation) => { onChange({ north: r6(b.north), south: r6(b.south), east: r6(b.east), west: r6(b.west) }, normRot(rot)); setDrawing(false); setFirst(null); setHover(null); };
  const corner = (ll) => { if (!first) setFirst(ll); else finish(boundsFrom(first, ll), 0); };

  const search = async (e) => {
    e?.preventDefault(); if (!q.trim()) return; setSearching(true); setMsg('');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q.trim())}`, { headers: { Accept: 'application/json' }, referrerPolicy: 'origin' });
      const j = await r.json();
      if (j[0]) setJump([Number(j[0].lat), Number(j[0].lon)]); else setMsg('Place not found — try a fuller address or move the map by hand.');
    } catch { setMsg('Search is unavailable right now — move the map by hand.'); }
    setSearching(false);
  };

  const live = first && hover ? boundsFrom(first, hover) : null;
  const shown = live || bounds;
  const shownRot = live ? 0 : rotation;
  const size = shown ? rectSizeM(shown) : null;
  const poly = shown ? rectCorners({ shape: 'rectangle', bounds: shown, rotation: shownRot }) : null;

  // frame of the saved rectangle, used by the drag handles
  const g = bounds ? frameOf(bounds, rotation) : null;
  const cornerDefs = [['nw', -1, 1], ['ne', 1, 1], ['se', 1, -1], ['sw', -1, -1]];
  const cornerPos = g ? cornerDefs.map(([k, sx, sy]) => ({ k, sx, sy, ...toWorld(g, { x: sx * g.hw, y: sy * g.hh }) })) : [];
  const dragCorner = (sx, sy, ll) => {
    const p = toLocal(g, ll), o = { x: -sx * g.hw, y: -sy * g.hh };
    const centre = toWorld(g, { x: (p.x + o.x) / 2, y: (p.y + o.y) / 2 });
    const hw = Math.max(5, Math.abs(p.x - o.x) / 2), hh = Math.max(5, Math.abs(p.y - o.y) / 2);
    const lonM = M_LAT * Math.cos(centre.lat * Math.PI / 180);
    finish({ north: centre.lat + hh / M_LAT, south: centre.lat - hh / M_LAT, east: centre.lng + hw / lonM, west: centre.lng - hw / lonM });
  };
  const movePin = (ll) => {
    const dLat = ll.lat - g.cLat, dLng = ll.lng - g.cLng;
    finish({ north: bounds.north + dLat, south: bounds.south + dLat, east: bounds.east + dLng, west: bounds.west + dLng });
  };
  // the round handle beyond the top edge: drag it around the centre to turn the rectangle
  const handleLocal = g ? { x: 0, y: g.hh + Math.max(20, g.hh * 0.3) } : null;
  const handlePos = g ? toWorld(g, handleLocal) : null;
  const dragTurn = (ll) => {
    const x = (ll.lng - g.cLng) * g.lonM, y = (ll.lat - g.cLat) * M_LAT;
    let deg = Math.round(Math.atan2(x, y) * 180 / Math.PI);
    if (Math.abs(normRot(deg)) <= 3) deg = 0;                       // snap back to square with the map
    finish(bounds, deg);
  };

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex gap-2">
        <input className="flex-1 h-8 rounded-md border bg-background px-2 text-sm" placeholder="Search a place or address…" value={q} onChange={e => setQ(e.target.value)} />
        <button type="submit" disabled={searching} className="h-8 px-3 rounded-md border text-sm hover:bg-muted">{searching ? '…' : 'Find'}</button>
      </form>
      {msg && <p className="text-xs text-amber-700">{msg}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => { setDrawing(true); setFirst(null); }} className={`h-8 px-3 rounded-md border text-sm ${drawing ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{bounds ? 'Redraw rectangle' : 'Draw rectangle'}</button>
        {bounds && <button type="button" onClick={() => { onChange(null, 0); setDrawing(true); setFirst(null); }} className="h-8 px-3 rounded-md border text-sm hover:bg-muted">Clear</button>}
        <span className="text-xs text-muted-foreground">
          {drawing ? (first ? 'Now tap the opposite corner.' : 'Zoom in to your office (or use Find), then tap one corner of the area.') : size ? `${Math.round(size.width)} m × ${Math.round(size.height)} m — drag a white corner to resize, the pin to move, the round handle (or the slider) to turn it.` : ''}
        </span>
      </div>
      <div className="rounded-lg overflow-hidden border" style={{ height, cursor: drawing ? 'crosshair' : undefined }}>
        <MapContainer center={initialFit ? initialFit[0] : INDIA} zoom={initialFit ? 17 : 5} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer url={TILES} attribution={ATTR} maxZoom={19} referrerPolicy="origin" />
          <Resize />
          <CornerClicks active={drawing} onCorner={corner} onMove={setHover} />
          <Fences fences={otherFences} exclude={excludeId} />
          {initialFit && <FitTo points={initialFit} max={18} />}
          {jump && <FitTo points={[jump]} max={17} />}
          {poly && <Polygon positions={poly} pathOptions={{ color: '#dc2626', weight: 2, fillOpacity: 0.18, dashArray: live ? '6 6' : undefined }} />}
          {first && <Marker position={first} icon={dot('#dc2626', 14)} />}
          {!drawing && bounds && cornerPos.map(c => (
            <Marker key={c.k} position={[c.lat, c.lng]} icon={dot('#ffffff', 16)} draggable eventHandlers={{ dragend: (e) => dragCorner(c.sx, c.sy, e.target.getLatLng()) }} />
          ))}
          {!drawing && g && <Marker position={[g.cLat, g.cLng]} icon={pinIcon} draggable eventHandlers={{ dragend: (e) => movePin(e.target.getLatLng()) }} />}
          {!drawing && handlePos && <Polyline positions={[[g.cLat, g.cLng], [handlePos.lat, handlePos.lng]]} pathOptions={{ color: '#dc2626', weight: 1, dashArray: '3 4' }} />}
          {!drawing && handlePos && <Marker position={[handlePos.lat, handlePos.lng]} icon={dot('#f59e0b', 18)} draggable eventHandlers={{ dragend: (e) => dragTurn(e.target.getLatLng()) }}><Tooltip>Drag to turn</Tooltip></Marker>}
        </MapContainer>
      </div>
      {bounds && (
        <div className="flex items-center gap-3">
          <label className="text-xs whitespace-nowrap">Angle: {Math.round(rotation)}°</label>
          <input type="range" min={-90} max={89} step={1} className="flex-1" value={Math.round(rotation)} onChange={e => finish(bounds, Number(e.target.value))} />
          <button type="button" onClick={() => finish(bounds, 0)} className="h-7 px-2 rounded-md border text-xs hover:bg-muted">Reset</button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Blue shapes are other offices. Employees are checked in when they enter this outline and checked out when they leave it.</p>
    </div>
  );
}
