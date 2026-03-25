import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData } from './db.js';
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
      broadcast({ type: 'update', vessel: { ...vessel, ...getVesselFromDb(db, parsed.mmsi) } });
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

  const name = (msg.shipname || msg.name || '').trim() || null;
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

// AIS stream (optional — RTL-SDR feed via /api/ais-feed is the primary source)
if (API_KEY) {
  console.log('[AIS] Connecting to aisstream.io as secondary source...');
  connectAisStream(API_KEY, (parsed) => {
  const vessel = { mmsi: parsed.mmsi, updated_at: parsed.updated_at };

  if (parsed.name) vessel.name = parsed.name;
  if (parsed.flag_country) vessel.flag_country = parsed.flag_country;

  if (parsed.type === 'position') {
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

  if (parsed.type === 'static') {
    Object.assign(vessel, {
      imo: parsed.imo, call_sign: parsed.call_sign,
      vessel_type: parsed.vessel_type, vessel_type_label: parsed.vessel_type_label,
      length: parsed.length, width: parsed.width, draught: parsed.draught,
      destination: parsed.destination, eta: parsed.eta,
    });
  }

  upsertVessel(db, vessel);

  // Broadcast full vessel record to browser clients
  broadcast({ type: 'update', vessel: { ...vessel, ...getVesselFromDb(db, parsed.mmsi) } });
  });
} else {
  console.log('[AIS] No AISSTREAM_API_KEY — using RTL-SDR feed via /api/ais-feed only');
}

function getVesselFromDb(db, mmsi) {
  return db.prepare('SELECT * FROM vessels WHERE mmsi = ?').get(mmsi) || {};
}

// Cleanup
startCleanup(db, pruneOldData);

// Start
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
