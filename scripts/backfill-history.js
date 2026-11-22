#!/usr/bin/env node
/**
 * Fill in history for the data pages. Dry run by default: it prints what it
 * would add and writes nothing.
 *
 *   node scripts/backfill-history.js --db vessels.db
 *   node scripts/backfill-history.js --db vessels.db --apply --backup-dir=/opt/qnl-backups
 *
 * The app can stay running. Everything is insert-only into two tables that
 * hold nothing else (daily_log and weather_archive): no existing row in any
 * table is changed or deleted. It is safe to run again later; a second run
 * only adds what is new.
 *
 * What it does:
 *   1. Weather archive (skip with --skip-archive): past weather and sea for
 *      Quy Nhon from Open-Meteo's historical archive into weather_archive,
 *      from --from (default 2016-01-01, or the day after the newest row
 *      already stored) to yesterday. The archive runs about six days behind.
 *   2. Ship counts (skip with --skip-ships): one daily_log row for every
 *      finished day the position data still covers and the live writer does
 *      not fill itself, with weather copied from the archive.
 *
 * --apply takes a backup first (better-sqlite3 online backup) unless
 * --no-backup is given.
 *
 * Open-Meteo's free API is for non-commercial use with attribution. See the
 * note at the top of server/backfill.js.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createDb } from '../server/db.js';
import { isFishingGear } from '../server/vessel-class.js';
import { localDay, addDays } from '../server/daily-log.js';
import { ARCHIVE_START, fetchArchive, parseArchive, storeArchive, archiveResumeDay, backfillShips } from '../server/backfill.js';

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
const BACKUP_DIR = args['backup-dir'] || path.dirname(path.resolve(DB_FILE || '.'));

if (!DB_FILE || !fs.existsSync(DB_FILE)) {
  console.error('Usage: node scripts/backfill-history.js --db <vessels.db> [--apply] [--from YYYY-MM-DD] [--skip-archive] [--skip-ships] [--backup-dir DIR] [--no-backup]');
  process.exit(1);
}
if (args.from && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.from))) {
  console.error('--from must be a date like 2016-01-01');
  process.exit(1);
}

// A dry run opens the file read-only, so it cannot write even by mistake.
// --apply goes through createDb(), which also creates any table that is not
// there yet (CREATE TABLE IF NOT EXISTS, as the server does at start).
const db = APPLY ? createDb(DB_FILE) : new Database(DB_FILE, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 10000');
const hasTable = (name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} on ${DB_FILE}\n`);

if (APPLY && !args['no-backup']) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const file = path.join(BACKUP_DIR, `vessels-pre-backfill-${stamp}.db`);
  await db.backup(file);
  console.log(`Backup written: ${file}\n`);
}

const now = Date.now();
const yesterday = addDays(localDay(now), -1);

// ── 1. Weather archive ──
if (args['skip-archive']) {
  console.log('1. Weather archive: skipped.');
} else {
  const haveTable = hasTable('weather_archive');
  const from = args.from || (haveTable ? archiveResumeDay(db) : ARCHIVE_START);
  if (from > yesterday) {
    console.log(`1. Weather archive: already up to date (newest day stored is ${addDays(from, -1)}).`);
  } else {
    console.log(`1. Weather archive: asking Open-Meteo for ${from} to ${yesterday} ...`);
    let rows = null;
    try {
      rows = parseArchive(await fetchArchive(from, yesterday));
    } catch (err) {
      // Carry on with the ship counts. A later run adds the weather.
      console.log(`   Could not get the archive (${err.message}). Nothing was added. Run this again later.`);
    }
    if (!rows) {
      // already reported
    } else if (!rows.length) {
      console.log('   Open-Meteo has no finished days in that range yet (the archive runs about six days behind).');
    } else {
      const withWaves = rows.filter((r) => r.wave_max_m != null).length;
      console.log(`   ${rows.length} days available, ${rows[0].day} to ${rows[rows.length - 1].day} (${withWaves} with wave height).`);
      const s = rows[rows.length - 1];
      console.log(`   Newest: ${s.day}  ${s.temp_min_c} to ${s.temp_max_c} C, ${s.rain_mm} mm rain, wind ${s.wind_max_kmh} km/h, waves ${s.wave_max_m} m`);
      if (APPLY) console.log(`   Added ${storeArchive(db, rows, { now })} rows to weather_archive.`);
      else console.log(`   Would add up to ${rows.length} rows to weather_archive${haveTable ? '' : ' (the table does not exist yet; --apply creates it)'}.`);
    }
  }
}

// ── 2. Ship counts ──
console.log('');
if (args['skip-ships']) {
  console.log('2. Ship counts: skipped.');
} else if (!hasTable('daily_log') || !hasTable('weather_archive')) {
  console.log('2. Ship counts: daily_log or weather_archive does not exist in this file yet, so a dry run has nothing to read.');
  console.log('   Run with --apply (it creates them), or after the server has started once with this version.');
} else {
  const gear = new Set();
  for (const r of db.prepare('SELECT mmsi, name, call_sign, imo, vessel_type FROM vessel_archive').all()) {
    if (isFishingGear(r)) gear.add(r.mmsi);
  }
  const { first, last, days } = backfillShips(db, { gear, now, apply: APPLY });
  if (!first) {
    console.log('2. Ship counts: no position data in this file.');
  } else {
    console.log(`2. Ship counts: position data covers ${first} onward; the live writer handles everything after ${last}.`);
    if (!days.length) console.log('   Nothing to add: every day in that range is already recorded.');
    for (const d of days) {
      const s = d.ships;
      const ships = s
        ? `${String(s.ships_seen).padStart(4)} ships ${String(s.arrivals).padStart(3)} arrivals ${String(s.feed_hours).padStart(2)}h feed  largest ${s.largest_name || 'none'}`
        : 'counts already recorded';
      console.log(`   ${d.day}  ${ships}  ${d.weather ? '+ weather' : '(no archive weather yet)'}`);
    }
    const counted = days.filter((d) => d.ships).length;
    console.log(`   ${APPLY ? 'Wrote' : 'Would write'} ship counts for ${counted} days and weather for ${days.filter((d) => d.weather).length} days.`);
    if (!APPLY && counted) console.log('   In a dry run the weather is only copied for days already in weather_archive.');
  }
}

console.log(APPLY ? '\nDone.' : '\nDry run finished. Nothing was written. Add --apply to write.');
db.close();
