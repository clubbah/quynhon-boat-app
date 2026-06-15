/**
 * Storm Monitor
 *
 * Tracks active tropical cyclones near Quy Nhon using GDACS (the UN/EU Global
 * Disaster Alert and Coordination System). GDACS is free, needs no API key,
 * and covers the Western Pacific basin that affects Vietnam (NOAA's hurricane
 * center does not).
 *
 * Flow, mirroring the weather cache in index.js:
 *   1. Fetch the list of active tropical cyclones.
 *   2. Keep only ones in our basin (South China Sea + Western Pacific).
 *   3. For each, fetch its track geometry (past track, forecast track, wind
 *      buffers) and compute how close it gets to Quy Nhon and when.
 *   4. Pick the most threatening storm, grade the threat, and cache it.
 *
 * Alerting is on-site banner only: the frontend reads /api/storms and shows a
 * banner when threat.level is "warning" or "watch". Nothing is persisted —
 * the banner is a pure function of the latest GDACS data.
 */

import { haversine, bearingTo } from './geo.js';

// Quy Nhon — same point the threat distance is measured to (matches map.js center).
const QUY_NHON = { lat: 13.77, lng: 109.22 };

const GDACS_EVENTLIST = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC';

// Our basin: South China Sea + Western Pacific genesis region, generous enough
// to catch a storm a week out east of the Philippines, tight enough to skip
// Atlantic / East-Pacific systems we never need to fetch geometry for.
const BASIN = { minLng: 99, maxLng: 170, minLat: -5, maxLat: 45 };

const CACHE_TTL_MS = 20 * 60 * 1000;        // serve cached data for 20 min
const CHECK_INTERVAL_MS = 30 * 60 * 1000;   // refresh the cache every 30 min
const FIRST_RUN_DELAY_MS = 15 * 1000;       // warm the cache shortly after boot

let stormCache = { data: null, fetchedAt: 0 };

// ── Public API ──

// Cached snapshot for /api/storms. Returns stale data on fetch error (like
// fetchWeather), which may be null until the first successful fetch.
export async function getStormSnapshot() {
  const now = Date.now();
  if (stormCache.data && (now - stormCache.fetchedAt) < CACHE_TTL_MS) {
    return stormCache.data;
  }
  try {
    const data = await buildSnapshot();
    stormCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    console.error('[Storm] Fetch error:', err.message);
    return stormCache.data;
  }
}

export function startStormMonitor() {
  console.log('[Storm] Monitor started. Source: GDACS tropical cyclones. ' +
    `Refresh every ${CHECK_INTERVAL_MS / 60000} min.`);
  const run = () => getStormSnapshot()
    .then((s) => {
      if (s && s.active) {
        console.log(`[Storm] Active near basin: ${s.storm.name} ` +
          `(${s.threat.level}, ${s.threat.distanceKm} km from Quy Nhon)`);
      } else {
        console.log('[Storm] No active tropical cyclone threatening Quy Nhon.');
      }
    })
    .catch((err) => console.error('[Storm] Check failed:', err.message));
  setTimeout(run, FIRST_RUN_DELAY_MS);
  setInterval(run, CHECK_INTERVAL_MS);
}

// ── Snapshot builder ──

async function buildSnapshot() {
  const list = await fetchJson(GDACS_EVENTLIST);
  const candidates = parseEventList(list).filter((e) => inBasin(e.lng, e.lat));
  if (!candidates.length) return emptySnapshot();

  const storms = [];
  for (const ev of candidates) {
    try {
      const geom = await fetchJson(ev.geometryUrl);
      const storm = normalizeStorm(ev, geom);
      if (storm) storms.push(storm);
    } catch (err) {
      console.warn('[Storm] geometry fetch failed for', ev.name, '-', err.message);
    }
  }
  if (!storms.length) return emptySnapshot();

  // The most threatening storm is the one whose track gets closest to Quy Nhon.
  storms.sort((a, b) => (a.threat.distanceKm ?? 1e9) - (b.threat.distanceKm ?? 1e9));
  const primary = storms[0];
  const others = storms.slice(1).map((s) => ({
    name: s.name, alertlevel: s.alertlevel, category: s.category,
    distanceKm: s.threat.distanceKm,
  }));

  return {
    active: true,
    updatedAt: new Date().toISOString(),
    quyNhon: QUY_NHON,
    threat: primary.threat,
    storm: primary,
    others,
  };
}

function emptySnapshot() {
  return {
    active: false,
    updatedAt: new Date().toISOString(),
    quyNhon: QUY_NHON,
    threat: { level: 'none', distanceKm: null, etaHours: null },
    storm: null,
    others: [],
  };
}

// ── GDACS event list parsing ──

// The event list is a FeatureCollection with one or more features per event.
// Collapse to one record per eventid, preferring the highest episode and a
// Point geometry for the current centroid position.
export function parseEventList(fc) {
  const byId = new Map();
  for (const f of (fc && fc.features) || []) {
    const p = f.properties || {};
    const id = p.eventid;
    if (id == null) continue;

    let lng = null, lat = null;
    if (f.geometry && f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      [lng, lat] = f.geometry.coordinates;
    }

    const rec = byId.get(id) || {
      eventid: id,
      episodeid: p.episodeid ?? null,
      name: p.eventname || p.name || `TC ${id}`,
      alertlevel: p.alertlevel || 'Green',
      alertscore: p.alertscore ?? null,
      geometryUrl: (p.url && p.url.geometry) || buildGeometryUrl(id, p.episodeid),
      affectedCountries: parseCountries(p),
      lng: null, lat: null,
    };

    if (rec.lng == null && lng != null) { rec.lng = lng; rec.lat = lat; }
    // Prefer the most recent episode's geometry link.
    if (p.episodeid != null && p.episodeid >= (rec.episodeid ?? -1)) {
      rec.episodeid = p.episodeid;
      if (p.url && p.url.geometry) rec.geometryUrl = p.url.geometry;
    }
    byId.set(id, rec);
  }
  return [...byId.values()];
}

function buildGeometryUrl(eventid, episodeid) {
  const base = `https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=${eventid}`;
  return episodeid != null ? `${base}&episodeid=${episodeid}` : base;
}

// GDACS exposes affected countries as either a string or an array of objects.
// Normalize to a list of uppercase ISO codes so we can check for 'VN'.
function parseCountries(p) {
  const out = [];
  const raw = p.affectedcountries || p.iso3 || p.countryISO || null;
  if (Array.isArray(raw)) {
    for (const c of raw) {
      const code = (c && (c.iso2 || c.iso3 || c.countrycode)) || (typeof c === 'string' ? c : null);
      if (code) out.push(String(code).toUpperCase());
    }
  } else if (typeof raw === 'string') {
    for (const code of raw.split(/[,;]/)) {
      const t = code.trim();
      if (t) out.push(t.toUpperCase());
    }
  }
  return out;
}

export function inBasin(lng, lat) {
  if (lng == null || lat == null) return false;
  return lng >= BASIN.minLng && lng <= BASIN.maxLng && lat >= BASIN.minLat && lat <= BASIN.maxLat;
}

// ── GDACS geometry parsing ──

// Turn one storm's GDACS geometry into ready-to-map GeoJSON plus a threat
// assessment. Buckets: past track lines, forecast track lines, wind-buffer
// polygons (the cone), and position points.
export function normalizeStorm(ev, geom) {
  const lineFeats = [];
  const polyFeats = [];
  const pointFeats = [];
  const positions = []; // {lng,lat,date,wind,forecast} storm-centre samples for threat math
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];

  const extend = (lng, lat) => {
    if (lng < bbox[0]) bbox[0] = lng;
    if (lat < bbox[1]) bbox[1] = lat;
    if (lng > bbox[2]) bbox[2] = lng;
    if (lat > bbox[3]) bbox[3] = lat;
  };
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { extend(coords[0], coords[1]); return; }
    for (const c of coords) walk(c);
  };

  // GDACS often gives only one Point (the current centre) and carries the rest
  // of the track as LineStrings (the path) plus dated wind-buffer Polygons. So
  // gather storm-centre samples from all three: Point coords, LineString
  // vertices (dateless), and Polygon centres (dated). That yields a dense,
  // dated track for the closest-approach and ETA maths.
  for (const f of (geom && geom.features) || []) {
    const g = f.geometry;
    if (!g || !g.coordinates) continue;
    const p = f.properties || {};
    const forecast = isForecast(p);
    const date = p.polygondate || p.todate || null;

    if (g.type === 'Point') {
      const [lng, lat] = g.coordinates;
      positions.push({ lng, lat, date, wind: severity(p), forecast });
      pointFeats.push(pointFeature(g, forecast, p));
      extend(lng, lat);
    } else if (g.type === 'LineString' || g.type === 'MultiLineString') {
      lineFeats.push({ type: 'Feature', geometry: g, properties: { forecast } });
      for (const [lng, lat] of flatCoords(g)) positions.push({ lng, lat, date: null, wind: null, forecast });
      walk(g.coordinates);
    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      polyFeats.push(polyFeature(g, ev.alertlevel, p));
      const c = centroid(g);
      if (c) positions.push({ lng: c.lng, lat: c.lat, date, wind: severity(p), forecast });
      walk(g.coordinates);
    }
  }

  // Current position = most recent observed (non-forecast, dated) centre.
  const observed = positions.filter((pt) => !pt.forecast && pt.date)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const last = observed[observed.length - 1];
  const current = last
    ? { lat: last.lat, lng: last.lng }
    : (ev.lat != null ? { lat: ev.lat, lng: ev.lng } : null);
  if (!current) return null;

  const lastWithWind = [...observed].reverse().find((pt) => pt.wind != null);
  const currentWind = lastWithWind ? lastWithWind.wind : maxWind(positions);
  const threat = computeThreat(positions, current, ev);

  return {
    eventid: ev.eventid,
    name: cleanName(ev.name),
    alertlevel: ev.alertlevel,
    windKmh: currentWind != null ? Math.round(currentWind) : null,
    category: classify(currentWind),
    current,
    bbox: bbox[0] === Infinity ? null : bbox,
    pastTrack: featureCollection(lineFeats.filter((f) => !f.properties.forecast)),
    forecastTrack: featureCollection(lineFeats.filter((f) => f.properties.forecast)),
    cone: featureCollection(polyFeats),
    points: featureCollection(pointFeats),
    threat,
  };
}

// Closest approach of the whole track to Quy Nhon, plus ETA from the nearest
// forecast point and the storm's current distance/bearing.
export function computeThreat(points, current, ev) {
  let closest = Infinity, closestAt = null, closestBearing = null;
  let fcClosest = Infinity, etaDate = null;

  for (const pt of points) {
    const d = haversine(QUY_NHON.lat, QUY_NHON.lng, pt.lat, pt.lng);
    if (d < closest) {
      closest = d;
      closestAt = pt.date;
      closestBearing = bearingTo(QUY_NHON.lat, QUY_NHON.lng, pt.lat, pt.lng);
    }
    if (pt.forecast && pt.date && d < fcClosest) { fcClosest = d; etaDate = pt.date; }
  }

  const currentDistance = current ? haversine(QUY_NHON.lat, QUY_NHON.lng, current.lat, current.lng) : null;
  const distanceKm = Number.isFinite(closest)
    ? Math.round(closest)
    : (currentDistance != null ? Math.round(currentDistance) : null);

  let etaHours = null;
  if (etaDate) {
    const h = (Date.parse(etaDate) - Date.now()) / 3600000;
    if (h > 0) etaHours = Math.round(h);
  }

  return {
    level: gradeThreat({ distanceKm, etaHours, alertlevel: ev.alertlevel, countries: ev.affectedCountries }),
    distanceKm,
    etaHours,
    currentDistanceKm: currentDistance != null ? Math.round(currentDistance) : null,
    closestAt,
    bearing: closestBearing != null ? Math.round(closestBearing) : null,
  };
}

// Grade combines GDACS alert level with proximity/timing to Quy Nhon.
// warning = banner red, watch = banner amber, monitor = on the page but no
// banner, none = nothing in the basin.
function gradeThreat({ distanceKm, etaHours, alertlevel, countries }) {
  if (distanceKm == null) return 'monitor';
  const hitsVN = Array.isArray(countries) && countries.includes('VN');
  const red = alertlevel === 'Red';
  const orange = alertlevel === 'Orange';
  const soon = (h) => etaHours == null || etaHours < h;

  if ((red && (hitsVN || distanceKm < 400)) || (distanceKm < 200 && soon(72))) return 'warning';
  if ((orange && (hitsVN || distanceKm < 500)) || (distanceKm < 500 && soon(120))) return 'watch';
  return 'monitor';
}

// ── small helpers ──

function isForecast(p) {
  if (typeof p.forecast === 'boolean') return p.forecast;
  if (typeof p.forecast === 'string') return p.forecast.toLowerCase() === 'true';
  const d = p.polygondate ? Date.parse(p.polygondate) : NaN;
  return Number.isFinite(d) ? d > Date.now() : false;
}

function severity(p) {
  const s = p.severitydata && p.severitydata.severity;
  return typeof s === 'number' ? s : null;
}

function maxWind(points) {
  const winds = points.map((pt) => pt.wind).filter((w) => w != null);
  return winds.length ? Math.max(...winds) : null;
}

// Western-Pacific-style intensity labels from sustained wind (km/h).
function classify(wind) {
  if (wind == null) return null;
  if (wind < 63) return 'Tropical Depression';
  if (wind < 89) return 'Tropical Storm';
  if (wind < 118) return 'Severe Tropical Storm';
  if (wind < 150) return 'Typhoon';
  if (wind < 185) return 'Severe Typhoon';
  return 'Super Typhoon';
}

// GDACS names look like "CRISTINA-26"; drop the trailing season suffix.
function cleanName(name) {
  return String(name || '').replace(/-\d{2}$/, '').trim() || 'Tropical Cyclone';
}

function sevFromClass(cls) {
  const m = /Poly_(\w+)/.exec(cls || '');
  return m ? m[1].toLowerCase() : null;
}

function pointFeature(geometry, forecast, p) {
  return {
    type: 'Feature',
    geometry,
    properties: {
      forecast,
      date: p.polygondate || null,
      label: p.polygonlabel || null,
      wind: severity(p),
    },
  };
}

function polyFeature(geometry, alertlevel, p) {
  return {
    type: 'Feature',
    geometry,
    properties: {
      sev: sevFromClass(p.Class) || (alertlevel ? alertlevel.toLowerCase() : 'green'),
      label: p.polygonlabel || null,
    },
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

// Yield [lng,lat] vertices of a LineString or MultiLineString.
function* flatCoords(g) {
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (const line of lines) {
    for (const c of line) if (Array.isArray(c) && typeof c[0] === 'number') yield c;
  }
}

// Approximate centre of a Polygon / MultiPolygon by averaging its ring vertices.
function centroid(g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let sx = 0, sy = 0, n = 0;
  for (const rings of polys) {
    for (const ring of rings) {
      for (const pt of ring) {
        if (Array.isArray(pt) && typeof pt[0] === 'number') { sx += pt[0]; sy += pt[1]; n++; }
      }
    }
  }
  return n ? { lng: sx / n, lat: sy / n } : null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
