import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDb } from '../server/db.js';
import {
  localDay, dayStartMs, dayBounds, addDays, shipsForDay, parseDayWeather, hindcastSunset, dayWeatherUrls,
  stormReading, mergeStorm, sunsetReading, createDailyLog, startDailyLog, getDailyLog,
  SETTLE_MS, WEATHER_SOURCE,
} from '../server/daily-log.js';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const at = (iso) => Date.parse(iso);

let db;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => db.close());

// ── Fixtures ──

const pos = (mmsi, timestamp) =>
  db.prepare('INSERT INTO position_history (mmsi, lat, lng, speed, course, timestamp) VALUES (?, 13.7, 109.2, 0, 0, ?)').run(mmsi, timestamp);
const summary = (mmsi, timestamp) =>
  db.prepare('INSERT INTO position_summaries (mmsi, lat, lng, speed, course, timestamp) VALUES (?, 13.7, 109.2, 0, 0, ?)').run(mmsi, timestamp);
const visit = (mmsi, event, timestamp) =>
  db.prepare('INSERT INTO vessel_visits (mmsi, name, event, timestamp) VALUES (?, ?, ?, ?)').run(mmsi, 'X', event, timestamp);
const archive = (mmsi, name, length, extra = {}) =>
  db.prepare(`INSERT INTO vessel_archive (mmsi, name, imo, length, width, vessel_type_label, flag_country, first_seen, last_seen)
    VALUES (@mmsi, @name, @imo, @length, @width, @type, @flag, '2026-01-01T00:00:00.000Z', '2026-11-22T00:00:00.000Z')`)
    .run({ mmsi, name, length, imo: '9357901', width: null, type: null, flag: null, ...extra });

// Open-Meteo responses for one day, shaped like the real API (checked 2026-11-22).
function openMeteo(day, over = {}) {
  const hours = Array.from({ length: 24 }, (_, i) => `${day}T${String(i).padStart(2, '0')}:00`);
  const flat = (v) => hours.map(() => v);
  return {
    forecast: {
      daily: {
        time: [day],
        temperature_2m_max: [26.5], temperature_2m_min: [22.6], precipitation_sum: [26.7],
        wind_speed_10m_max: [25.1], wind_gusts_10m_max: [37.1],
        sunrise: [`${day}T05:45`], sunset: [`${day}T17:12`],
      },
      hourly: {
        time: hours,
        cloud_cover: flat(100), cloud_cover_low: flat(90), cloud_cover_mid: flat(80), cloud_cover_high: flat(100),
        visibility: flat(9660), precipitation_probability: flat(100), relative_humidity_2m: flat(85),
        ...over.hourly,
      },
    },
    marine: { daily: { time: [day], wave_height_max: [2.14] } },
  };
}

// What peekWeather() returns: a 2-day forecast whose first day is `day`.
function liveWeather(day, { cloudLow = 30 } = {}) {
  const next = addDays(day, 1);
  const time = [];
  for (const d of [day, next]) for (let i = 0; i < 24; i++) time.push(`${d}T${String(i).padStart(2, '0')}:00`);
  const flat = (v) => time.map(() => v);
  return {
    weather: {
      current: { relative_humidity_2m: 75 },
      daily: { sunrise: [`${day}T05:45`, `${next}T05:46`], sunset: [`${day}T17:12`, `${next}T17:12`] },
      hourly: {
        time, cloud_cover: flat(40), cloud_cover_low: flat(cloudLow), cloud_cover_mid: flat(20), cloud_cover_high: flat(20),
        visibility: flat(15000), precipitation_probability: flat(0),
      },
    },
    marine: { current: { wave_height: 1.2 } },
  };
}

const stormClear = (updatedAt) => ({ active: false, updatedAt, threat: { level: 'none' }, storm: null });
const stormActive = (updatedAt, { level = 'watch', name = 'KALMAEGI', km = 420, wind = 120 } = {}) => ({
  active: true, updatedAt, threat: { level, currentDistanceKm: km, distanceKm: 300 }, storm: { name, windKmh: wind },
});

const quiet = { log: () => {}, error: () => {} };

// ── Quy Nhon days ──

describe('Quy Nhon day maths (fixed UTC+7, independent of the server time zone)', () => {
  it('puts an instant in the right Quy Nhon day', () => {
    expect(localDay(at('2026-11-21T16:59:59Z'))).toBe('2026-11-21'); // 23:59 in Quy Nhon
    expect(localDay(at('2026-11-21T17:00:00Z'))).toBe('2026-11-22'); // midnight in Quy Nhon
    expect(localDay(at('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });

  it('gives the UTC bounds of a day with second precision and no suffix', () => {
    expect(dayStartMs('2026-11-22')).toBe(at('2026-11-21T17:00:00Z'));
    expect(dayBounds('2026-11-22')).toEqual({ from: '2026-11-21T17:00:00', to: '2026-11-22T17:00:00' });
  });

  it('steps across month and year ends', () => {
    expect(addDays('2026-12-01', -1)).toBe('2026-11-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  // The production server is in US West and a developer machine may sit in
  // Vietnam, where machine-local time happens to give the right answer. Run
  // the day maths in real child processes with other time zones to be sure.
  it('gives the same answers whatever time zone the server is in', () => {
    const script = `
      const m = await import(${JSON.stringify(pathToFileURL(path.resolve('server/daily-log.js')).href)});
      console.log(JSON.stringify({
        offset: new Date(Date.UTC(2026, 10, 22)).getTimezoneOffset(),
        late: m.localDay(Date.parse('2026-11-21T16:59:59Z')),
        midnight: m.localDay(Date.parse('2026-11-21T17:00:00Z')),
        bounds: m.dayBounds('2026-11-22'),
        next: m.addDays('2026-12-31', 1),
      }));`;
    const offsets = new Set();
    for (const TZ of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ } });
      const r = JSON.parse(out.toString());
      offsets.add(r.offset);
      expect(r).toMatchObject({
        late: '2026-11-21', midnight: '2026-11-22', next: '2027-01-01',
        bounds: { from: '2026-11-21T17:00:00', to: '2026-11-22T17:00:00' },
      });
    }
    expect(offsets.size).toBe(3); // the child processes really did run in three different zones
  });
});

// ── Ships ──

describe('shipsForDay', () => {
  const DAY = '2026-11-22';

  it('counts transponders from raw positions and hourly summaries, once each', () => {
    summary('574000001', '2026-11-21T18:00:00');       // 01:00 in Quy Nhon, already compressed
    pos('574000001', '2026-11-22T05:10:00.000Z');      // same ship later, still raw
    pos('574000002', '2026-11-22T05:11:00.000Z');
    const s = shipsForDay(db, DAY);
    expect(s.transponders).toBe(2);
    expect(s.ships_seen).toBe(2);
  });

  it('keeps each day inside its own bounds for both timestamp shapes', () => {
    summary('574000001', '2026-11-21T16:00:00');       // 23:00 the day before
    summary('574000002', '2026-11-21T17:00:00');       // first hour of the day (bucket has no ms or Z)
    pos('574000003', '2026-11-21T17:00:00.000Z');      // first instant of the day
    pos('574000004', '2026-11-22T16:59:59.999Z');      // last instant of the day
    pos('574000005', '2026-11-22T17:00:00.000Z');      // first instant of the next day
    summary('574000006', '2026-11-22T17:00:00');       // first hour of the next day
    summary('574000007', '2006-12-23T18:00:00');       // junk timestamp seen in production
    expect(shipsForDay(db, DAY).transponders).toBe(3);
    expect(shipsForDay(db, '2026-11-21').transponders).toBe(1);
    expect(shipsForDay(db, '2026-11-23').transponders).toBe(2);
  });

  it('leaves fishing gear out of ships and arrivals but keeps it in transponders', () => {
    pos('574000001', '2026-11-22T03:00:00.000Z');
    pos('574100236', '2026-11-22T03:00:00.000Z');      // a net marker
    visit('574000001', 'arrival', '2026-11-22T03:00:00.000Z');
    visit('574100236', 'arrival', '2026-11-22T03:05:00.000Z');
    const s = shipsForDay(db, DAY, new Set(['574100236']));
    expect(s.transponders).toBe(2);
    expect(s.ships_seen).toBe(1);
    expect(s.arrivals).toBe(1);
  });

  it('counts arrivals only, and only inside the day', () => {
    visit('574000001', 'arrival', '2026-11-21T16:59:00.000Z');   // 23:59 the day before
    visit('574000001', 'arrival', '2026-11-21T17:01:00.000Z');   // 00:01
    visit('574000002', 'arrival', '2026-11-22T16:30:00.000Z');   // 23:30
    visit('574000002', 'departure', '2026-11-22T10:00:00.000Z');
    visit('574000003', 'arrival', '2026-11-22T17:00:00.000Z');   // midnight, next day
    expect(shipsForDay(db, DAY).arrivals).toBe(2);
  });

  it('picks the largest named ship heard that day and copies its details', () => {
    archive('574000001', 'TRAN GIA 09', 92, { width: 15, type: 'Cargo', flag: 'VN' });
    archive('353000002', 'PACIFIC GRACE', 190, { width: 32, type: 'Cargo', flag: 'PA' });
    archive('574000003', 'NOT HERE TODAY', 300);
    archive('574000004', 'BAD LENGTH', 511);
    archive('574100236', 'P2LXUNOIQDAT A18', 200);       // gear with a junk length
    for (const m of ['574000001', '353000002', '574000004', '574100236', '574000009']) pos(m, '2026-11-22T03:00:00.000Z');
    const s = shipsForDay(db, DAY, new Set(['574100236']));
    expect(s).toMatchObject({
      largest_mmsi: '353000002', largest_name: 'PACIFIC GRACE', largest_length_m: 190,
      largest_width_m: 32, largest_type: 'Cargo', largest_flag: 'PA',
    });
    expect(s.ships_seen).toBe(4);   // the unnamed 574000009 counts as a ship, like on the home page
  });

  it('does not let a small boat with a mis-set transponder be the largest ship', () => {
    // Real rows from the production archive: no IMO number, impossible sizes.
    archive('574000011', 'THONGTIN', 343, { imo: null, width: 57, type: 'Fishing', flag: 'VN' });
    archive('574000012', '66B1 GIA CAO GE LUI', 330, { imo: '0000000', width: 16, type: 'Pilot Vessel', flag: 'VN' });
    archive('538000013', 'FIRST ANGEL', 200, { imo: '9357901', width: 32, type: 'Cargo', flag: 'PA' });
    for (const m of ['574000011', '574000012', '538000013']) pos(m, '2026-11-22T03:00:00.000Z');
    const s = shipsForDay(db, DAY);
    expect(s.largest_name).toBe('FIRST ANGEL');
    expect(s.ships_seen).toBe(3);   // they still count as ships seen
  });

  it('records no largest ship when none of the ships heard has an IMO number', () => {
    archive('574000011', 'THONGTIN', 343, { imo: null });
    pos('574000011', '2026-11-22T03:00:00.000Z');
    expect(shipsForDay(db, DAY).largest_name).toBeNull();
  });

  it('counts the hours of the day the feed covered', () => {
    pos('574000001', '2026-11-22T03:05:00.000Z');
    pos('574000002', '2026-11-22T03:55:00.000Z');
    pos('574000001', '2026-11-22T04:10:00.000Z');
    summary('574000001', '2026-11-21T20:00:00');
    summary('574000001', '2026-11-21T20:00:00');       // the compressor can write a bucket twice
    expect(shipsForDay(db, DAY).feed_hours).toBe(3);
  });

  it('returns zeros and no largest ship for a day with nothing heard', () => {
    expect(shipsForDay(db, DAY)).toEqual({
      transponders: 0, ships_seen: 0, arrivals: 0, feed_hours: 0,
      largest_mmsi: null, largest_name: null, largest_length_m: null, largest_width_m: null, largest_type: null, largest_flag: null,
    });
  });
});

// ── Weather ──

describe('parseDayWeather', () => {
  const DAY = '2026-11-21';

  it('maps the Open-Meteo daily values to columns', () => {
    const w = parseDayWeather(DAY, openMeteo(DAY));
    expect(w).toMatchObject({
      temp_min_c: 22.6, temp_max_c: 26.5, rain_mm: 26.7, wind_max_kmh: 25.1, gust_max_kmh: 37.1,
      wave_max_m: 2.14, sunrise: '05:45', sunset: '17:12',
    });
  });

  it('throws when the response does not contain the day, so it is retried', () => {
    expect(() => parseDayWeather('2026-11-20', openMeteo(DAY))).toThrow(/no daily values/);
    expect(() => parseDayWeather(DAY, { forecast: { error: true } })).toThrow();
  });

  it('keeps a missing value as null', () => {
    const data = openMeteo(DAY);
    data.forecast.daily.precipitation_sum = [null];
    data.marine = { error: true };
    const w = parseDayWeather(DAY, data);
    expect(w.rain_mm).toBeNull();
    expect(w.wave_max_m).toBeNull();
    expect(w.temp_max_c).toBe(26.5);
  });

  it('asks Open-Meteo for exactly one day, with the model the site shows', () => {
    const u = dayWeatherUrls(DAY);
    expect(u.forecast).toContain('start_date=2026-11-21&end_date=2026-11-21');
    expect(u.forecast).toContain('models=gfs_seamless');
    expect(u.forecast).toContain('timezone=Asia%2FHo_Chi_Minh');
    expect(u.marine).toContain('daily=wave_height_max');
  });
});

describe('hindcastSunset', () => {
  const DAY = '2026-11-21';

  it('scores the hour the sun set, not another hour of the day', () => {
    const hourly = {};
    const fill = (dflt, atSunset) => Array.from({ length: 24 }, (_, i) => (i === 17 ? atSunset : dflt));
    hourly.cloud_cover = fill(100, 40);
    hourly.cloud_cover_low = fill(90, 30);
    hourly.cloud_cover_mid = fill(80, 20);
    hourly.cloud_cover_high = fill(100, 20);
    hourly.visibility = fill(1000, 15000);
    hourly.precipitation_probability = fill(100, 0);
    hourly.relative_humidity_2m = fill(95, 75);
    // 25 low + 15 mid + 8 high + 15 haze + 15 no rain + 15 humidity
    expect(hindcastSunset(DAY, openMeteo(DAY, { hourly }).forecast)).toEqual({ score: 93, level: 'spectacular' });
  });

  it('rates a fully overcast, rainy evening as ordinary', () => {
    expect(hindcastSunset(DAY, openMeteo(DAY).forecast).level).toBe('ordinary');
  });

  it('returns null without hourly data', () => {
    const { forecast } = openMeteo(DAY);
    delete forecast.hourly;
    expect(hindcastSunset(DAY, forecast)).toBeNull();
  });
});

// ── Readings ──

describe('stormReading', () => {
  const NOW = at('2026-11-22T06:00:00Z');

  it('has nothing to say without a usable snapshot', () => {
    expect(stormReading(null, NOW)).toBeNull();
    expect(stormReading(stormClear('2026-11-22T02:00:00Z'), NOW)).toBeNull();                 // 4 hours old
    expect(stormReading({ ...stormActive('2026-11-22T05:50:00Z'), demo: true }, NOW)).toBeNull();
    expect(stormReading({ active: false }, NOW)).toBeNull();                                  // no timestamp
  });

  it('does not count a snapshot the tracker is repeating because it could not refresh', () => {
    const repeated = { ...stormClear('2026-11-22T05:40:00Z'), refreshFailedAt: '2026-11-22T05:58:00.000Z' };
    expect(stormReading(repeated, NOW)).toBeNull();
    const storm = { ...stormActive('2026-11-22T05:40:00Z'), refreshFailedAt: '2026-11-22T05:58:00.000Z' };
    expect(stormReading(storm, NOW)).toBeNull();
  });

  it('reads "none" only from a fresh all-clear', () => {
    expect(stormReading(stormClear('2026-11-22T05:40:00Z'), NOW)).toEqual({ level: 'none', name: null, km: null, wind: null });
  });

  it('reads the level, name, current distance and wind of an active storm', () => {
    expect(stormReading(stormActive('2026-11-22T05:55:00Z'), NOW))
      .toEqual({ level: 'watch', name: 'KALMAEGI', km: 420, wind: 120 });
  });

  it('treats an active storm with no grade as "monitor", as the pages do', () => {
    const s = stormActive('2026-11-22T05:55:00Z');
    delete s.threat.level;
    expect(stormReading(s, NOW).level).toBe('monitor');
  });
});

describe('mergeStorm', () => {
  const empty = { level: null, name: null, km: null, wind: null };

  it('keeps the highest level of the day', () => {
    let d = mergeStorm(empty, { level: 'none', name: null, km: null, wind: null });
    expect(d.level).toBe('none');
    d = mergeStorm(d, { level: 'watch', name: 'KALMAEGI', km: 420, wind: 120 });
    d = mergeStorm(d, { level: 'monitor', name: 'KALMAEGI', km: 380, wind: 100 });
    d = mergeStorm(d, { level: 'none', name: null, km: null, wind: null });
    expect(d).toEqual({ level: 'watch', name: 'KALMAEGI', km: 380, wind: 120 }); // nearest distance, peak wind
  });

  it('switches to a different storm only when it is graded higher, or equal and nearer', () => {
    const a = { level: 'monitor', name: 'A', km: 900, wind: 70 };
    expect(mergeStorm(a, { level: 'monitor', name: 'B', km: 1200, wind: 150 })).toEqual(a);
    expect(mergeStorm(a, { level: 'monitor', name: 'B', km: 700, wind: 60 })).toEqual({ level: 'monitor', name: 'B', km: 700, wind: 60 });
    expect(mergeStorm(a, { level: 'warning', name: 'B', km: 1500, wind: 60 })).toEqual({ level: 'warning', name: 'B', km: 1500, wind: 60 });
  });
});

describe('sunsetReading', () => {
  const DAY = '2026-11-22';

  it('gives the rating the site shows before sunset', () => {
    const r = sunsetReading(liveWeather(DAY), DAY, at('2026-11-22T08:00:00Z')); // 15:00 in Quy Nhon
    expect(r).toEqual({ score: 93, level: 'spectacular', time: '17:12' });
  });

  it('gives nothing after sunset, when the site has moved on to tomorrow', () => {
    expect(sunsetReading(liveWeather(DAY), DAY, at('2026-11-22T10:13:00Z'))).toBeNull(); // 17:13
  });

  it('gives nothing when the cached forecast is for another day or missing', () => {
    expect(sunsetReading(liveWeather('2026-11-21'), DAY, at('2026-11-21T17:05:00Z'))).toBeNull(); // stale cache just after midnight
    expect(sunsetReading(null, DAY, at('2026-11-22T08:00:00Z'))).toBeNull();
  });
});

// ── The logger ──

describe('createDailyLog', () => {
  const row = (day) => db.prepare('SELECT * FROM daily_log WHERE day = ?').get(day);
  let clock, fetchDay, deps;

  beforeEach(() => {
    clock = at('2026-11-22T08:00:00Z'); // 15:00 on the 22nd in Quy Nhon
    fetchDay = vi.fn(async (day) => openMeteo(day));
    deps = {
      now: () => clock, fetchDay, catchUpDays: 2, log: quiet,
      weather: () => liveWeather(localDay(clock)),
      storm: () => stormClear(new Date(clock - 10 * M).toISOString()),
      gear: () => new Set(['574100236']),
    };
  });

  describe('sampling today', () => {
    it('keeps the highest storm level and counts the readings', () => {
      let snap = stormClear(new Date(clock).toISOString());
      const logger = createDailyLog(db, { ...deps, storm: () => snap });
      logger.sample();
      expect(row('2026-11-22')).toMatchObject({ storm_level: 'none', storm_name: null, storm_checks: 1 });
      snap = stormActive(new Date(clock).toISOString(), { level: 'watch', km: 420, wind: 120 });
      logger.sample();
      snap = stormActive(new Date(clock).toISOString(), { level: 'monitor', km: 390, wind: 100 });
      logger.sample();
      expect(row('2026-11-22')).toMatchObject({
        storm_level: 'watch', storm_name: 'KALMAEGI', storm_min_km: 390, storm_wind_kmh: 120, storm_checks: 3,
      });
    });

    it('leaves the storm level empty when the tracker has nothing fresh', () => {
      const logger = createDailyLog(db, { ...deps, storm: () => stormClear('2026-11-22T01:00:00Z'), weather: () => null });
      logger.sample();
      expect(row('2026-11-22')).toBeUndefined();
    });

    it('keeps the last sunset rating shown before sunset', () => {
      let cloudLow = 80; // a dull forecast in the afternoon
      const logger = createDailyLog(db, { ...deps, weather: () => liveWeather('2026-11-22', { cloudLow }) });
      logger.sample();
      const dull = row('2026-11-22').sunset_score;
      cloudLow = 30;      // the forecast improves
      clock += 1 * H;
      logger.sample();
      expect(row('2026-11-22')).toMatchObject({ sunset_score: 93, sunset_level: 'spectacular', sunset_source: 'forecast', sunset: '17:12' });
      expect(dull).toBeLessThan(93);
      cloudLow = 80;
      clock += 2 * H;     // 18:00, after sunset: the site now shows tomorrow
      logger.sample();
      expect(row('2026-11-22').sunset_score).toBe(93);
    });
  });

  describe('completing finished days', () => {
    const seedYesterday = () => {
      archive('574000001', 'TRAN GIA 09', 92, { type: 'Cargo', flag: 'VN' });
      summary('574000001', '2026-11-20T18:00:00');           // 01:00 on the 21st
      pos('574000002', '2026-11-21T09:00:00.000Z');
      pos('574100236', '2026-11-21T09:00:00.000Z');          // gear
      visit('574000001', 'arrival', '2026-11-20T18:00:00.000Z');
    };

    it('writes yesterday once it has settled, and not before', async () => {
      seedYesterday();
      clock = at('2026-11-21T17:00:00Z') + SETTLE_MS - M;     // 02:59 on the 22nd
      const logger = createDailyLog(db, deps);
      await logger.tick();
      expect(fetchDay).not.toHaveBeenCalledWith('2026-11-21');
      expect(row('2026-11-21')).toBeUndefined();

      clock += 2 * M;                                         // 03:01
      await logger.tick();
      const r = row('2026-11-21');
      expect(r).toMatchObject({
        transponders: 3, ships_seen: 2, arrivals: 1, feed_hours: 2,
        largest_name: 'TRAN GIA 09', largest_length_m: 92,
        temp_min_c: 22.6, temp_max_c: 26.5, rain_mm: 26.7, wind_max_kmh: 25.1, gust_max_kmh: 37.1, wave_max_m: 2.14,
        sunrise: '05:45', sunset: '17:12', weather_source: WEATHER_SOURCE,
      });
      expect(r.completed_at).toBe(new Date(clock).toISOString());
    });

    it('never touches today beyond sampling', async () => {
      const logger = createDailyLog(db, deps);
      await logger.tick();
      expect(fetchDay).not.toHaveBeenCalledWith('2026-11-22');
      const today = row('2026-11-22');
      expect(today.ships_at).toBeNull();
      expect(today.completed_at).toBeNull();
      expect(today.storm_level).toBe('none');
    });

    it('writes a day once: later ticks do not refetch or recount', async () => {
      seedYesterday();
      const logger = createDailyLog(db, { ...deps, catchUpDays: 1 });
      await logger.tick();
      const first = row('2026-11-21');
      pos('574000099', '2026-11-21T10:00:00.000Z');           // would change the count
      clock += 15 * M;
      await logger.tick();
      expect(fetchDay).toHaveBeenCalledTimes(1);
      expect(row('2026-11-21')).toEqual(first);
    });

    it('keeps the ship counts when the weather fetch fails, and retries until it works', async () => {
      seedYesterday();
      fetchDay.mockRejectedValueOnce(new Error('HTTP 502 from api.open-meteo.com'));
      const logger = createDailyLog(db, { ...deps, catchUpDays: 1 });
      await logger.tick();
      let r = row('2026-11-21');
      expect(r.ships_seen).toBe(2);
      expect(r.weather_at).toBeNull();
      expect(r.completed_at).toBeNull();
      expect(getDailyLog(db)).toEqual([]);                    // pages do not see a half-written day

      clock += 15 * M;
      await logger.tick();
      r = row('2026-11-21');
      expect(r.temp_max_c).toBe(26.5);
      expect(r.completed_at).not.toBeNull();
      expect(getDailyLog(db).map((x) => x.day)).toEqual(['2026-11-21']);
    });

    it('keeps the sunset rating the site showed, and scores after the fact only when there is none', async () => {
      db.prepare("INSERT INTO daily_log (day, sunset_score, sunset_level, sunset_source) VALUES ('2026-11-21', 71, 'vivid', 'forecast')").run();
      const logger = createDailyLog(db, deps);
      await logger.tick();
      expect(row('2026-11-21')).toMatchObject({ sunset_score: 71, sunset_level: 'vivid', sunset_source: 'forecast' });
      const earlier = row('2026-11-20');                      // no reading was taken that day
      expect(earlier.sunset_source).toBe('hindcast');
      expect(earlier.sunset_level).toBe('ordinary');
    });

    it('leaves the storm level empty for a day with no readings, and keeps one that has them', async () => {
      db.prepare("INSERT INTO daily_log (day, storm_level, storm_name, storm_checks) VALUES ('2026-11-21', 'watch', 'KALMAEGI', 90)").run();
      const logger = createDailyLog(db, deps);
      await logger.tick();
      expect(row('2026-11-21')).toMatchObject({ storm_level: 'watch', storm_name: 'KALMAEGI', storm_checks: 90 });
      expect(row('2026-11-20')).toMatchObject({ storm_level: null, storm_checks: 0 });
      expect(row('2026-11-20').completed_at).not.toBeNull();
    });

    it('catches up on missed days, one ship count per tick, oldest first', async () => {
      const logger = createDailyLog(db, { ...deps, catchUpDays: 3 });
      expect(logger.pendingDays()).toEqual(['2026-11-19', '2026-11-20', '2026-11-21']);
      await logger.tick();
      expect(getDailyLog(db).map((x) => x.day)).toEqual(['2026-11-19']);
      expect(fetchDay).toHaveBeenCalledTimes(3);              // weather is cheap, so every owed day is fetched
      await logger.tick();
      await logger.tick();
      expect(getDailyLog(db).map((x) => x.day)).toEqual(['2026-11-21', '2026-11-20', '2026-11-19']);
      expect(fetchDay).toHaveBeenCalledTimes(3);
      expect(logger.pendingDays()).toEqual([]);
    });

    it('does not run two ticks at once', async () => {
      let release;
      fetchDay.mockImplementationOnce((day) => new Promise((resolve) => { release = () => resolve(openMeteo(day)); }));
      const logger = createDailyLog(db, { ...deps, catchUpDays: 1 });
      const slow = logger.tick();
      await logger.tick();                                    // returns at once
      expect(fetchDay).toHaveBeenCalledTimes(1);
      release();
      await slow;
      expect(row('2026-11-21').completed_at).not.toBeNull();
    });
  });
});

describe('getDailyLog', () => {
  it('returns finished days newest first, and open days only on request', () => {
    const ins = db.prepare('INSERT INTO daily_log (day, completed_at) VALUES (?, ?)');
    ins.run('2026-11-20', '2026-11-20T20:05:00.000Z');
    ins.run('2026-11-21', '2026-11-21T20:05:00.000Z');
    ins.run('2026-11-22', null);
    expect(getDailyLog(db).map((r) => r.day)).toEqual(['2026-11-21', '2026-11-20']);
    expect(getDailyLog(db, { limit: 1 }).map((r) => r.day)).toEqual(['2026-11-21']);
    expect(getDailyLog(db, { includeOpen: true }).map((r) => r.day)).toEqual(['2026-11-22', '2026-11-21', '2026-11-20']);
  });
});

describe('startDailyLog', () => {
  afterEach(() => vi.useRealTimers());

  it('runs shortly after boot and then on the interval, until stopped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at('2026-11-22T08:00:00Z'));
    const storm = vi.fn(() => null);
    const stop = startDailyLog(db, { storm, fetchDay: async (day) => openMeteo(day), catchUpDays: 0, log: quiet },
      { intervalMs: 1000, firstRunMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(storm).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(storm).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(storm).toHaveBeenCalledTimes(3);
  });
});

describe('daily_log table', () => {
  it('is created empty alongside the existing tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    expect(tables).toEqual(expect.arrayContaining(['daily_log', 'vessels', 'vessel_archive', 'vessel_visits', 'position_summaries']));
    expect(db.prepare('SELECT COUNT(*) c FROM daily_log').get().c).toBe(0);
  });
});
