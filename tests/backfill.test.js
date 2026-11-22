import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../server/db.js';
import { createDailyLog, getDailyLog } from '../server/daily-log.js';
import {
  ARCHIVE_START, ARCHIVE_SOURCE, archiveUrls, parseArchive, storeArchive, archiveResumeDay, firstFullDay, backfillShips,
} from '../server/backfill.js';

const at = (iso) => Date.parse(iso);
const NOW = at('2026-11-22T08:00:00Z'); // 15:00 on 22 Nov in Quy Nhon

let db;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => db.close());

const summary = (mmsi, timestamp) =>
  db.prepare('INSERT INTO position_summaries (mmsi, lat, lng, speed, course, timestamp) VALUES (?, 13.7, 109.2, 0, 0, ?)').run(mmsi, timestamp);
const visit = (mmsi, timestamp) =>
  db.prepare("INSERT INTO vessel_visits (mmsi, name, event, timestamp) VALUES (?, 'X', 'arrival', ?)").run(mmsi, timestamp);
const row = (day) => db.prepare('SELECT * FROM daily_log WHERE day = ?').get(day);
const archiveRow = (day) => db.prepare('SELECT * FROM weather_archive WHERE day = ?').get(day);

// Shaped like the real archive responses (checked 2026-11-22). The archive
// runs behind, so the last day of a range comes back as nulls.
const archive = () => ({
  weather: {
    daily: {
      time: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
      temperature_2m_max: [26.2, 27.0, 27.4, null],
      temperature_2m_min: [23.1, 23.4, 23.9, null],
      precipitation_sum: [29.1, 0, 3.2, null],
      wind_speed_10m_max: [27.7, 14.2, 18.0, null],
      wind_gusts_10m_max: [51.1, 22.3, 30.6, null],
      sunrise: ['2026-11-10T05:40', '2026-11-11T05:40', '2026-11-12T05:41', '2026-11-13T05:41'],
      sunset: ['2026-11-10T17:13', '2026-11-11T17:13', '2026-11-12T17:12', '2026-11-13T17:12'],
    },
  },
  marine: { daily: { time: ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'], wave_height_max: [2.06, 1.1, null, null] } },
});

describe('weather archive', () => {
  it('asks for the whole range in one request per source, with the models pinned', () => {
    const u = archiveUrls('2016-01-01', '2026-11-21');
    expect(u.weather).toContain('archive-api.open-meteo.com/v1/archive');
    expect(u.weather).toContain('start_date=2016-01-01&end_date=2026-11-21');
    expect(u.weather).toContain('models=era5_seamless');
    expect(u.weather).toContain('timezone=Asia%2FHo_Chi_Minh');
    expect(u.marine).toContain('models=era5_ocean');
    expect(u.marine).toContain('daily=wave_height_max');
  });

  it('turns the responses into one row per finished day', () => {
    const rows = parseArchive(archive());
    expect(rows.map((r) => r.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']); // the empty last day is left out
    expect(rows[0]).toEqual({
      day: '2026-11-10', temp_min_c: 23.1, temp_max_c: 26.2, rain_mm: 29.1, wind_max_kmh: 27.7, gust_max_kmh: 51.1,
      wave_max_m: 2.06, sunrise: '05:40', sunset: '17:13',
    });
    expect(rows[1].rain_mm).toBe(0);            // a dry day is 0, not missing
    expect(rows[2].wave_max_m).toBeNull();      // no wave value for that day
  });

  it('keeps the weather when the wave request has nothing', () => {
    const rows = parseArchive({ weather: archive().weather, marine: { error: true } });
    expect(rows).toHaveLength(3);
    expect(rows[0].wave_max_m).toBeNull();
  });

  it('refuses a response with no daily values', () => {
    expect(() => parseArchive({ weather: { error: true, reason: 'bad request' } })).toThrow(/no daily values/);
    expect(() => parseArchive()).toThrow();
  });

  it('adds new days only and never overwrites one that is stored', () => {
    expect(archiveResumeDay(db)).toBe(ARCHIVE_START);
    expect(storeArchive(db, parseArchive(archive()), { now: NOW })).toBe(3);
    expect(archiveRow('2026-11-10')).toMatchObject({ temp_max_c: 26.2, wave_max_m: 2.06, source: ARCHIVE_SOURCE, fetched_at: new Date(NOW).toISOString() });
    expect(archiveResumeDay(db)).toBe('2026-11-13');

    const changed = parseArchive(archive()).map((r) => ({ ...r, temp_max_c: 99 }));
    changed.push({ ...changed[2], day: '2026-11-13' });
    expect(storeArchive(db, changed, { now: NOW + 1000 })).toBe(1);
    expect(archiveRow('2026-11-10').temp_max_c).toBe(26.2);
    expect(archiveRow('2026-11-13').temp_max_c).toBe(99);
  });
});

describe('firstFullDay', () => {
  it('skips the oldest day when the data starts part-way through it', () => {
    summary('574000001', '2026-08-22T10:00:00');             // 17:00 on 22 Aug in Quy Nhon
    expect(firstFullDay(db, NOW)).toBe('2026-08-23');
  });

  it('keeps a day whose data starts exactly at its first hour', () => {
    summary('574000001', '2026-08-22T17:00:00');             // 00:00 on 23 Aug in Quy Nhon
    expect(firstFullDay(db, NOW)).toBe('2026-08-23');
  });

  it('steps over a junk timestamp and returns null with no data', () => {
    expect(firstFullDay(db, NOW)).toBeNull();
    summary('574000001', '2006-12-23T18:00:00');
    expect(firstFullDay(db, NOW)).toBeNull();
    summary('574000001', '2026-11-01T03:00:00');
    expect(firstFullDay(db, NOW)).toBe('2026-11-02');
  });
});

describe('backfillShips', () => {
  // Position data from 10:00 on 9 Nov (Quy Nhon time): 10 Nov is the first full day.
  beforeEach(() => {
    summary('574000001', '2026-11-09T03:00:00');
    for (const day of ['10', '11', '12', '13', '14']) {
      summary('574000001', `2026-11-${day}T03:00:00`);
      summary('574000002', `2026-11-${day}T04:00:00`);
      summary('574100236', `2026-11-${day}T04:00:00`);       // fishing gear
    }
    summary('574000001', '2026-11-20T03:00:00');             // inside the live writer's 7 days
    visit('574000001', '2026-11-10T03:00:00.000Z');
    storeArchive(db, parseArchive(archive()), { now: NOW }); // archive has 10, 11 and 12 Nov
  });
  const opts = (over = {}) => ({ gear: new Set(['574100236']), now: NOW, ...over });

  it('a dry run reports the days and writes nothing', () => {
    const { first, last, days } = backfillShips(db, opts());
    expect(first).toBe('2026-11-10');
    expect(last).toBe('2026-11-14');                         // 22 Nov minus the live writer's 7 days, minus one
    expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
    expect(days[0]).toMatchObject({ weather: true, ships: { transponders: 3, ships_seen: 2, arrivals: 1, feed_hours: 2 } });
    expect(days[3].weather).toBe(false);
    expect(db.prepare('SELECT COUNT(*) c FROM daily_log').get().c).toBe(0);
  });

  it('writes ship counts with the archive weather, and finishes the rows that have both', () => {
    backfillShips(db, opts({ apply: true }));
    expect(row('2026-11-10')).toMatchObject({
      transponders: 3, ships_seen: 2, arrivals: 1, feed_hours: 2,
      temp_min_c: 23.1, temp_max_c: 26.2, rain_mm: 29.1, wave_max_m: 2.06, sunrise: '05:40', sunset: '17:13',
      weather_source: ARCHIVE_SOURCE,
      sunset_score: null, sunset_level: null,                // no rating is invented for a past day
      storm_level: null, storm_checks: 0,                    // nor a storm reading
    });
    expect(row('2026-11-10').completed_at).toBe(new Date(NOW).toISOString());
    expect(getDailyLog(db).map((r) => r.day)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10']);
    // 13 and 14 Nov have counts but the archive had not reached them yet.
    expect(row('2026-11-13')).toMatchObject({ ships_seen: 2, weather_at: null, completed_at: null });
  });

  it('leaves the partial first day and the live writer\'s days alone', () => {
    backfillShips(db, opts({ apply: true }));
    expect(row('2026-11-09')).toBeUndefined();
    for (const day of ['2026-11-15', '2026-11-20', '2026-11-21', '2026-11-22']) expect(row(day)).toBeUndefined();
  });

  it('a second run adds only what is new, such as weather the archive has since caught up on', () => {
    backfillShips(db, opts({ apply: true }));
    const before = row('2026-11-10');
    summary('574000099', '2026-11-10T05:00:00');             // would change the count if recomputed

    const more = parseArchive(archive()).slice(0, 1).map((r) => ({ ...r, day: '2026-11-13', temp_max_c: 28.5 }));
    storeArchive(db, more, { now: NOW });
    const { days } = backfillShips(db, opts({ apply: true, now: NOW + 60000 }));
    expect(days).toEqual([{ day: '2026-11-13', ships: null, weather: true }]);
    expect(row('2026-11-10')).toEqual(before);
    expect(row('2026-11-13')).toMatchObject({ ships_seen: 2, temp_max_c: 28.5 });
    expect(row('2026-11-13').completed_at).not.toBeNull();
    expect(backfillShips(db, opts({ apply: true })).days.map((d) => d.day)).toEqual([]);
  });

  it('never overwrites a row the live writer has already filled', async () => {
    db.prepare(`INSERT INTO daily_log (day, ships_seen, arrivals, ships_at, temp_max_c, weather_source, weather_at, sunset_score, sunset_source, storm_level, completed_at)
      VALUES ('2026-11-11', 77, 9, 'x', 30.1, 'open-meteo gfs_seamless', 'x', 71, 'forecast', 'watch', 'x')`).run();
    const { days } = backfillShips(db, opts({ apply: true }));
    expect(days.map((d) => d.day)).not.toContain('2026-11-11');
    expect(row('2026-11-11')).toMatchObject({ ships_seen: 77, arrivals: 9, temp_max_c: 30.1, sunset_score: 71, storm_level: 'watch', completed_at: 'x' });
  });

  it('records a day when the receiver was down as zero hours of feed, not as a quiet bay', () => {
    db.exec("DELETE FROM position_summaries WHERE timestamp LIKE '2026-11-12%'");
    backfillShips(db, opts({ apply: true }));
    expect(row('2026-11-12')).toMatchObject({ transponders: 0, ships_seen: 0, feed_hours: 0 });
  });

  it('still writes when the live server commits to the same file while the days are being counted', () => {
    // Two connections to one file, as on the server. The second one commits a
    // write in the middle of the counting. A transaction that had already read
    // would be refused when it tried to write (this is how the first version
    // of the script died against a busy database).
    const file = path.join(os.tmpdir(), `qnl-backfill-${process.pid}-${Date.now()}.db`);
    const ours = createDb(file);
    const server = createDb(file);
    try {
      const ins = ours.prepare('INSERT INTO position_summaries (mmsi, lat, lng, speed, course, timestamp) VALUES (?, 13.7, 109.2, 0, 0, ?)');
      for (const day of ['10', '11', '12']) ins.run('574000001', `2026-11-${day}T03:00:00`);
      ins.run('574000001', '2026-11-09T03:00:00');
      const serverWrite = server.prepare("INSERT INTO position_history (mmsi, lat, lng, speed, course, timestamp) VALUES ('574000009', 13.7, 109.2, 0, 0, ?)");
      let writes = 0;
      const gear = new Set();
      gear.has = () => { serverWrite.run(new Date(NOW + writes++).toISOString()); return false; }; // called while counting

      const { days, writeMs } = backfillShips(ours, { gear, now: NOW, apply: true });
      expect(writes).toBeGreaterThan(0);
      expect(days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']);
      expect(ours.prepare('SELECT COUNT(*) c FROM daily_log WHERE ships_at IS NOT NULL').get().c).toBe(5);
      expect(writeMs).toBeLessThan(1000);
    } finally {
      ours.close();
      server.close();
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
    }
  });

  it('does not collide with the live writer: together they cover every day once', async () => {
    backfillShips(db, opts({ apply: true }));
    const fetchDay = async (day) => ({
      forecast: { daily: { time: [day], temperature_2m_max: [27], temperature_2m_min: [23], precipitation_sum: [0], wind_speed_10m_max: [10], wind_gusts_10m_max: [15], sunrise: [`${day}T05:45`], sunset: [`${day}T17:12`] } },
      marine: { daily: { time: [day], wave_height_max: [1] } },
    });
    const live = createDailyLog(db, { now: () => NOW, fetchDay, log: { log() {}, error() {} } });
    expect(live.pendingDays()).toEqual(['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
    for (let i = 0; i < 7; i++) await live.tick();
    const days = db.prepare('SELECT day FROM daily_log WHERE ships_at IS NOT NULL ORDER BY day').all().map((r) => r.day);
    expect(days).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14',
      '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  });
});
