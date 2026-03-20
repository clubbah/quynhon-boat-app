# Quy Nhon Vessel Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time vessel tracking web app for Quy Nhon, Vietnam that shows live ship positions on an interactive map with detailed vessel info and movement tracks.

**Architecture:** Node.js backend connects to aisstream.io WebSocket for live AIS data, persists vessel state and position history in SQLite, and relays updates to browser clients via its own WebSocket server. Vanilla frontend with Leaflet map.

**Tech Stack:** Node.js, Express, ws, better-sqlite3, Leaflet, OpenStreetMap tiles, vanilla HTML/CSS/JS

**Spec:** `docs/superpowers/specs/2026-03-20-quy-nhon-vessel-tracker-design.md`

---

## File Structure

```
quynhon-boat-app/
├── package.json
├── .env.example                  # AISSTREAM_API_KEY placeholder
├── .gitignore
├── server/
│   ├── index.js                  # Express + WebSocket server entry point
│   ├── db.js                     # SQLite schema init + query helpers
│   ├── ais-client.js             # aisstream.io WebSocket client + message parser
│   ├── ais-types.js              # Vessel type codes → labels/colors, nav status codes → labels
│   └── cleanup.js                # Periodic cleanup of old data
├── public/
│   ├── index.html                # Single page app shell
│   ├── css/
│   │   └── style.css             # All styles (map, panel, top bar, responsive)
│   └── js/
│       ├── app.js                # Main entry: init map, connect WebSocket, wire events
│       ├── map.js                # Leaflet map setup, marker management, track rendering
│       ├── panel.js              # Info panel rendering (essential + expanded views)
│       ├── i18n.js               # EN/VI translations + language toggle logic
│       └── vessel-icons.js       # SVG arrow icon generation, color-coded by type
├── tests/
│   ├── db.test.js                # Database operations
│   ├── ais-client.test.js        # AIS message parsing
│   ├── ais-types.test.js         # Type/status code mapping
│   └── cleanup.test.js           # Cleanup logic
└── docs/
    └── superpowers/
        ├── specs/...
        └── plans/...
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

```bash
cd "C:/Users/clubb/Desktop/Claude Cowork/quynhon-boat-app"
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express ws better-sqlite3 dotenv
npm install --save-dev vitest
```

- [ ] **Step 3: Create .env.example**

```
AISSTREAM_API_KEY=your_api_key_here
PORT=3000
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.env
*.db
```

- [ ] **Step 5: Update package.json scripts**

Add `"type": "module"` and update `scripts`:
```json
{
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore: scaffold project with dependencies"
```

---

## Task 2: AIS Type Mappings

**Files:**
- Create: `server/ais-types.js`
- Create: `tests/ais-types.test.js`

- [ ] **Step 1: Write failing tests for vessel type mapping**

Create `tests/ais-types.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { getVesselTypeLabel, getVesselTypeColor, getNavStatusLabel, getFlagCountry } from '../server/ais-types.js';

describe('getVesselTypeLabel', () => {
  it('maps cargo type codes to "Cargo"', () => {
    expect(getVesselTypeLabel(70)).toBe('Cargo');
    expect(getVesselTypeLabel(79)).toBe('Cargo');
  });

  it('maps tanker type codes to "Tanker"', () => {
    expect(getVesselTypeLabel(80)).toBe('Tanker');
    expect(getVesselTypeLabel(89)).toBe('Tanker');
  });

  it('maps passenger type codes to "Passenger"', () => {
    expect(getVesselTypeLabel(60)).toBe('Passenger');
    expect(getVesselTypeLabel(69)).toBe('Passenger');
  });

  it('maps fishing type code to "Fishing"', () => {
    expect(getVesselTypeLabel(30)).toBe('Fishing');
  });

  it('returns "Other" for unknown codes', () => {
    expect(getVesselTypeLabel(0)).toBe('Other');
    expect(getVesselTypeLabel(999)).toBe('Other');
    expect(getVesselTypeLabel(undefined)).toBe('Other');
  });
});

describe('getVesselTypeColor', () => {
  it('returns blue for cargo', () => {
    expect(getVesselTypeColor(70)).toBe('#2563eb');
  });

  it('returns red for tanker', () => {
    expect(getVesselTypeColor(80)).toBe('#dc2626');
  });

  it('returns green for passenger', () => {
    expect(getVesselTypeColor(60)).toBe('#16a34a');
  });

  it('returns yellow for fishing', () => {
    expect(getVesselTypeColor(30)).toBe('#ca8a04');
  });

  it('returns gray for unknown', () => {
    expect(getVesselTypeColor(0)).toBe('#6b7280');
  });
});

describe('getNavStatusLabel', () => {
  it('maps status 0 to "Under Way Using Engine"', () => {
    expect(getNavStatusLabel(0)).toBe('Under Way Using Engine');
  });

  it('maps status 1 to "At Anchor"', () => {
    expect(getNavStatusLabel(1)).toBe('At Anchor');
  });

  it('maps status 5 to "Moored"', () => {
    expect(getNavStatusLabel(5)).toBe('Moored');
  });

  it('returns "Unknown" for undefined status', () => {
    expect(getNavStatusLabel(99)).toBe('Unknown');
    expect(getNavStatusLabel(undefined)).toBe('Unknown');
  });
});

describe('getFlagCountry', () => {
  it('maps Vietnamese MMSI to Vietnam', () => {
    expect(getFlagCountry('574001234')).toBe('Vietnam');
  });

  it('maps Panamanian MMSI to Panama', () => {
    expect(getFlagCountry('351234567')).toBe('Panama');
  });

  it('returns null for unknown MID', () => {
    expect(getFlagCountry('999000000')).toBeNull();
  });

  it('returns null for null/short MMSI', () => {
    expect(getFlagCountry(null)).toBeNull();
    expect(getFlagCountry('12')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/ais-types.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ais-types.js**

Create `server/ais-types.js`:
```js
// AIS vessel type code ranges → human labels
// Reference: https://api.vtexplorer.com/docs/ref-aistypes.html
const VESSEL_TYPE_RANGES = [
  { min: 20, max: 29, label: 'Wing in Ground' },
  { min: 30, max: 30, label: 'Fishing' },
  { min: 31, max: 32, label: 'Towing' },
  { min: 33, max: 33, label: 'Dredging' },
  { min: 34, max: 34, label: 'Diving' },
  { min: 35, max: 35, label: 'Military' },
  { min: 36, max: 36, label: 'Sailing' },
  { min: 37, max: 37, label: 'Pleasure Craft' },
  { min: 40, max: 49, label: 'High Speed Craft' },
  { min: 50, max: 50, label: 'Pilot Vessel' },
  { min: 51, max: 51, label: 'Search and Rescue' },
  { min: 52, max: 52, label: 'Tug' },
  { min: 53, max: 53, label: 'Port Tender' },
  { min: 55, max: 55, label: 'Law Enforcement' },
  { min: 58, max: 58, label: 'Medical Transport' },
  { min: 60, max: 69, label: 'Passenger' },
  { min: 70, max: 79, label: 'Cargo' },
  { min: 80, max: 89, label: 'Tanker' },
  { min: 90, max: 99, label: 'Other' },
];

// Label → marker color
const TYPE_COLORS = {
  'Cargo': '#2563eb',
  'Tanker': '#dc2626',
  'Passenger': '#16a34a',
  'Fishing': '#ca8a04',
};
const DEFAULT_COLOR = '#6b7280';

// AIS navigational status codes
const NAV_STATUS = {
  0: 'Under Way Using Engine',
  1: 'At Anchor',
  2: 'Not Under Command',
  3: 'Restricted Manoeuvrability',
  4: 'Constrained by Draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in Fishing',
  8: 'Under Way Sailing',
  9: 'Reserved (HSC)',
  10: 'Reserved (WIG)',
  14: 'AIS-SART',
};

// MMSI Maritime Identification Digits → country (common ones in SE Asia + major flags)
const MID_COUNTRY = {
  '574': 'Vietnam', '416': 'Taiwan', '412': 'China', '413': 'China',
  '414': 'China', '431': 'Japan', '432': 'Japan', '440': 'South Korea',
  '441': 'South Korea', '525': 'Indonesia', '548': 'Philippines',
  '533': 'Malaysia', '563': 'Singapore', '567': 'Thailand',
  '351': 'Panama', '352': 'Panama', '353': 'Panama',
  '354': 'Panama', '355': 'Panama', '356': 'Panama', '357': 'Panama',
  '370': 'Panama', '371': 'Panama', '372': 'Panama', '373': 'Panama',
  '374': 'Panama', '375': 'Panama', '376': 'Panama', '377': 'Panama',
  '378': 'Panama', '379': 'Panama',
  '636': 'Liberia', '637': 'Liberia',
  '538': 'Marshall Islands',
  '256': 'Malta', '229': 'Malta', '249': 'Malta',
  '209': 'Bahamas', '311': 'Bahamas',
  '477': 'Hong Kong',
  '319': 'Cayman Islands',
  '218': 'Germany', '211': 'Germany',
  '244': 'Netherlands', '245': 'Netherlands', '246': 'Netherlands',
  '235': 'United Kingdom', '232': 'United Kingdom',
  '338': 'United States', '303': 'United States',
  '226': 'France', '227': 'France', '228': 'France',
  '247': 'Italy',
  '220': 'Denmark',
  '230': 'Finland', '231': 'Finland',
  '257': 'Norway', '258': 'Norway', '259': 'Norway',
  '265': 'Sweden', '266': 'Sweden',
  '273': 'Russia',
  '512': 'New Zealand',
  '503': 'Australia',
  '419': 'India',
};

export function getFlagCountry(mmsi) {
  if (!mmsi || mmsi.length < 3) return null;
  const mid = mmsi.substring(0, 3);
  return MID_COUNTRY[mid] || null;
}

export function getVesselTypeLabel(code) {
  if (code == null) return 'Other';
  const match = VESSEL_TYPE_RANGES.find(r => code >= r.min && code <= r.max);
  return match ? match.label : 'Other';
}

export function getVesselTypeColor(code) {
  const label = getVesselTypeLabel(code);
  return TYPE_COLORS[label] || DEFAULT_COLOR;
}

export function getNavStatusLabel(code) {
  if (code == null) return 'Unknown';
  return NAV_STATUS[code] || 'Unknown';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/ais-types.test.js
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/ais-types.js tests/ais-types.test.js
git commit -m "feat: add AIS vessel type and nav status mappings"
```

---

## Task 3: SQLite Database Layer

**Files:**
- Create: `server/db.js`
- Create: `tests/db.test.js`

- [ ] **Step 1: Write failing tests for database operations**

Create `tests/db.test.js`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData } from '../server/db.js';

let db;

beforeEach(() => {
  db = createDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('upsertVessel', () => {
  it('inserts a new vessel', () => {
    upsertVessel(db, {
      mmsi: '123456789',
      name: 'Test Ship',
      vessel_type: 70,
      vessel_type_label: 'Cargo',
      lat: 13.76,
      lng: 109.23,
      speed: 5.2,
      course: 180,
      heading: 179,
      nav_status: 0,
      nav_status_label: 'Under Way Using Engine',
      updated_at: new Date().toISOString(),
    });

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].mmsi).toBe('123456789');
    expect(vessels[0].name).toBe('Test Ship');
  });

  it('updates existing vessel on re-insert', () => {
    const base = {
      mmsi: '123456789',
      name: 'Test Ship',
      vessel_type: 70,
      vessel_type_label: 'Cargo',
      lat: 13.76,
      lng: 109.23,
      speed: 5.2,
      course: 180,
      heading: 179,
      nav_status: 0,
      nav_status_label: 'Under Way Using Engine',
      updated_at: new Date().toISOString(),
    };

    upsertVessel(db, base);
    upsertVessel(db, { ...base, speed: 10.0, name: 'Updated Ship' });

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].speed).toBe(10.0);
    expect(vessels[0].name).toBe('Updated Ship');
  });
});

describe('appendPosition + getTrack', () => {
  it('stores and retrieves position history', () => {
    appendPosition(db, { mmsi: '123', lat: 13.76, lng: 109.23, speed: 5, course: 180, timestamp: '2026-03-20T10:00:00Z' });
    appendPosition(db, { mmsi: '123', lat: 13.77, lng: 109.24, speed: 6, course: 185, timestamp: '2026-03-20T10:05:00Z' });

    const track = getTrack(db, '123');
    expect(track).toHaveLength(2);
    expect(track[0].lat).toBe(13.76);
    expect(track[1].lat).toBe(13.77);
  });
});

describe('pruneOldData', () => {
  it('removes position history older than maxAgeMs', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7 hours ago
    const recent = new Date().toISOString();

    appendPosition(db, { mmsi: '123', lat: 13.76, lng: 109.23, speed: 5, course: 180, timestamp: old });
    appendPosition(db, { mmsi: '123', lat: 13.77, lng: 109.24, speed: 6, course: 185, timestamp: recent });

    pruneOldData(db, 6 * 60 * 60 * 1000); // 6 hours

    const track = getTrack(db, '123');
    expect(track).toHaveLength(1);
    expect(track[0].lat).toBe(13.77);
  });

  it('removes vessels not updated within maxAgeMs', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    upsertVessel(db, {
      mmsi: '123', name: 'Old Ship', vessel_type: 70, vessel_type_label: 'Cargo',
      lat: 13.76, lng: 109.23, speed: 0, course: 0, heading: 0,
      nav_status: 5, nav_status_label: 'Moored', updated_at: old,
    });

    pruneOldData(db, 6 * 60 * 60 * 1000);

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/db.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement db.js**

Create `server/db.js`:
```js
import Database from 'better-sqlite3';

export function createDb(path = './vessels.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS vessels (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      call_sign TEXT,
      vessel_type INTEGER,
      vessel_type_label TEXT,
      flag_country TEXT,
      length REAL,
      width REAL,
      draught REAL,
      destination TEXT,
      eta TEXT,
      lat REAL,
      lng REAL,
      speed REAL,
      course REAL,
      heading REAL,
      nav_status INTEGER,
      nav_status_label TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS position_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mmsi TEXT,
      lat REAL,
      lng REAL,
      speed REAL,
      course REAL,
      timestamp TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pos_mmsi_ts ON position_history(mmsi, timestamp);
  `);

  return db;
}

const VESSEL_COLUMNS = [
  'mmsi', 'imo', 'name', 'call_sign', 'vessel_type', 'vessel_type_label',
  'flag_country', 'length', 'width', 'draught', 'destination', 'eta',
  'lat', 'lng', 'speed', 'course', 'heading', 'nav_status', 'nav_status_label', 'updated_at',
];

export function upsertVessel(db, v) {
  // Ensure all columns are present (default to null) so better-sqlite3 named params don't throw
  const row = {};
  for (const col of VESSEL_COLUMNS) {
    row[col] = v[col] !== undefined ? v[col] : null;
  }

  const stmt = db.prepare(`
    INSERT INTO vessels (mmsi, imo, name, call_sign, vessel_type, vessel_type_label,
      flag_country, length, width, draught, destination, eta,
      lat, lng, speed, course, heading, nav_status, nav_status_label, updated_at)
    VALUES (@mmsi, @imo, @name, @call_sign, @vessel_type, @vessel_type_label,
      @flag_country, @length, @width, @draught, @destination, @eta,
      @lat, @lng, @speed, @course, @heading, @nav_status, @nav_status_label, @updated_at)
    ON CONFLICT(mmsi) DO UPDATE SET
      imo = COALESCE(@imo, imo),
      name = COALESCE(@name, name),
      call_sign = COALESCE(@call_sign, call_sign),
      vessel_type = COALESCE(@vessel_type, vessel_type),
      vessel_type_label = COALESCE(@vessel_type_label, vessel_type_label),
      flag_country = COALESCE(@flag_country, flag_country),
      length = COALESCE(@length, length),
      width = COALESCE(@width, width),
      draught = COALESCE(@draught, draught),
      destination = COALESCE(@destination, destination),
      eta = COALESCE(@eta, eta),
      lat = COALESCE(@lat, lat),
      lng = COALESCE(@lng, lng),
      speed = COALESCE(@speed, speed),
      course = COALESCE(@course, course),
      heading = COALESCE(@heading, heading),
      nav_status = COALESCE(@nav_status, nav_status),
      nav_status_label = COALESCE(@nav_status_label, nav_status_label),
      updated_at = @updated_at
  `);
  stmt.run(row);
}

export function appendPosition(db, p) {
  db.prepare(`
    INSERT INTO position_history (mmsi, lat, lng, speed, course, timestamp)
    VALUES (@mmsi, @lat, @lng, @speed, @course, @timestamp)
  `).run(p);
}

export function getVesselsByArea(db) {
  return db.prepare('SELECT * FROM vessels').all();
}

export function getTrack(db, mmsi) {
  return db.prepare(
    'SELECT lat, lng, speed, course, timestamp FROM position_history WHERE mmsi = ? ORDER BY timestamp ASC'
  ).all(mmsi);
}

export function pruneOldData(db, maxAgeMs) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  db.prepare('DELETE FROM position_history WHERE timestamp < ?').run(cutoff);
  db.prepare('DELETE FROM vessels WHERE updated_at < ?').run(cutoff);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/db.test.js
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/db.js tests/db.test.js
git commit -m "feat: add SQLite database layer with vessel upsert, history, and cleanup"
```

---

## Task 4: AIS Stream Client + Message Parser

**Files:**
- Create: `server/ais-client.js`
- Create: `tests/ais-client.test.js`

- [ ] **Step 1: Write failing tests for AIS message parsing**

Create `tests/ais-client.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { parseAisMessage } from '../server/ais-client.js';

describe('parseAisMessage', () => {
  it('parses a PositionReport message', () => {
    const raw = {
      MessageType: 'PositionReport',
      Message: {
        PositionReport: {
          Cog: 180.5,
          NavigationalStatus: 0,
          RateOfTurn: 0,
          Sog: 12.3,
          TrueHeading: 179,
          Latitude: 13.76,
          Longitude: 109.23,
          UserID: 123456789,
        }
      },
      MetaData: {
        MMSI: 123456789,
        ShipName: 'TEST VESSEL',
        time_utc: '2026-03-20T10:00:00Z',
      }
    };

    const result = parseAisMessage(raw);
    expect(result).not.toBeNull();
    expect(result.mmsi).toBe('123456789');
    expect(result.lat).toBe(13.76);
    expect(result.lng).toBe(109.23);
    expect(result.speed).toBe(12.3);
    expect(result.course).toBe(180.5);
    expect(result.heading).toBe(179);
    expect(result.nav_status).toBe(0);
    expect(result.name).toBe('TEST VESSEL');
  });

  it('parses a ShipStaticData message', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          ImoNumber: 9876543,
          CallSign: 'ABCD',
          Type: 70,
          Dimension: { A: 100, B: 50, C: 10, D: 10 },
          MaximumStaticDraught: 8.5,
          Destination: 'HO CHI MINH',
          Eta: { Month: 3, Day: 25, Hour: 14, Minute: 0 },
          UserID: 123456789,
        }
      },
      MetaData: {
        MMSI: 123456789,
        ShipName: 'TEST VESSEL',
        time_utc: '2026-03-20T10:00:00Z',
      }
    };

    const result = parseAisMessage(raw);
    expect(result).not.toBeNull();
    expect(result.mmsi).toBe('123456789');
    expect(result.imo).toBe('9876543');
    expect(result.call_sign).toBe('ABCD');
    expect(result.vessel_type).toBe(70);
    expect(result.vessel_type_label).toBe('Cargo');
    expect(result.length).toBe(150); // A + B
    expect(result.width).toBe(20);   // C + D
    expect(result.draught).toBe(8.5);
    expect(result.destination).toBe('HO CHI MINH');
    expect(result.name).toBe('TEST VESSEL');
  });

  it('returns null for unknown message types', () => {
    const raw = {
      MessageType: 'SomethingElse',
      Message: {},
      MetaData: { MMSI: 123, time_utc: '2026-03-20T10:00:00Z' },
    };
    expect(parseAisMessage(raw)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/ais-client.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ais-client.js**

Create `server/ais-client.js`:
```js
import WebSocket from 'ws';
import { getVesselTypeLabel, getVesselTypeColor, getNavStatusLabel, getFlagCountry } from './ais-types.js';

const BOUNDING_BOX = [[13.5, 109.0], [14.0, 109.5]];

export function parseAisMessage(raw) {
  const meta = raw.MetaData;
  const mmsi = String(meta.MMSI);
  const name = (meta.ShipName || '').trim() || null;
  const timestamp = meta.time_utc;
  const flag_country = getFlagCountry(mmsi);

  if (raw.MessageType === 'PositionReport') {
    const pos = raw.Message.PositionReport;
    return {
      type: 'position',
      mmsi,
      name,
      flag_country,
      lat: pos.Latitude,
      lng: pos.Longitude,
      speed: pos.Sog,
      course: pos.Cog,
      heading: pos.TrueHeading,
      nav_status: pos.NavigationalStatus,
      nav_status_label: getNavStatusLabel(pos.NavigationalStatus),
      updated_at: timestamp,
    };
  }

  if (raw.MessageType === 'ShipStaticData') {
    const data = raw.Message.ShipStaticData;
    const dim = data.Dimension || {};
    const eta = data.Eta;
    let etaStr = null;
    if (eta && eta.Month && eta.Day) {
      etaStr = `${String(eta.Month).padStart(2, '0')}-${String(eta.Day).padStart(2, '0')} ${String(eta.Hour || 0).padStart(2, '0')}:${String(eta.Minute || 0).padStart(2, '0')}`;
    }

    return {
      type: 'static',
      mmsi,
      name,
      flag_country,
      imo: data.ImoNumber ? String(data.ImoNumber) : null,
      call_sign: data.CallSign || null,
      vessel_type: data.Type,
      vessel_type_label: getVesselTypeLabel(data.Type),
      length: (dim.A || 0) + (dim.B || 0) || null,
      width: (dim.C || 0) + (dim.D || 0) || null,
      draught: data.MaximumStaticDraught || null,
      destination: data.Destination || null,
      eta: etaStr,
      updated_at: timestamp,
    };
  }

  return null;
}

export function connectAisStream(apiKey, onMessage) {
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    console.log('[AIS] Connected to aisstream.io');
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [BOUNDING_BOX],
    }));
  });

  ws.on('message', (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const parsed = parseAisMessage(raw);
      if (parsed) onMessage(parsed);
    } catch (err) {
      console.error('[AIS] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[AIS] Disconnected. Reconnecting in 5s...');
    setTimeout(() => connectAisStream(apiKey, onMessage), 5000);
  });

  ws.on('error', (err) => {
    console.error('[AIS] WebSocket error:', err.message);
  });

  return ws;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/ais-client.test.js
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add server/ais-client.js tests/ais-client.test.js
git commit -m "feat: add aisstream.io client with message parser"
```

---

## Task 5: Server Entry Point

**Files:**
- Create: `server/index.js`
- Create: `server/cleanup.js`
- Create: `tests/cleanup.test.js`

- [ ] **Step 1: Write failing test for cleanup scheduler**

Create `tests/cleanup.test.js`:
```js
import { describe, it, expect, vi } from 'vitest';
import { startCleanup } from '../server/cleanup.js';

describe('startCleanup', () => {
  it('calls pruneOldData on the given interval', () => {
    vi.useFakeTimers();
    const mockPrune = vi.fn();
    const mockDb = {};

    const stop = startCleanup(mockDb, mockPrune, 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(1);
    expect(mockPrune).toHaveBeenCalledWith(mockDb, 6 * 60 * 60 * 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cleanup.test.js
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement cleanup.js**

Create `server/cleanup.js`:
```js
const SIX_HOURS = 6 * 60 * 60 * 1000;

export function startCleanup(db, pruneFn, intervalMs = 10 * 60 * 1000) {
  const id = setInterval(() => {
    pruneFn(db, SIX_HOURS);
    console.log('[Cleanup] Pruned old data');
  }, intervalMs);

  return () => clearInterval(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cleanup.test.js
```
Expected: PASS

- [ ] **Step 5: Implement server/index.js**

Create `server/index.js`:
```js
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
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(msg);
    }
  }
}

// AIS stream
connectAisStream(API_KEY, (parsed) => {
  // Build vessel record for upsert (only include fields present in this message)
  const vessel = { mmsi: parsed.mmsi, updated_at: parsed.updated_at };

  if (parsed.name) vessel.name = parsed.name;
  if (parsed.flag_country) vessel.flag_country = parsed.flag_country;

  if (parsed.type === 'position') {
    Object.assign(vessel, {
      lat: parsed.lat,
      lng: parsed.lng,
      speed: parsed.speed,
      course: parsed.course,
      heading: parsed.heading,
      nav_status: parsed.nav_status,
      nav_status_label: parsed.nav_status_label,
    });

    // Append to position history
    appendPosition(db, {
      mmsi: parsed.mmsi,
      lat: parsed.lat,
      lng: parsed.lng,
      speed: parsed.speed,
      course: parsed.course,
      timestamp: parsed.updated_at,
    });
  }

  if (parsed.type === 'static') {
    Object.assign(vessel, {
      imo: parsed.imo,
      call_sign: parsed.call_sign,
      vessel_type: parsed.vessel_type,
      vessel_type_label: parsed.vessel_type_label,
      length: parsed.length,
      width: parsed.width,
      draught: parsed.draught,
      destination: parsed.destination,
      eta: parsed.eta,
    });
  }

  upsertVessel(db, vessel);

  // Broadcast update to all browser clients
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
```

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/cleanup.js tests/cleanup.test.js
git commit -m "feat: add server entry point with WebSocket relay and cleanup"
```

---

## Task 6: Frontend — HTML Shell + CSS

**Files:**
- Create: `public/index.html`
- Create: `public/css/style.css`

- [ ] **Step 1: Create index.html**

Create `public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quy Nhon Vessel Tracker</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>
  <header id="top-bar">
    <h1 id="app-title">Quy Nhon Vessel Tracker</h1>
    <div id="top-bar-right">
      <span id="vessel-count">0 vessels</span>
      <select id="type-filter">
        <option value="all" data-i18n="filter_all">All Types</option>
        <option value="Cargo">Cargo</option>
        <option value="Tanker">Tanker</option>
        <option value="Passenger">Passenger</option>
        <option value="Fishing">Fishing</option>
        <option value="Other">Other</option>
      </select>
      <button id="lang-toggle">VI</button>
    </div>
  </header>

  <div id="map"></div>

  <aside id="info-panel" class="hidden">
    <button id="panel-close">&times;</button>
    <div id="panel-essential">
      <h2 id="panel-name"></h2>
      <div id="panel-type"></div>
      <div id="panel-flag"></div>
      <div id="panel-speed"></div>
      <div id="panel-destination"></div>
      <div id="panel-status"></div>
    </div>
    <button id="panel-expand-btn" data-i18n="show_details">Show Details</button>
    <div id="panel-expanded" class="hidden">
      <div id="panel-dimensions"></div>
      <div id="panel-draught"></div>
      <div id="panel-imo"></div>
      <div id="panel-mmsi"></div>
      <div id="panel-callsign"></div>
      <div id="panel-eta"></div>
      <div id="panel-course"></div>
      <div id="panel-updated"></div>
    </div>
  </aside>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create style.css**

Create `public/css/style.css`:
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
}

#top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  background: #1e293b;
  color: #f8fafc;
  z-index: 1000;
  height: 48px;
}

#app-title {
  font-size: 16px;
  font-weight: 600;
}

#top-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

#vessel-count {
  font-size: 13px;
  background: #334155;
  padding: 2px 8px;
  border-radius: 10px;
}

#type-filter {
  background: #334155;
  color: #f8fafc;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
}

#lang-toggle {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

#map {
  flex: 1;
  z-index: 1;
}

/* Info Panel — Desktop: right sidebar */
#info-panel {
  position: fixed;
  top: 48px;
  right: 0;
  width: 350px;
  height: calc(100vh - 48px);
  background: white;
  box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  z-index: 1001;
  padding: 20px;
  overflow-y: auto;
  transition: transform 0.3s ease;
}

#info-panel.hidden {
  transform: translateX(100%);
}

#panel-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #64748b;
}

#panel-essential h2 {
  font-size: 18px;
  margin-bottom: 12px;
  color: #1e293b;
}

#panel-essential div, #panel-expanded div {
  font-size: 14px;
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
  color: #475569;
}

#panel-essential div::before, #panel-expanded div::before {
  font-weight: 600;
  color: #1e293b;
}

#panel-expand-btn {
  margin-top: 12px;
  width: 100%;
  padding: 8px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #475569;
}

#panel-expanded.hidden {
  display: none;
}

/* Mobile: bottom sheet */
@media (max-width: 768px) {
  #app-title { font-size: 14px; }

  #info-panel {
    top: auto;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 50vh;
    border-radius: 16px 16px 0 0;
    transform: translateY(0);
  }

  #info-panel.hidden {
    transform: translateY(100%);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/css/style.css
git commit -m "feat: add HTML shell and responsive CSS"
```

---

## Task 7: Frontend — i18n Module

**Files:**
- Create: `public/js/i18n.js`

- [ ] **Step 1: Create i18n.js**

Create `public/js/i18n.js`:
```js
const translations = {
  en: {
    app_title: 'Quy Nhon Vessel Tracker',
    vessels: 'vessels',
    filter_all: 'All Types',
    show_details: 'Show Details',
    hide_details: 'Hide Details',
    speed: 'Speed',
    destination: 'Destination',
    status: 'Status',
    type: 'Type',
    flag: 'Flag',
    dimensions: 'Dimensions',
    draught: 'Draught',
    imo: 'IMO',
    mmsi: 'MMSI',
    call_sign: 'Call Sign',
    eta: 'ETA',
    course: 'Course',
    heading: 'Heading',
    updated: 'Last Update',
    knots: 'kn',
    meters: 'm',
    no_data: 'N/A',
  },
  vi: {
    app_title: 'Theo Dõi Tàu Quy Nhơn',
    vessels: 'tàu',
    filter_all: 'Tất Cả',
    show_details: 'Xem Chi Tiết',
    hide_details: 'Ẩn Chi Tiết',
    speed: 'Tốc Độ',
    destination: 'Điểm Đến',
    status: 'Trạng Thái',
    type: 'Loại',
    flag: 'Quốc Kỳ',
    dimensions: 'Kích Thước',
    draught: 'Mớn Nước',
    imo: 'IMO',
    mmsi: 'MMSI',
    call_sign: 'Hô Hiệu',
    eta: 'Giờ Đến Dự Kiến',
    course: 'Hướng Đi',
    heading: 'Hướng Mũi',
    updated: 'Cập Nhật Lần Cuối',
    knots: 'hải lý/h',
    meters: 'm',
    no_data: 'N/A',
  },
};

let currentLang = localStorage.getItem('lang') || 'en';

export function t(key) {
  return translations[currentLang][key] || translations['en'][key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
}

export function toggleLang() {
  const next = currentLang === 'en' ? 'vi' : 'en';
  setLang(next);
  return next;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/i18n.js
git commit -m "feat: add bilingual i18n module (EN/VI)"
```

---

## Task 8: Frontend — Vessel Icons

**Files:**
- Create: `public/js/vessel-icons.js`

- [ ] **Step 1: Create vessel-icons.js**

Create `public/js/vessel-icons.js`:
```js
// Creates a rotated arrow SVG icon for Leaflet markers
// color: hex color string, heading: degrees (0 = north)
export function createVesselIcon(color, heading = 0) {
  const svg = `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${heading}, 12, 12)">
        <polygon points="12,2 6,20 12,16 18,20" fill="${color}" stroke="#1e293b" stroke-width="1.5"/>
      </g>
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: 'vessel-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/vessel-icons.js
git commit -m "feat: add SVG vessel icon generator with rotation"
```

---

## Task 9: Frontend — Map Module

**Files:**
- Create: `public/js/map.js`

- [ ] **Step 1: Create map.js**

Create `public/js/map.js`:
```js
import { createVesselIcon } from './vessel-icons.js';
import { t } from './i18n.js';

const QUY_NHON_CENTER = [13.76, 109.23];
const DEFAULT_ZOOM = 12;

let map;
let markers = {};       // mmsi → L.marker
let currentTrack = null; // L.polyline
let selectedMmsi = null;

export function initMap() {
  map = L.map('map').setView(QUY_NHON_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);
  return map;
}

export function getMap() {
  return map;
}

export function updateVesselMarker(vessel, onClick) {
  const { mmsi, lat, lng, heading, vessel_type, vessel_type_label, name } = vessel;
  if (lat == null || lng == null) return;

  const color = getColorForType(vessel_type_label || vessel_type);
  const icon = createVesselIcon(color, heading || 0);

  if (markers[mmsi]) {
    markers[mmsi].setLatLng([lat, lng]);
    markers[mmsi].setIcon(icon);
    markers[mmsi]._vesselData = vessel;
  } else {
    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .bindTooltip(name || mmsi, { direction: 'top', offset: [0, -12] });
    marker._vesselData = vessel;
    marker.on('click', () => onClick(vessel));
    markers[mmsi] = marker;
  }
}

export function removeVesselMarker(mmsi) {
  if (markers[mmsi]) {
    map.removeLayer(markers[mmsi]);
    delete markers[mmsi];
  }
}

export function getAllMarkers() {
  return markers;
}

export function showTrack(positions) {
  clearTrack();
  if (!positions || positions.length === 0) return;

  const latlngs = positions.map(p => [p.lat, p.lng]);

  // Create segments with decreasing opacity (older = more transparent)
  const totalPoints = latlngs.length;
  const segments = [];
  for (let i = 1; i < totalPoints; i++) {
    const opacity = 0.2 + (0.8 * i / totalPoints);
    segments.push(
      L.polyline([latlngs[i - 1], latlngs[i]], {
        color: '#3b82f6',
        weight: 3,
        opacity,
      })
    );
  }

  currentTrack = L.layerGroup(segments).addTo(map);
}

export function clearTrack() {
  if (currentTrack) {
    map.removeLayer(currentTrack);
    currentTrack = null;
  }
}

export function setSelectedMmsi(mmsi) {
  selectedMmsi = mmsi;
}

export function getSelectedMmsi() {
  return selectedMmsi;
}

function getColorForType(typeOrCode) {
  const typeColors = {
    'Cargo': '#2563eb',
    'Tanker': '#dc2626',
    'Passenger': '#16a34a',
    'Fishing': '#ca8a04',
  };
  if (typeof typeOrCode === 'string') return typeColors[typeOrCode] || '#6b7280';
  // If numeric, use ranges
  if (typeOrCode >= 70 && typeOrCode <= 79) return '#2563eb';
  if (typeOrCode >= 80 && typeOrCode <= 89) return '#dc2626';
  if (typeOrCode >= 60 && typeOrCode <= 69) return '#16a34a';
  if (typeOrCode === 30) return '#ca8a04';
  return '#6b7280';
}

export function filterMarkersByType(typeLabel) {
  for (const [mmsi, marker] of Object.entries(markers)) {
    const data = marker._vesselData;
    if (typeLabel === 'all') {
      marker.addTo(map);
    } else {
      const label = data.vessel_type_label || 'Other';
      if (label === typeLabel) {
        marker.addTo(map);
      } else {
        map.removeLayer(marker);
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/map.js
git commit -m "feat: add Leaflet map module with marker management and track display"
```

---

## Task 10: Frontend — Info Panel Module

**Files:**
- Create: `public/js/panel.js`

- [ ] **Step 1: Create panel.js**

Create `public/js/panel.js`:
```js
import { t } from './i18n.js';

const panel = () => document.getElementById('info-panel');
const $ = (id) => document.getElementById(id);

export function showPanel(vessel) {
  $('panel-name').textContent = vessel.name || vessel.mmsi;
  $('panel-type').textContent = `${t('type')}: ${vessel.vessel_type_label || t('no_data')}`;
  $('panel-flag').textContent = `${t('flag')}: ${vessel.flag_country || t('no_data')}`;
  $('panel-speed').textContent = `${t('speed')}: ${vessel.speed != null ? vessel.speed.toFixed(1) + ' ' + t('knots') : t('no_data')}`;
  $('panel-destination').textContent = `${t('destination')}: ${vessel.destination || t('no_data')}`;
  $('panel-status').textContent = `${t('status')}: ${vessel.nav_status_label || t('no_data')}`;

  // Expanded
  $('panel-dimensions').textContent = `${t('dimensions')}: ${vessel.length && vessel.width ? vessel.length + ' x ' + vessel.width + ' ' + t('meters') : t('no_data')}`;
  $('panel-draught').textContent = `${t('draught')}: ${vessel.draught ? vessel.draught + ' ' + t('meters') : t('no_data')}`;
  $('panel-imo').textContent = `${t('imo')}: ${vessel.imo || t('no_data')}`;
  $('panel-mmsi').textContent = `${t('mmsi')}: ${vessel.mmsi}`;
  $('panel-callsign').textContent = `${t('call_sign')}: ${vessel.call_sign || t('no_data')}`;
  $('panel-eta').textContent = `${t('eta')}: ${vessel.eta || t('no_data')}`;
  $('panel-course').textContent = `${t('course')}: ${vessel.course != null ? vessel.course.toFixed(1) + '°' : t('no_data')} / ${t('heading')}: ${vessel.heading != null ? vessel.heading + '°' : t('no_data')}`;
  $('panel-updated').textContent = `${t('updated')}: ${vessel.updated_at ? new Date(vessel.updated_at).toLocaleTimeString() : t('no_data')}`;

  // Reset expanded state
  $('panel-expanded').classList.add('hidden');
  $('panel-expand-btn').textContent = t('show_details');

  panel().classList.remove('hidden');
}

export function hidePanel() {
  panel().classList.add('hidden');
}

export function initPanel(onClose) {
  $('panel-close').addEventListener('click', onClose);

  $('panel-expand-btn').addEventListener('click', () => {
    const expanded = $('panel-expanded');
    const btn = $('panel-expand-btn');
    if (expanded.classList.contains('hidden')) {
      expanded.classList.remove('hidden');
      btn.textContent = t('hide_details');
    } else {
      expanded.classList.add('hidden');
      btn.textContent = t('show_details');
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/panel.js
git commit -m "feat: add info panel module with essential + expandable views"
```

---

## Task 11: Frontend — Main App Entry Point

**Files:**
- Create: `public/js/app.js`

- [ ] **Step 1: Create app.js — wires everything together**

Create `public/js/app.js`:
```js
import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, getAllMarkers } from './map.js';
import { showPanel, hidePanel, initPanel } from './panel.js';
import { t, toggleLang, getLang } from './i18n.js';

// State
let vessels = {}; // mmsi → vessel data

// Init
const map = initMap();
initPanel(onPanelClose);
initWebSocket();
initControls();

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'snapshot') {
      msg.vessels.forEach((v) => {
        vessels[v.mmsi] = v;
        updateVesselMarker(v, onVesselClick);
      });
      updateVesselCount();
    }

    if (msg.type === 'update') {
      const v = msg.vessel;
      vessels[v.mmsi] = { ...vessels[v.mmsi], ...v };
      updateVesselMarker(vessels[v.mmsi], onVesselClick);
      updateVesselCount();

      // If this vessel is currently selected, update the panel
      if (getSelectedMmsi() === v.mmsi) {
        showPanel(vessels[v.mmsi]);
      }
    }
  });

  ws.addEventListener('close', () => {
    console.log('WebSocket closed. Reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  });
}

async function onVesselClick(vessel) {
  setSelectedMmsi(vessel.mmsi);

  // Show panel with current data
  const current = vessels[vessel.mmsi] || vessel;
  showPanel(current);

  // Fetch and show track
  try {
    const res = await fetch(`/api/vessels/${vessel.mmsi}/track`);
    const track = await res.json();
    showTrack(track);
  } catch (err) {
    console.error('Failed to load track:', err);
    clearTrack();
  }
}

function onPanelClose() {
  hidePanel();
  clearTrack();
  setSelectedMmsi(null);
}

function updateVesselCount() {
  const count = Object.keys(vessels).length;
  document.getElementById('vessel-count').textContent = `${count} ${t('vessels')}`;
}

function initControls() {
  // Language toggle
  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = toggleLang();
    document.getElementById('lang-toggle').textContent = next === 'en' ? 'VI' : 'EN';
    document.getElementById('app-title').textContent = t('app_title');
    document.getElementById('panel-expand-btn').textContent = t('show_details');
    updateVesselCount();

    // Update filter dropdown localized option
    const filterAll = document.querySelector('#type-filter option[value="all"]');
    if (filterAll) filterAll.textContent = t('filter_all');

    // Re-render panel if open
    const sel = getSelectedMmsi();
    if (sel && vessels[sel]) {
      showPanel(vessels[sel]);
    }
  });

  // Type filter
  document.getElementById('type-filter').addEventListener('change', (e) => {
    filterMarkersByType(e.target.value);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add main app entry point wiring map, panel, WebSocket, and controls"
```

---

## Task 12: Add vitest config + run all tests

**Files:**
- Create: `vitest.config.js`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.js`:
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
  },
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass (ais-types, db, ais-client, cleanup)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.js
git commit -m "chore: add vitest config"
```

---

## Task 13: End-to-End Smoke Test

- [ ] **Step 1: Create a .env file with your aisstream.io API key**

Go to https://aisstream.io, sign up for free, copy your API key.

```bash
echo "AISSTREAM_API_KEY=your_actual_key_here" > .env
echo "PORT=3000" >> .env
```

- [ ] **Step 2: Start the server**

```bash
npm start
```
Expected: Console shows `[Server] Running on http://localhost:3000` and `[AIS] Connected to aisstream.io`

- [ ] **Step 3: Open in browser**

Navigate to `http://localhost:3000`. You should see:
- Map centered on Quy Nhon bay
- Vessel markers appearing as AIS messages arrive (may take a few seconds)
- Click a vessel → info panel slides in with details
- Track polyline appears for vessels with position history

- [ ] **Step 4: Test mobile view**

Resize browser to mobile width (< 768px). Info panel should appear as bottom sheet.

- [ ] **Step 5: Test language toggle**

Click VI button → all labels switch to Vietnamese. Click EN → back to English.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: ready for deployment"
```
