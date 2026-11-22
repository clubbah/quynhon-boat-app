import Database from 'better-sqlite3';
import { canBeLargest } from './vessel-class.js';

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

    -- Permanent vessel registry (never pruned)
    CREATE TABLE IF NOT EXISTS vessel_archive (
      mmsi TEXT PRIMARY KEY,
      imo TEXT,
      name TEXT,
      call_sign TEXT,
      vessel_type INTEGER,
      vessel_type_label TEXT,
      flag_country TEXT,
      length REAL,
      width REAL,
      first_seen TEXT,
      last_seen TEXT,
      visit_count INTEGER DEFAULT 0
    );

    -- Arrival/departure event log
    CREATE TABLE IF NOT EXISTS vessel_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mmsi TEXT,
      name TEXT,
      vessel_type_label TEXT,
      flag_country TEXT,
      length REAL,
      width REAL,
      event TEXT,
      timestamp TEXT,
      destination TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_visits_ts ON vessel_visits(timestamp);
    CREATE INDEX IF NOT EXISTS idx_visits_mmsi ON vessel_visits(mmsi);

    -- Hourly position summaries (compressed from position_history)
    CREATE TABLE IF NOT EXISTS position_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mmsi TEXT,
      lat REAL,
      lng REAL,
      speed REAL,
      course REAL,
      timestamp TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_possummary_mmsi_ts ON position_summaries(mmsi, timestamp);

    -- Daily record: one row per Quy Nhon calendar day (UTC+7). Written by
    -- daily-log.js. A NULL means "not recorded", never zero or "clear".
    CREATE TABLE IF NOT EXISTS daily_log (
      day TEXT PRIMARY KEY,

      -- Weather and sea: Open-Meteo daily values for the day (model data)
      temp_min_c REAL,
      temp_max_c REAL,
      rain_mm REAL,
      wind_max_kmh REAL,
      gust_max_kmh REAL,
      wave_max_m REAL,
      sunrise TEXT,
      sunset TEXT,
      weather_source TEXT,
      weather_at TEXT,

      -- Sunset rating: 'forecast' is the last rating the site showed before
      -- sunset, 'hindcast' is scored afterwards from the model's sunset hour
      sunset_score INTEGER,
      sunset_level TEXT,
      sunset_source TEXT,

      -- Ships heard by the antenna
      transponders INTEGER,
      ships_seen INTEGER,
      arrivals INTEGER,
      feed_hours INTEGER,
      largest_mmsi TEXT,
      largest_name TEXT,
      largest_length_m REAL,
      largest_width_m REAL,
      largest_type TEXT,
      largest_flag TEXT,
      ships_at TEXT,

      -- Highest storm threat level read during the day
      storm_level TEXT,
      storm_name TEXT,
      storm_min_km INTEGER,
      storm_wind_kmh INTEGER,
      storm_checks INTEGER NOT NULL DEFAULT 0,

      completed_at TEXT
    );

    -- Past weather and sea for Quy Nhon from Open-Meteo's historical archive
    -- (ERA5 reanalysis), one row per day back to 2016. Reference data for the
    -- month-by-month table, filled by scripts/backfill-history.js. This is
    -- not the site's own record: that is daily_log.
    CREATE TABLE IF NOT EXISTS weather_archive (
      day TEXT PRIMARY KEY,
      temp_min_c REAL,
      temp_max_c REAL,
      rain_mm REAL,
      wind_max_kmh REAL,
      gust_max_kmh REAL,
      wave_max_m REAL,
      sunrise TEXT,
      sunset TEXT,
      source TEXT,
      fetched_at TEXT
    );
  `);

  return db;
}

const VESSEL_COLUMNS = [
  'mmsi', 'imo', 'name', 'call_sign', 'vessel_type', 'vessel_type_label',
  'flag_country', 'length', 'width', 'draught', 'destination', 'eta',
  'lat', 'lng', 'speed', 'course', 'heading', 'nav_status', 'nav_status_label', 'updated_at',
];

export function upsertVessel(db, v) {
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
  // Only prune stale vessels from the live display table
  // Position history is now compressed by compressPositions() instead of deleted
  db.prepare('DELETE FROM vessels WHERE updated_at < ?').run(cutoff);
}

// ── Vessel Archive ──

export function upsertArchive(db, v) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO vessel_archive (mmsi, imo, name, call_sign, vessel_type, vessel_type_label,
      flag_country, length, width, first_seen, last_seen, visit_count)
    VALUES (@mmsi, @imo, @name, @call_sign, @vessel_type, @vessel_type_label,
      @flag_country, @length, @width, @now, @now, 0)
    ON CONFLICT(mmsi) DO UPDATE SET
      imo = COALESCE(@imo, imo),
      name = COALESCE(@name, name),
      call_sign = COALESCE(@call_sign, call_sign),
      vessel_type = COALESCE(@vessel_type, vessel_type),
      vessel_type_label = COALESCE(@vessel_type_label, vessel_type_label),
      flag_country = COALESCE(@flag_country, flag_country),
      length = COALESCE(@length, length),
      width = COALESCE(@width, width),
      last_seen = @now
  `).run({ ...v, now });
}

export function incrementVisitCount(db, mmsi) {
  db.prepare('UPDATE vessel_archive SET visit_count = visit_count + 1 WHERE mmsi = ?').run(mmsi);
}

// The stats below take `gear`, a Set of MMSIs classed as fishing gear (see
// vessel-class.js), and leave those out. Aggregation is done in JS because
// the gear rule is JS; the archive is a few thousand rows.

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([k, c]) => ({ [key]: k, c })).sort((a, b) => b.c - a.c);
}

export function getArchiveStats(db, gear = new Set()) {
  const ships = db.prepare('SELECT * FROM vessel_archive').all().filter((r) => !gear.has(r.mmsi));
  const monthStart = monthStartIso();
  const named = ships.filter((r) => r.name);
  const pick = ({ mmsi, name, flag_country, vessel_type_label, visit_count, first_seen, last_seen, length, width }) =>
    ({ mmsi, name, flag_country, vessel_type_label, visit_count, first_seen, last_seen, length, width });
  return {
    totalUnique: ships.length,
    newThisMonth: ships.filter((r) => r.first_seen >= monthStart).length,
    frequentVisitors: [...named].sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0)).slice(0, 5).map(pick),
    largestEver: named.filter(canBeLargest).sort((a, b) => b.length - a.length).map(pick)[0],
  };
}

// ── Port Trends (aggregate stats over the permanent archive) ──

export function getPortTrends(db, gear = new Set()) {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const ships = db.prepare('SELECT * FROM vessel_archive').all().filter((r) => !gear.has(r.mmsi));
  const named = ships.filter((r) => r.name);

  const arrivalsByMmsi = db.prepare("SELECT mmsi, COUNT(*) c FROM vessel_visits WHERE event = 'arrival' GROUP BY mmsi").all();
  const recentArrivals = db.prepare("SELECT mmsi, substr(timestamp, 1, 10) day FROM vessel_visits WHERE event = 'arrival' AND timestamp >= ?")
    .all(fourteenDaysAgo).filter((r) => !gear.has(r.mmsi));

  const flags = countBy(ships, 'flag_country');
  const byDay = countBy(recentArrivals, 'day').sort((a, b) => a.day.localeCompare(b.day));

  return {
    totalUnique: ships.length,
    newThisMonth: ships.filter((r) => r.first_seen >= monthStartIso()).length,
    totalArrivals: arrivalsByMmsi.filter((r) => !gear.has(r.mmsi)).reduce((s, r) => s + r.c, 0),
    countriesSeen: flags.length,
    flags: flags.slice(0, 10),
    types: countBy(ships, 'vessel_type_label'),
    byDay,
    frequent: [...named]
      .sort((a, b) => (b.visit_count || 0) - (a.visit_count || 0) || String(b.last_seen).localeCompare(String(a.last_seen)))
      .slice(0, 8)
      .map(({ mmsi, name, flag_country, vessel_type_label, visit_count }) => ({ mmsi, name, flag_country, vessel_type_label, visit_count })),
    largest: named
      .filter(canBeLargest)
      .sort((a, b) => b.length - a.length)
      .slice(0, 5)
      .map(({ mmsi, name, flag_country, vessel_type_label, length, width }) => ({ mmsi, name, flag_country, vessel_type_label, length, width })),
  };
}

// ── Vessel Visits (arrival/departure log) ──

export function logVisit(db, event) {
  db.prepare(`
    INSERT INTO vessel_visits (mmsi, name, vessel_type_label, flag_country, length, width, event, timestamp, destination)
    VALUES (@mmsi, @name, @vessel_type_label, @flag_country, @length, @width, @event, @timestamp, @destination)
  `).run(event);
}

export function getRecentVisits(db, limit = 20) {
  return db.prepare(
    'SELECT * FROM vessel_visits ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

export function getVesselVisitHistory(db, mmsi) {
  return db.prepare(
    'SELECT * FROM vessel_visits WHERE mmsi = ? ORDER BY timestamp DESC LIMIT 50'
  ).all(mmsi);
}

// ── Position Summaries ──

// Hourly summaries are written every cleanup cycle and nothing reads them yet,
// so the table grew without limit (1.1M rows by Nov 2026). Keep a window and
// delete the rest in small batches so the live server never blocks for long.
export function pruneSummaries(db, olderThanMs, { batch = 5000, maxBatches = 40 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const del = db.prepare('DELETE FROM position_summaries WHERE id IN (SELECT id FROM position_summaries WHERE timestamp < ? LIMIT ?)');
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = del.run(cutoff, batch).changes;
    total += n;
    if (n < batch) break;
  }
  return total;
}

export function compressPositions(db, olderThanMs) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  // Get distinct mmsi/hour combos older than cutoff that haven't been compressed yet
  const rows = db.prepare(`
    SELECT mmsi,
      strftime('%Y-%m-%dT%H:00:00', timestamp) as hour_bucket,
      AVG(lat) as lat, AVG(lng) as lng,
      AVG(speed) as speed, AVG(course) as course
    FROM position_history
    WHERE timestamp < ?
    GROUP BY mmsi, strftime('%Y-%m-%dT%H:00:00', timestamp)
  `).all(cutoff);

  if (rows.length === 0) return 0;

  const insert = db.prepare(`
    INSERT INTO position_summaries (mmsi, lat, lng, speed, course, timestamp)
    VALUES (@mmsi, @lat, @lng, @speed, @course, @hour_bucket)
  `);

  const insertMany = db.transaction((summaries) => {
    for (const s of summaries) insert.run(s);
  });
  insertMany(rows);

  // Delete the raw positions that were compressed
  db.prepare('DELETE FROM position_history WHERE timestamp < ?').run(cutoff);
  return rows.length;
}
