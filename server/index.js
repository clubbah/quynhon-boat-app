import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData,
  upsertArchive, incrementVisitCount, logVisit, getVesselVisitHistory,
  getArchiveStats, getPortTrends, compressPositions, pruneSummaries } from './db.js';
import { connectAisStream } from './ais-client.js';
import { parseAisCatcherMessage, isWithinBounds, isNonVesselMmsi, QN_BOUNDS } from './ais-parser.js';
import { startCleanup } from './cleanup.js';
import { startHealthMonitor, getHealthSnapshot } from './health-monitor.js';
import { startStormMonitor, getStormSnapshot, peekStormSnapshot, buildDemoSnapshot } from './storm-monitor.js';
import { canonicalRedirect } from './canonical.js';
import { isFishingGear, withClass } from './vessel-class.js';
import { createVisitTracker } from './visits.js';
import { fetchWeather, peekWeather, startWeatherRefresh } from './weather.js';
import { computePortStats, getPortPulse } from './port-data.js';
import { createPageRenderer, VIEWS_DIR } from './render.js';
import { resolvePath, PAGES } from './routes.js';
import { buildSitemap } from './sitemap.js';
import fs from 'fs';

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
// DB_PATH lets a local run point at a copy of the production database.
const db = createDb(process.env.DB_PATH || path.join(__dirname, '..', 'vessels.db'));

// MMSIs classed as fishing gear, from the permanent archive. Used to keep gear
// out of stored history (Port Pulse, trends) whose rows lack the fields the
// classifier needs. Rebuilt at most every 10 minutes.
let gearCache = { set: new Set(), builtAt: 0 };
function gearMmsis() {
  if (Date.now() - gearCache.builtAt > 10 * 60 * 1000) {
    const set = new Set();
    for (const r of db.prepare('SELECT mmsi, name, call_sign, imo, vessel_type FROM vessel_archive').all()) {
      if (isFishingGear(r)) set.add(r.mmsi);
    }
    gearCache = { set, builtAt: Date.now() };
  }
  return gearCache.set;
}

// Express
const app = express();

// http:// and www. page requests -> https://quynhonlife.com (see canonical.js
// for why this never touches /api/, static files, or X-Forwarded-Proto).
app.use(canonicalRedirect);

// ── Server-rendered pages ──
// Home, /storms, /trends and /spot in five languages (/, /vi/, /ko/storms ...).
// Each render reads only memory caches and SQLite, never an outside service,
// and is cached per language for 60s. See render.js and routes.js.
const pages = createPageRenderer({
  stats: () => computePortStats(db),
  pulse: () => getPortPulse(db, gearMmsis(), 10),
  archive: () => getArchiveStats(db, gearMmsis()),
  trends: () => getPortTrends(db, gearMmsis()),
  weather: peekWeather,
  storm: peekStormSnapshot,
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const route = resolvePath(req.path);
  if (!route) return next();
  if (route.redirect) {
    const q = req.originalUrl.indexOf('?');
    return res.redirect(301, route.redirect + (q >= 0 ? req.originalUrl.slice(q) : ''));
  }
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(pages.get(route.page, route.lang));
});

// Generated so it always lists every language address (see sitemap.js).
function isoDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
function fileDay(file) { try { return isoDay(fs.statSync(file).mtimeMs); } catch { return null; } }
app.get('/sitemap.xml', (req, res) => {
  const pub = (f) => path.join(__dirname, '..', 'public', f);
  const view = (f) => path.join(VIEWS_DIR, f);
  // Home and trends change whenever the antenna hears a ship; storms whenever
  // the tracker last checked; the others when their files last changed.
  let lastData = null;
  try { lastData = db.prepare('SELECT MAX(updated_at) AS t FROM vessels').get()?.t; } catch { /* empty db */ }
  const dataDay = lastData ? isoDay(Date.parse(lastData)) : fileDay(view(PAGES.home.view));
  const storm = peekStormSnapshot();
  res.type('application/xml');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(buildSitemap({
    home: dataDay,
    trends: dataDay,
    storms: storm?.updatedAt ? isoDay(Date.parse(storm.updatedAt)) : fileDay(view(PAGES.storms.view)),
    spot: fileDay(view(PAGES.spot.view)),
    '/privacy': fileDay(pub('privacy.html')),
    '/terms': fileDay(pub('terms.html')),
  }));
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// English-only static pages with clean URLs
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});
app.get('/status', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(__dirname, '..', 'public', 'status.html'));
});

// Health/status endpoint (used by status page + external monitoring)
app.get('/api/status', (req, res) => {
  const snapshot = getHealthSnapshot(db, feedStats);
  res.json(snapshot);
});

// All vessels as JSON (for spot feature). Each row carries is_gear.
app.get('/api/vessels', (req, res) => {
  res.json(getVesselsByArea(db).map(withClass));
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
    // diagnostics), not every request — that floods the logs and disk. The
    // phone sends an envelope with msgs[], so also log one full message: the
    // envelope alone used up the 500 characters before any message fields.
    if (feedStats.totalRequests === 1) {
      console.log('[AIS-Feed] First payload sample:', JSON.stringify(raw).substring(0, 500));
      const one = Array.isArray(raw) ? raw[0] : (raw?.msgs?.[0] ?? raw?.values?.[0]);
      if (one) console.log('[AIS-Feed] First message in full:', JSON.stringify(one));
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
        broadcast({ type: 'update', vessel: withClass(fullVessel) });
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

// Weather + marine data (cached and kept warm by weather.js, 15 min TTL)
app.get('/api/weather', async (req, res) => {
  const data = await fetchWeather();
  if (data) {
    res.json(data);
  } else {
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

// Active tropical cyclones near Quy Nhon (cached, refreshed by the storm monitor).
// ?demo=warning|watch|monitor returns a synthetic storm for previewing the banner
// and map when nothing is live — it bypasses the cache and never affects real data.
app.get('/api/storms', async (req, res) => {
  const demo = req.query.demo;
  if (demo) {
    const sample = buildDemoSnapshot(String(demo));
    if (sample) return res.json(sample);
    return res.status(400).json({ error: 'Unknown demo level' });
  }
  const data = await getStormSnapshot();
  if (data) {
    res.json(data);
  } else {
    res.status(503).json({ error: 'Storm data unavailable' });
  }
});

// Port stats: counts, largest vessel, recent activity (see port-data.js)
app.get('/api/port-stats', (req, res) => {
  res.json(computePortStats(db));
});

// Port Pulse: recent arrivals and departures
app.get('/api/port-pulse', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  res.json(getPortPulse(db, gearMmsis(), limit));
});

// Vessel visit history
app.get('/api/vessels/:mmsi/visits', (req, res) => {
  const visits = getVesselVisitHistory(db, req.params.mmsi);
  const archive = db.prepare('SELECT * FROM vessel_archive WHERE mmsi = ?').get(req.params.mmsi);
  res.json({ archive, visits });
});

// Archive stats — overall port statistics
app.get('/api/archive-stats', (req, res) => {
  const stats = getArchiveStats(db, gearMmsis());
  res.json(stats);
});

// Port trends — aggregate statistics for the "Port in Numbers" page
app.get('/api/port-trends', (req, res) => {
  res.json(getPortTrends(db, gearMmsis()));
});

// Quietly handle client-aborted request bodies. Flaky relays and internet
// scanners disconnect mid-POST, which raw-body surfaces as "request aborted";
// it isn't actionable and was spamming the error log.
app.use((err, req, res, next) => {
  if (err && (err.type === 'request.aborted' || err.code === 'ECONNABORTED' || err.message === 'request aborted')) {
    if (!res.headersSent) res.status(400).end();
    return;
  }
  console.error('[HTTP] Unhandled error:', err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Track connected browser clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  // Send snapshot of all current vessels (each with is_gear)
  const vessels = getVesselsByArea(db).map(withClass);
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
// See visits.js for the model: one 6-hour silence gap drives both events,
// fishing gear is excluded, and departures wait out receiver outages.
const visits = createVisitTracker(db);
console.log(`[Visits] Restored ${visits.seed()} ships heard in the last 6 hours`);

// Throttle archive writes: mmsi -> last write time (ms)
const lastArchiveWrite = new Map();
const ARCHIVE_MIN_INTERVAL = 60 * 60 * 1000; // 1h

function detectArrival(db, vessel) {
  if (!vessel.mmsi || !vessel.name) return;
  // Must run before upsertArchive below, which overwrites last_seen.
  const isArrival = visits.observe(vessel);

  // Update permanent archive (gear included: it is the registry of everything
  // heard), throttled to arrival-or-hourly to avoid write amplification.
  const now = Date.now();
  if (isArrival || (now - (lastArchiveWrite.get(vessel.mmsi) || 0)) > ARCHIVE_MIN_INTERVAL) {
    upsertArchive(db, vessel);
    lastArchiveWrite.set(vessel.mmsi, now);
  }

  if (isArrival) {
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
    broadcast({ type: 'arrival', vessel: withClass(vessel) });
  }
}

// Check for departures every 10 minutes. "Feed healthy" means vessel data was
// processed in the last 15 minutes (from the antenna or the aisstream backup).
setInterval(() => {
  const last = feedStats.lastProcessedAt ? Date.parse(feedStats.lastProcessedAt) : 0;
  const feedHealthy = Date.now() - last < 15 * 60 * 1000;
  for (const v of visits.checkDepartures(feedHealthy)) {
    logVisit(db, {
      mmsi: v.mmsi,
      name: v.name,
      vessel_type_label: v.vessel_type_label,
      flag_country: v.flag_country,
      length: v.length,
      width: v.width,
      event: 'departure',
      timestamp: v.departedAt,
      destination: v.destination,
    });
    console.log(`[Visits] DEPARTURE: ${v.name} (${v.mmsi}), last heard ${v.departedAt}`);
    broadcast({ type: 'departure', vessel: v });
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
    broadcast({ type: 'update', vessel: withClass(full) });
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
startCleanup(db, pruneOldData, compressPositions, 10 * 60 * 1000, pruneSummaries);

// Health monitor — alerts when AIS feed goes stale
startHealthMonitor(db, feedStats);

// Storm monitor — tracks tropical cyclones near Quy Nhon for the storm page + banner
startStormMonitor();

// Weather — fill the cache at boot and keep it warm for page renders
startWeatherRefresh();

// Start
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
