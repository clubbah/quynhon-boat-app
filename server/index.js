import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData } from './db.js';
import { connectAisStream } from './ais-client.js';
import { startCleanup } from './cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AISSTREAM_API_KEY;

if (!API_KEY) {
  console.error('Missing AISSTREAM_API_KEY in environment');
  process.exit(1);
}

// Database
const db = createDb(path.join(__dirname, '..', 'vessels.db'));

// Express
const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/vessels/:mmsi/track', (req, res) => {
  const track = getTrack(db, req.params.mmsi);
  res.json(track);
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

// AIS stream
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

function getVesselFromDb(db, mmsi) {
  return db.prepare('SELECT * FROM vessels WHERE mmsi = ?').get(mmsi) || {};
}

// Cleanup
startCleanup(db, pruneOldData);

// Start
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});
