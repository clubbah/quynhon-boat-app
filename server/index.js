import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData,
  upsertArchive, incrementVisitCount, logVisit, getRecentVisits, getVesselVisitHistory,
  getArchiveStats, compressPositions } from './db.js';
import { connectAisStream } from './ais-client.js';
import { getVesselTypeLabel, getNavStatusLabel, getFlagCountry } from './ais-types.js';
import { startCleanup } from './cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AISSTREAM_API_KEY;
const AIS_FEED_SECRET = process.env.AIS_FEED_SECRET || '';

// Database
const db = createDb(path.join(__dirname, '..', 'vessels.db'));

// Express
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Static pages with clean URLs
app.get('/spot', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'spot.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});

// All vessels as JSON (for spot feature)
app.get('/api/vessels', (req, res) => {
  const vessels = getVesselsByArea(db);
  res.json(vessels);
});

app.get('/api/vessels/:mmsi/track', (req, res) => {
  const track = getTrack(db, req.params.mmsi);
  res.json(track);
});

// AIS-catcher HTTP feed endpoint
function handleAisFeed(req, res) {
  const token = req.params.key || req.headers['x-ais-secret'];
  if (AIS_FEED_SECRET && token !== AIS_FEED_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    // Log first incoming message to understand AIS-catcher format
    const raw = req.body;
    console.log('[AIS-Feed] Received:', JSON.stringify(raw).substring(0, 500));

    // AIS-catcher may wrap messages in a top-level object
    let messages;
    if (Array.isArray(raw)) {
      messages = raw;
    } else if (raw.msgs && Array.isArray(raw.msgs)) {
      messages = raw.msgs;
    } else if (raw.values && Array.isArray(raw.values)) {
      messages = raw.values;
    } else {
      messages = [raw];
    }
    let count = 0;

    for (const msg of messages) {
      const parsed = parseAisCatcherMessage(msg);
      if (!parsed) continue;
      count++;

      const vessel = { mmsi: parsed.mmsi, updated_at: parsed.updated_at };
      if (parsed.name) vessel.name = parsed.name;
      if (parsed.flag_country) vessel.flag_country = parsed.flag_country;

      if (parsed.lat != null && parsed.lng != null) {
        Object.assign(vessel, {
          lat: parsed.lat, lng: parsed.lng, speed: parsed.speed,
          course: parsed.course, heading: parsed.heading,
          nav_status: parsed.nav_status, nav_status_label: parsed.nav_status_label,
        });
        appendPosition(db, {
          mmsi: parsed.mmsi, lat: parsed.lat, lng: parsed.lng,
          speed: parsed.speed, course: parsed.course, timestamp: parsed.updated_at,
        });
      }

      if (parsed.vessel_type != null) {
        Object.assign(vessel, {
          imo: parsed.imo, call_sign: parsed.call_sign,
          vessel_type: parsed.vessel_type, vessel_type_label: parsed.vessel_type_label,
          length: parsed.length, width: parsed.width, draught: parsed.draught,
          destination: parsed.destination, eta: parsed.eta,
        });
      }

      upsertVessel(db, vessel);
      const fullVessel = getVesselFromDb(db, parsed.mmsi);
      if (fullVessel && fullVessel.lat != null) {
        detectArrival(db, fullVessel);
        broadcast({ type: 'update', vessel: fullVessel });
      }
    }

    res.json({ ok: true, processed: count });
  } catch (err) {
    console.error('[AIS-Feed] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
}
app.post('/api/ais-feed', handleAisFeed);
app.post('/api/ais-feed/:key', handleAisFeed);

function parseAisCatcherMessage(msg) {
  const mmsi = String(msg.mmsi || msg.MMSI);
  if (!mmsi || mmsi === 'undefined') return null;

  // Filter out non-vessels: buoys, beacons, base stations, AtoN (Aids to Navigation)
  // MMSI ranges: 99x = AtoN, 00x = base stations, 970-979 = SART/MOB/EPIRB
  if (mmsi.startsWith('99') || mmsi.startsWith('98') || mmsi.startsWith('97') ||
      mmsi.startsWith('96') || mmsi.startsWith('94') || mmsi.startsWith('00') ||
      mmsi.length !== 9) return null;
  // Known fake/test MMSIs
  if (mmsi === '123456789' || mmsi === '000000000' || mmsi === '111111111') return null;
  // AIS ship types for navigation aids
  const navAidTypes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  if (msg.shiptype != null && navAidTypes.includes(msg.shiptype)) return null;

  // Filter garbled data: vessel names with special chars that real AIS names never contain
  const rawName = (msg.shipname || msg.name || '').trim();
  const name = rawName || null;
  if (rawName && /[<>\\[\]{}|^]/.test(rawName)) return null;

  // Filter invalid call signs (real ones are alphanumeric, 4-7 chars)
  const rawCallsign = (msg.callsign ?? msg.call_sign ?? '').trim();
  if (rawCallsign && /[<>\\[\]{}|^]/.test(rawCallsign)) return null;

  const flag_country = msg.country || getFlagCountry(mmsi);
  const updated_at = msg.timestamp || new Date().toISOString();

  // Build ETA string from separate fields if available
  let eta = msg.eta ?? null;
  if (!eta && msg.eta_month && msg.eta_day) {
    const m = String(msg.eta_month).padStart(2, '0');
    const d = String(msg.eta_day).padStart(2, '0');
    const h = String(msg.eta_hour || 0).padStart(2, '0');
    const min = String(msg.eta_minute || 0).padStart(2, '0');
    eta = `${m}-${d} ${h}:${min}`;
  }

  const draught = msg.draught != null && msg.draught >= 0 ? msg.draught : null;

  return {
    mmsi, name, flag_country, updated_at,
    lat: msg.lat ?? msg.latitude ?? null,
    lng: msg.lon ?? msg.lng ?? msg.longitude ?? null,
    speed: msg.speed ?? msg.sog ?? null,
    course: msg.course ?? msg.cog ?? null,
    heading: msg.heading ?? null,
    nav_status: msg.status ?? msg.nav_status ?? null,
    nav_status_label: msg.status != null ? getNavStatusLabel(msg.status) : null,
    imo: msg.imo ? String(msg.imo) : null,
    call_sign: (msg.callsign ?? msg.call_sign ?? '').trim() || null,
    vessel_type: msg.shiptype ?? msg.vessel_type ?? null,
    vessel_type_label: msg.shiptype != null ? getVesselTypeLabel(msg.shiptype) : null,
    length: msg.to_bow != null && msg.to_stern != null ? msg.to_bow + msg.to_stern : (msg.length ?? null),
    width: msg.to_port != null && msg.to_starboard != null ? msg.to_port + msg.to_starboard : (msg.width ?? null),
    draught,
    destination: (msg.destination ?? '').trim() || null,
    eta,
  };
}

// Weather + marine data (cached, refreshed every 15 min)
let weatherCache = { data: null, fetchedAt: 0 };
const WEATHER_TTL = 15 * 60 * 1000;

async function fetchWeather() {
  const now = Date.now();
  if (weatherCache.data && (now - weatherCache.fetchedAt) < WEATHER_TTL) {
    return weatherCache.data;
  }
  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch('https://api.open-meteo.com/v1/forecast?latitude=13.76&longitude=109.23&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,apparent_temperature,precipitation&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation_probability&daily=sunrise,sunset&timezone=Asia/Ho_Chi_Minh&forecast_days=2'),
      fetch('https://marine-api.open-meteo.com/v1/marine?latitude=13.76&longitude=109.23&current=wave_height,wave_direction,wave_period,swell_wave_height&timezone=Asia/Ho_Chi_Minh'),
    ]);
    const weather = await weatherRes.json();
    const marine = await marineRes.json();
    weatherCache.data = { weather, marine };
    weatherCache.fetchedAt = now;
    return weatherCache.data;
  } catch (err) {
    console.error('[Weather] Fetch error:', err.message);
    return weatherCache.data;
  }
}

app.get('/api/weather', async (req, res) => {
  const data = await fetchWeather();
  if (data) {
    res.json(data);
  } else {
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

// Port stats — arrivals, departures, vessel of the day
app.get('/api/port-stats', (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];

  // All current vessels
  const allVessels = db.prepare('SELECT * FROM vessels').all();

  // Vessels seen in last 24h (arrivals)
  const recentVessels = db.prepare(
    "SELECT * FROM vessels WHERE updated_at > ? ORDER BY updated_at DESC"
  ).all(yesterday + 'T00:00:00');

  // Moving vessels (speed > 0.5)
  // Speed-based movement detection (more reliable than AIS nav_status)
  const moving = allVessels.filter(v => v.speed != null && v.speed > 0.5);
  const anchored = allVessels.filter(v => v.speed == null || v.speed <= 0.5);

  // Vessel of the day — largest vessel currently visible
  const vesselOfDay = allVessels
    .filter(v => v.name && v.length)
    .sort((a, b) => (b.length || 0) - (a.length || 0))[0] || null;

  // Recent activity — last 10 updates
  const recentActivity = db.prepare(
    "SELECT mmsi, name, vessel_type_label, flag_country, speed, nav_status_label, destination, updated_at FROM vessels ORDER BY updated_at DESC LIMIT 10"
  ).all();

  res.json({
    total: allVessels.length,
    moving: moving.length,
    anchored: anchored.length,
    recentCount: recentVessels.length,
    vesselOfDay,
    recentActivity,
  });
});

// Port Pulse — recent arrivals and departures
app.get('/api/port-pulse', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const visits = getRecentVisits(db, limit);
  res.json(visits);
});

// Vessel visit history
app.get('/api/vessels/:mmsi/visits', (req, res) => {
  const visits = getVesselVisitHistory(db, req.params.mmsi);
  const archive = db.prepare('SELECT * FROM vessel_archive WHERE mmsi = ?').get(req.params.mmsi);
  res.json({ archive, visits });
});

// Archive stats — overall port statistics
app.get('/api/archive-stats', (req, res) => {
  const stats = getArchiveStats(db);
  res.json(stats);
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track connected browser clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  // Send snapshot of all current vessels
  const vessels = getVesselsByArea(db);
  ws.send(JSON.stringify({ type: 'snapshot', vessels }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// ── Arrival/Departure Detection ──
// Track recently seen vessels to detect new arrivals
const recentlySeenMMSIs = new Set();

// On startup, populate from current vessels table
for (const v of getVesselsByArea(db)) {
  recentlySeenMMSIs.add(v.mmsi);
}
console.log(`[Visits] Loaded ${recentlySeenMMSIs.size} known vessels`);

function detectArrival(db, vessel) {
  if (!vessel.mmsi || !vessel.name) return;
  const isNew = !recentlySeenMMSIs.has(vessel.mmsi);
  recentlySeenMMSIs.add(vessel.mmsi);

  // Update permanent archive
  upsertArchive(db, vessel);

  if (isNew) {
    incrementVisitCount(db, vessel.mmsi);
    logVisit(db, {
      mmsi: vessel.mmsi,
      name: vessel.name,
      vessel_type_label: vessel.vessel_type_label || null,
      flag_country: vessel.flag_country || null,
      length: vessel.length || null,
      width: vessel.width || null,
      event: 'arrival',
      timestamp: new Date().toISOString(),
      destination: vessel.destination || null,
    });
    console.log(`[Visits] ARRIVAL: ${vessel.name} (${vessel.mmsi})`);
    broadcast({ type: 'arrival', vessel });
  }
}

// Check for departures every 15 minutes
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const staleVessels = db.prepare(
    "SELECT * FROM vessels WHERE updated_at < ? AND speed > 0.5"
  ).all(oneHourAgo);

  for (const v of staleVessels) {
    if (recentlySeenMMSIs.has(v.mmsi) && v.name) {
      logVisit(db, {
        mmsi: v.mmsi,
        name: v.name,
        vessel_type_label: v.vessel_type_label || null,
        flag_country: v.flag_country || null,
        length: v.length || null,
        width: v.width || null,
        event: 'departure',
        timestamp: new Date().toISOString(),
        destination: v.destination || null,
      });
      console.log(`[Visits] DEPARTURE: ${v.name} (${v.mmsi})`);
      broadcast({ type: 'departure', vessel: v });
    }
    recentlySeenMMSIs.delete(v.mmsi);
  }
}, 15 * 60 * 1000);

// RTL-SDR feed via /api/ais-feed is the only data source
console.log('[AIS] Using RTL-SDR feed via /api/ais-feed');

function getVesselFromDb(db, mmsi) {
  return db.prepare('SELECT * FROM vessels WHERE mmsi = ?').get(mmsi) || {};
}

// Cleanup — prune stale vessels from live map, compress old positions to hourly summaries
startCleanup(db, pruneOldData, compressPositions);

// Start
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
