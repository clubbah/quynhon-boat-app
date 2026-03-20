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
