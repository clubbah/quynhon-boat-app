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

export function getArchiveStats(db) {
  const total = db.prepare('SELECT COUNT(*) as c FROM vessel_archive').get();
  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);
  const monthCount = db.prepare(
    'SELECT COUNT(*) as c FROM vessel_archive WHERE first_seen >= ?'
  ).get(thisMonth.toISOString());
  const frequent = db.prepare(
    'SELECT mmsi, name, flag_country, vessel_type_label, visit_count, first_seen, last_seen FROM vessel_archive WHERE name IS NOT NULL ORDER BY visit_count DESC LIMIT 5'
  ).all();
  const largest = db.prepare(
    'SELECT mmsi, name, flag_country, vessel_type_label, length, width FROM vessel_archive WHERE name IS NOT NULL AND length IS NOT NULL ORDER BY length DESC LIMIT 1'
  ).get();
  return { totalUnique: total.c, newThisMonth: monthCount.c, frequentVisitors: frequent, largestEver: largest };
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
