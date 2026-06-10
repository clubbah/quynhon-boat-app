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
import { parseAisCatcherMessage, isWithinBounds, isNonVesselMmsi, QN_BOUNDS } from './ais-parser.js';
import { startCleanup } from './cleanup.js';
import { startHealthMonitor, getHealthSnapshot } from './health-monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AISSTREAM_API_KEY;

// Feed auth accepts a comma-separated list of secrets so the secret can be
// rotated with zero downtime: set AIS_FEED_SECRET="new,old", cut the antenna
// over to "new", then drop "old". Empty list = open (dev only).
const AIS_FEED_SECRETS = (process.env.AIS_FEED_SECRET || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
function isValidFeedSecret(token) {
  return AIS_FEED_SECRETS.length === 0 || AIS_FEED_SECRETS.includes(token);
}

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
app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'status.html'));
});

// Health/status endpoint (used by status page + external monitoring)
app.get('/api/status', (req, res) => {
  const snapshot = getHealthSnapshot(db, feedStats);
  res.json(snapshot);
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

// Track relay activity (separate from DB updated_at — answers
// "is the relay still POSTing?" which is the real question for monitoring)
export const feedStats = {
  lastReceivedAt: null,       // when did /api/ais-feed last get a request
  lastProcessedAt: null,      // when did we last successfully upsert at least 1 vessel
  totalRequests: 0,
  totalVesselsProcessed: 0,
};

// Rate limit: cap authenticated feed requests so a leaked secret or a runaway
// relay can't flood the DB with writes. The legit relay posts ~12x/min; this
// allows generous headroom. Only counts requests that pass the secret check.
let feedWindow = { count: 0, resetAt: 0 };
const FEED_MAX_PER_MIN = 300;
function feedRateLimited() {
  const now = Date.now();
  if (now > feedWindow.resetAt) feedWindow = { count: 0, resetAt: now + 60000 };
  feedWindow.count++;
  return feedWindow.count > FEED_MAX_PER_MIN;
}

// AIS-catcher HTTP feed endpoint
function handleAisFeed(req, res) {
  const token = req.params.key || req.headers['x-ais-secret'];
  if (!isValidFeedSecret(token)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (feedRateLimited()) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  feedStats.lastReceivedAt = new Date().toISOString();
  feedStats.totalRequests++;

  try {
    const raw = req.body;
    // Log the payload shape only for the first request after startup (format
    // diagnostics), not every request — that floods the logs and disk.
    if (feedStats.totalRequests === 1) {
      console.log('[AIS-Feed] First payload sample:', JSON.stringify(raw).substring(0, 500));
    }

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

    if (count > 0) {
      feedStats.lastProcessedAt = new Date().toISOString();
      feedStats.totalVesselsProcessed += count;
    } else {
      // Diagnostic: feed received but nothing parseable
      const rawSample = Array.isArray(raw) ? raw[0] : raw;
      console.warn('[AIS-Feed] WARNING: 0 vessels parsed from', messages.length, 'messages. Sample MMSI:', rawSample?.mmsi, 'shiptype:', rawSample?.shiptype, 'name:', rawSample?.shipname);
    }

    res.json({ ok: true, processed: count });
  } catch (err) {
    console.error('[AIS-Feed] Error:', err.message);
    res.status(400).json({ error: err.message });
  }
}
app.post('/api/ais-feed', handleAisFeed);
app.post('/api/ais-feed/:key', handleAisFeed);

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
// Throttle archive writes: mmsi -> last write time (ms)
const lastArchiveWrite = new Map();
const ARCHIVE_MIN_INTERVAL = 60 * 60 * 1000; // 1h

// On startup, populate from current vessels table
for (const v of getVesselsByArea(db)) {
  recentlySeenMMSIs.add(v.mmsi);
}
console.log(`[Visits] Loaded ${recentlySeenMMSIs.size} known vessels`);

function detectArrival(db, vessel) {
  if (!vessel.mmsi || !vessel.name) return;
  const isNew = !recentlySeenMMSIs.has(vessel.mmsi);
  recentlySeenMMSIs.add(vessel.mmsi);

  // Update permanent archive, but throttle to arrival-or-hourly. Writing on
  // every message (~60 vessels x 60s) was needless write amplification.
  const now = Date.now();
  if (isNew || (now - (lastArchiveWrite.get(vessel.mmsi) || 0)) > ARCHIVE_MIN_INTERVAL) {
    upsertArchive(db, vessel);
    lastArchiveWrite.set(vessel.mmsi, now);
  }

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

// Check for departures every 10 minutes. A vessel that hasn't reported for an
// hour has left the antenna's range (or port). Previously this required
// speed > 0.5, which silently skipped every anchored vessel that departed.
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const staleVessels = db.prepare(
    "SELECT * FROM vessels WHERE updated_at < ?"
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
    lastArchiveWrite.delete(v.mmsi); // free memory for departed vessels
  }
}, 10 * 60 * 1000);

function getVesselFromDb(db, mmsi) {
  return db.prepare('SELECT * FROM vessels WHERE mmsi = ?').get(mmsi) || {};
}

// ── aisstream.io failover ──
// The RTL-SDR antenna is a single point of failure (laptop sleeps, wifi drops).
// When the primary feed goes quiet for FAILOVER_AFTER_MIN, connect aisstream.io
// as a backup source; disconnect again once the antenna recovers, to conserve
// the free-tier quota and avoid double-counting positions.
console.log('[AIS] Primary source: RTL-SDR feed via /api/ais-feed');
const FAILOVER_AFTER_MIN = 5;
let aisStreamHandle = null;

function ingestVessel(parsed) {
  // Accept backup data only while the primary feed is genuinely stale. The
  // moment a real RTL-SDR POST resumes, ignore aisstream so positions aren't
  // double-counted (manageFailover then tears down the connection within 60s).
  const lastFeed = feedStats.lastReceivedAt ? new Date(feedStats.lastReceivedAt).getTime() : 0;
  if (feedStats.lastReceivedAt && (Date.now() - lastFeed) / 60000 < FAILOVER_AFTER_MIN) return;
  if (!parsed || !parsed.mmsi) return;
  if (isNonVesselMmsi(parsed.mmsi)) return;
  if (parsed.lat != null && parsed.lng != null && !isWithinBounds(parsed.lat, parsed.lng)) return;

  const vessel = { mmsi: parsed.mmsi, updated_at: parsed.updated_at || new Date().toISOString() };
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
      speed: parsed.speed, course: parsed.course, timestamp: vessel.updated_at,
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
  const full = getVesselFromDb(db, parsed.mmsi);
  if (full && full.lat != null) {
    detectArrival(db, full);
    broadcast({ type: 'update', vessel: full });
  }
  feedStats.lastProcessedAt = new Date().toISOString();
}

function manageFailover() {
  if (!API_KEY) return; // no aisstream key configured — can't fail over
  const lastFeed = feedStats.lastReceivedAt ? new Date(feedStats.lastReceivedAt).getTime() : 0;
  const minsSince = (Date.now() - lastFeed) / 60000;
  const primaryStale = !feedStats.lastReceivedAt || minsSince >= FAILOVER_AFTER_MIN;

  if (primaryStale && !aisStreamHandle) {
    console.log(`[Failover] Primary feed stale (${Math.round(minsSince)}m). Activating aisstream.io backup.`);
    aisStreamHandle = connectAisStream(
      API_KEY,
      (parsed) => { if (aisStreamHandle) ingestVessel(parsed); },
      [[QN_BOUNDS.minLat, QN_BOUNDS.minLng], [QN_BOUNDS.maxLat, QN_BOUNDS.maxLng]],
    );
  } else if (!primaryStale && aisStreamHandle) {
    console.log('[Failover] Primary feed restored. Stopping aisstream.io backup.');
    aisStreamHandle.stop();
    aisStreamHandle = null;
  }
}
setInterval(manageFailover, 60 * 1000);

// Cleanup — prune stale vessels from live map, compress old positions to hourly summaries
startCleanup(db, pruneOldData, compressPositions);

// Health monitor — alerts when AIS feed goes stale
startHealthMonitor(db, feedStats);

// Start
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
