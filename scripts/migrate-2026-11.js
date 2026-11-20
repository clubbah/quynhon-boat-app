#!/usr/bin/env node
/**
 * One-off data migration, November 2026 (improvement plan, Phase 1).
 *
 * Dry run by default: prints what would change and writes nothing.
 *
 *   node scripts/migrate-2026-11.js --db vessels.db
 *   node scripts/migrate-2026-11.js --db vessels.db --apply --visits=recompute --backup-dir=/opt/qnl-backups
 *
 * Run it with the app stopped (pm2 stop vessel-tracker), then start the app.
 *
 * What it does:
 *   1. Flags: rewrite flag_country in vessels, vessel_archive and vessel_visits
 *      as 2-letter codes derived from the MMSI (older rows hold names such as
 *      "Vietnam", which broke flag images and split the trends counts).
 *   2. Visits (--visits=keep|recompute|reset, default keep):
 *        recompute  rebuild the arrival/departure log with the new rule
 *                   (6-hour silence gap, fishing gear excluded). The old table
 *                   is kept as vessel_visits_legacy_20261120 for rollback.
 *        reset      move the old log to vessel_visits_legacy_20261120 and
 *                   start empty; visit counts go to 0.
 *   3. Summaries: delete position_summaries older than --summaries-days (90).
 *
 * --apply always takes a backup first (better-sqlite3 online backup).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { normalizeFlagCountry } from '../server/ais-types.js';
import { isFishingGear } from '../server/vessel-class.js';
import { pruneSummaries } from '../server/db.js';
import { VISIT_GAP_MS } from '../server/visits.js';

// Accepts --key=value, --key value, and bare --flag.
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const eq = a.indexOf('=');
  if (eq > -1) args[a.slice(2, eq)] = a.slice(eq + 1);
  else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
  else args[a.slice(2)] = true;
}
const DB_FILE = args.db;
const APPLY = !!args.apply;
const VISITS = args.visits || 'keep';
const SUMMARY_DAYS = Number(args['summaries-days'] || 90);
const BACKUP_DIR = args['backup-dir'] || path.dirname(path.resolve(DB_FILE || '.'));
const LEGACY = 'vessel_visits_legacy_20261120';
// A departure was logged about an hour after the vessel went silent.
const DEPARTURE_LAG_MS = 60 * 60 * 1000;

if (!DB_FILE || !fs.existsSync(DB_FILE)) {
  console.error('Usage: node scripts/migrate-2026-11.js --db <vessels.db> [--apply] [--visits=keep|recompute|reset]');
  process.exit(1);
}
if (!['keep', 'recompute', 'reset'].includes(VISITS)) {
  console.error('--visits must be keep, recompute or reset');
  process.exit(1);
}

const db = new Database(DB_FILE);
db.pragma('busy_timeout = 10000');
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} on ${DB_FILE} (visits=${VISITS}, summaries kept ${SUMMARY_DAYS} days)\n`);

if (APPLY) {
  if (db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(LEGACY) && VISITS !== 'keep') {
    console.error(`${LEGACY} already exists; this migration has run before. Aborting.`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = path.join(BACKUP_DIR, `vessels-pre-migrate-${stamp}.db`);
  await db.backup(file);
  console.log(`Backup written: ${file}\n`);
}

// ── 1. Flags ──
function flagPlan(table, key) {
  const rows = db.prepare(`SELECT ${key} AS k, mmsi, flag_country FROM ${table}`).all();
  return rows
    .map((r) => ({ k: r.k, from: r.flag_country, to: normalizeFlagCountry(r.mmsi, r.flag_country) }))
    .filter((r) => r.from !== r.to);
}
const flagTables = [['vessels', 'mmsi'], ['vessel_archive', 'mmsi'], ['vessel_visits', 'id']];
for (const [table, key] of flagTables) {
  const changes = flagPlan(table, key);
  const sample = {};
  for (const c of changes) { const s = `${c.from} -> ${c.to}`; sample[s] = (sample[s] || 0) + 1; }
  const top = Object.entries(sample).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s} (${n})`).join(', ');
  console.log(`Flags ${table}: ${changes.length} rows to update. ${top}`);
  if (APPLY && changes.length) {
    const upd = db.prepare(`UPDATE ${table} SET flag_country = ? WHERE ${key} = ?`);
    db.transaction(() => { for (const c of changes) upd.run(c.to, c.k); })();
  }
}

// ── 2. Visits ──
const VISIT_COLS = 'mmsi, name, vessel_type_label, flag_country, length, width, event, timestamp, destination';

function rebuildVisits() {
  const gear = new Set(db.prepare('SELECT mmsi, name, call_sign, imo, vessel_type FROM vessel_archive').all()
    .filter(isFishingGear).map((r) => r.mmsi));
  const rows = db.prepare(`SELECT ${VISIT_COLS} FROM vessel_visits ORDER BY mmsi, timestamp`).all();
  const now = Date.now();
  const out = [];
  const counts = new Map();

  let i = 0;
  while (i < rows.length) {
    const mmsi = rows[i].mmsi;
    const own = [];
    while (i < rows.length && rows[i].mmsi === mmsi) own.push(rows[i++]);
    if (gear.has(mmsi)) continue;

    // Presence intervals from arrival/departure pairs.
    const intervals = [];
    let cur = null;
    for (const r of own) {
      if (r.event === 'arrival' && !cur) cur = { start: r, end: null, dep: null };
      else if (r.event === 'departure' && cur) {
        cur.end = Date.parse(r.timestamp) - DEPARTURE_LAG_MS;
        cur.dep = r;
        intervals.push(cur);
        cur = null;
      }
    }
    if (cur) intervals.push(cur);

    // Merge stretches separated by less than the gap.
    const merged = [];
    for (const iv of intervals) {
      const last = merged[merged.length - 1];
      if (last && last.end != null && Date.parse(iv.start.timestamp) - last.end < VISIT_GAP_MS) {
        last.end = iv.end;
        last.dep = iv.dep;
      } else {
        merged.push({ ...iv });
      }
    }

    for (const v of merged) {
      out.push({ ...v.start, event: 'arrival' });
      // A visit that ended less than the gap ago is still "present" for the
      // live tracker, which will log its departure itself.
      if (v.end != null && now - v.end >= VISIT_GAP_MS) {
        out.push({ ...v.dep, event: 'departure', timestamp: new Date(v.end).toISOString() });
      }
    }
    counts.set(mmsi, merged.length);
  }
  out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { out, counts, gearCount: gear.size };
}

const before = db.prepare("SELECT event, COUNT(*) c FROM vessel_visits GROUP BY event").all();
console.log(`\nVisits now: ${before.map((r) => `${r.c} ${r.event}s`).join(', ')}`);

if (VISITS === 'recompute') {
  const { out, counts, gearCount } = rebuildVisits();
  const arr = out.filter((r) => r.event === 'arrival');
  const days = {};
  for (const r of arr) { const d = r.timestamp.slice(0, 10); days[d] = (days[d] || 0) + 1; }
  const last14 = Object.keys(days).sort().slice(-14).map((d) => `${d.slice(5)}:${days[d]}`).join(' ');
  console.log(`Recomputed: ${arr.length} arrivals, ${out.length - arr.length} departures (${gearCount} gear MMSIs excluded)`);
  console.log(`Arrivals per day, last 14: ${last14}`);
  if (APPLY) {
    db.transaction(() => {
      db.exec(`DROP INDEX IF EXISTS idx_visits_ts; DROP INDEX IF EXISTS idx_visits_mmsi;
        ALTER TABLE vessel_visits RENAME TO ${LEGACY};
        CREATE TABLE vessel_visits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, mmsi TEXT, name TEXT, vessel_type_label TEXT,
          flag_country TEXT, length REAL, width REAL, event TEXT, timestamp TEXT, destination TEXT);
        CREATE INDEX idx_visits_ts ON vessel_visits(timestamp);
        CREATE INDEX idx_visits_mmsi ON vessel_visits(mmsi);`);
      const ins = db.prepare(`INSERT INTO vessel_visits (${VISIT_COLS}) VALUES (@mmsi, @name, @vessel_type_label, @flag_country, @length, @width, @event, @timestamp, @destination)`);
      for (const r of out) ins.run(r);
      db.prepare('UPDATE vessel_archive SET visit_count = 0').run();
      const setCount = db.prepare('UPDATE vessel_archive SET visit_count = ? WHERE mmsi = ?');
      for (const [mmsi, n] of counts) setCount.run(n, mmsi);
    })();
    console.log(`Applied. Old log kept as ${LEGACY}.`);
  }
} else if (VISITS === 'reset') {
  console.log('Reset: the log would start empty and visit counts go to 0.');
  if (APPLY) {
    db.transaction(() => {
      db.exec(`DROP INDEX IF EXISTS idx_visits_ts; DROP INDEX IF EXISTS idx_visits_mmsi;
        ALTER TABLE vessel_visits RENAME TO ${LEGACY};
        CREATE TABLE vessel_visits (
          id INTEGER PRIMARY KEY AUTOINCREMENT, mmsi TEXT, name TEXT, vessel_type_label TEXT,
          flag_country TEXT, length REAL, width REAL, event TEXT, timestamp TEXT, destination TEXT);
        CREATE INDEX idx_visits_ts ON vessel_visits(timestamp);
        CREATE INDEX idx_visits_mmsi ON vessel_visits(mmsi);`);
      db.prepare('UPDATE vessel_archive SET visit_count = 0').run();
    })();
    console.log(`Applied. Old log kept as ${LEGACY}.`);
  }
} else {
  console.log('Visits: left as they are.');
}

// ── 3. Summaries ──
const cutoff = new Date(Date.now() - SUMMARY_DAYS * 86400000).toISOString();
const oldSummaries = db.prepare('SELECT COUNT(*) c FROM position_summaries WHERE timestamp < ?').get(cutoff).c;
const allSummaries = db.prepare('SELECT COUNT(*) c FROM position_summaries').get().c;
console.log(`\nSummaries: ${oldSummaries} of ${allSummaries} rows are older than ${SUMMARY_DAYS} days.`);
if (APPLY && oldSummaries) {
  const n = pruneSummaries(db, SUMMARY_DAYS * 86400000, { batch: 20000, maxBatches: 1000 });
  console.log(`Deleted ${n}. The file does not shrink until VACUUM (optional, app stopped).`);
}

db.close();
console.log(APPLY ? '\nDone.' : '\nDry run only. Nothing was written.');
