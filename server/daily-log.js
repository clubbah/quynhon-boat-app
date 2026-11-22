/**
 * Daily record: one row in daily_log per Quy Nhon calendar day.
 *
 * The site kept no history of weather, sea, sunsets or how busy the bay was.
 * This writes one row a day so that data pages (sunset history, weather by
 * month, port activity) have a record to show. The record only becomes useful
 * with time, so it starts as early as possible.
 *
 * A tick runs every 15 minutes and does two things:
 *
 *   1. Samples today. The storm tracker and the sunset rating exist only in
 *      memory, so today's row keeps the highest storm threat level read so far
 *      and the last sunset rating the site showed before sunset.
 *
 *   2. Completes finished days. Once a day has been over for a few hours it
 *      fills in the rest:
 *        - weather and sea, from one Open-Meteo request for that date (same
 *          GFS model the site shows). This is a background job, not a page
 *          render, so waiting on Open-Meteo here is fine.
 *        - ships, from SQLite: transponders heard, ships (not fishing gear),
 *          arrivals, the largest ship, and how many hours the feed covered.
 *      Each part is written once and never recomputed. A failed weather fetch
 *      is retried on later ticks. Up to CATCH_UP_DAYS missed days are filled
 *      in after an outage or on first start.
 *
 * Days are Quy Nhon days. Vietnam is UTC+7 all year, so a fixed offset is
 * used and nothing here depends on the server's own time zone (the server is
 * in US West). Note that the 14-day chart on /trends buckets by UTC day, so
 * its daily arrival counts can differ slightly from this table.
 *
 * NULL always means "not recorded". In particular storm_level is NULL when no
 * usable reading was taken that day, and 'none' only when the tracker was
 * checked and reported nothing.
 *
 * ships_seen uses the gear rule as it stood when the day was completed (the
 * rule is derived, never stored, and can change). transponders is the raw
 * count, kept beside it for that reason.
 */

import { scoreSunset, sunsetForecast } from '../public/js/sunset.js';
import { hasValidImo } from './vessel-class.js';

const QN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SETTLE_MS = 3 * 60 * 60 * 1000;       // complete a day 3h after it ends, once the model has settled
export const CATCH_UP_DAYS = 7;                    // how far back to fill in missed days
export const STORM_FRESH_MS = 3 * 60 * 60 * 1000;  // ignore a storm snapshot older than this
export const WEATHER_SOURCE = 'open-meteo gfs_seamless';

const LEVEL_RANK = { none: 0, monitor: 1, watch: 2, warning: 3 };

// ── Quy Nhon days ──

/** The Quy Nhon calendar day (YYYY-MM-DD) that contains this instant. */
export function localDay(ms) {
  return new Date(ms + QN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant (ms) at which this Quy Nhon day starts. */
export function dayStartMs(day) {
  return Date.parse(`${day}T00:00:00Z`) - QN_OFFSET_MS;
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * UTC bounds of a Quy Nhon day as { from, to } for `timestamp >= from AND
 * timestamp < to`. Second precision with no suffix on purpose: stored
 * timestamps come in two shapes, "2026-11-21T17:00:00.000Z" (positions,
 * visits) and "2026-11-21T17:00:00" (hourly summaries), and a bound of this
 * shape sorts correctly against both.
 */
export function dayBounds(day) {
  const start = dayStartMs(day);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19);
  return { from: iso(start), to: iso(start + DAY_MS) };
}

// ── Ships ──

/**
 * What the antenna heard on one Quy Nhon day. `gear` is the Set of MMSIs
 * classed as fishing gear (see vessel-class.js). Raw positions are kept for
 * 24 hours and then folded into hourly summaries, so both tables are read.
 */
export function shipsForDay(db, day, gear = new Set()) {
  const { from, to } = dayBounds(day);
  const heard = new Set();
  const hours = new Set();
  for (const table of ['position_history', 'position_summaries']) {
    const rows = db.prepare(
      `SELECT DISTINCT mmsi, substr(timestamp, 1, 13) AS hour FROM ${table} WHERE timestamp >= ? AND timestamp < ?`,
    ).all(from, to);
    for (const r of rows) {
      if (!r.mmsi) continue;
      heard.add(r.mmsi);
      hours.add(r.hour);
    }
  }

  // Same rule as the live count on the home page: everything that is not
  // fishing gear, unnamed transponders included.
  const ships = [...heard].filter((mmsi) => !gear.has(mmsi));

  const arrivals = db.prepare(
    "SELECT mmsi FROM vessel_visits WHERE event = 'arrival' AND timestamp >= ? AND timestamp < ?",
  ).all(from, to).filter((r) => !gear.has(r.mmsi)).length;

  // Largest named ship of the day. The row keeps a copy of its details as
  // they were. Only ships with an IMO number qualify: on the production
  // archive (Nov 2026) small boats with mis-set transponders report lengths
  // of 250 to 340 m (a 343 m "fishing" boat, a 330 x 16 m pilot boat), and
  // none of those has an IMO number, while every real ship that size does.
  const archive = db.prepare(
    'SELECT mmsi, name, imo, length, width, vessel_type_label, flag_country FROM vessel_archive WHERE mmsi = ?',
  );
  let largest = null;
  for (const mmsi of ships) {
    const a = archive.get(mmsi);
    if (!a || !a.name || !hasValidImo(a.imo) || !(a.length >= 1 && a.length <= 450)) continue;
    if (!largest || a.length > largest.length
      || (a.length === largest.length && String(a.name) < String(largest.name))) largest = a;
  }

  return {
    transponders: heard.size,
    ships_seen: ships.length,
    arrivals,
    feed_hours: hours.size,
    largest_mmsi: largest?.mmsi ?? null,
    largest_name: largest?.name ?? null,
    largest_length_m: largest?.length ?? null,
    largest_width_m: largest?.width ?? null,
    largest_type: largest?.vessel_type_label ?? null,
    largest_flag: largest?.flag_country ?? null,
  };
}

// ── Weather ──

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
const PLACE = 'latitude=13.76&longitude=109.23&timezone=Asia%2FHo_Chi_Minh';

export function dayWeatherUrls(day) {
  const range = `start_date=${day}&end_date=${day}`;
  return {
    forecast: `${FORECAST_API}?${PLACE}&${range}&models=gfs_seamless`
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset'
      + '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation_probability,relative_humidity_2m',
    marine: `${MARINE_API}?${PLACE}&${range}&daily=wave_height_max`,
  };
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** One day's weather and sea from Open-Meteo: { forecast, marine }. */
export async function fetchDayWeather(day, fetchImpl = fetch) {
  const urls = dayWeatherUrls(day);
  const [forecast, marine] = await Promise.all([fetchJson(urls.forecast, fetchImpl), fetchJson(urls.marine, fetchImpl)]);
  return { forecast, marine };
}

const hhmm = (iso) => (typeof iso === 'string' && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : null);

/**
 * Sunset rating scored after the fact from the model's values for the hour
 * the sun set, with the same model the live page uses. Null when the hourly
 * data is missing.
 */
export function hindcastSunset(day, forecast) {
  const d = forecast?.daily;
  const h = forecast?.hourly;
  const i = d?.time?.indexOf(day) ?? -1;
  const sunsetISO = i >= 0 ? d.sunset?.[i] : null;
  if (!sunsetISO || !h?.time) return null;
  const idx = h.time.indexOf(`${day}T${sunsetISO.slice(11, 13)}:00`);
  if (idx < 0) return null;
  const pick = (arr, fallback) => (arr && arr[idx] != null ? arr[idx] : fallback);
  const { score, level } = scoreSunset({
    cloudLow: pick(h.cloud_cover_low, 50),
    cloudMid: pick(h.cloud_cover_mid, 50),
    cloudHigh: pick(h.cloud_cover_high, 50),
    cloudTotal: pick(h.cloud_cover, 50),
    visibility: pick(h.visibility, 20000),
    precipProb: pick(h.precipitation_probability, 0),
    humidity: pick(h.relative_humidity_2m, 70),
  });
  return { score, level };
}

/** Turn the two Open-Meteo responses into daily_log columns. Throws if the day is not in the response. */
export function parseDayWeather(day, { forecast, marine } = {}) {
  const d = forecast?.daily;
  const i = d?.time?.indexOf(day) ?? -1;
  if (i < 0) throw new Error(`Open-Meteo returned no daily values for ${day}`);
  const num = (arr, idx) => (arr && Number.isFinite(arr[idx]) ? arr[idx] : null);
  const mi = marine?.daily?.time?.indexOf(day) ?? -1;
  return {
    temp_min_c: num(d.temperature_2m_min, i),
    temp_max_c: num(d.temperature_2m_max, i),
    rain_mm: num(d.precipitation_sum, i),
    wind_max_kmh: num(d.wind_speed_10m_max, i),
    gust_max_kmh: num(d.wind_gusts_10m_max, i),
    wave_max_m: mi >= 0 ? num(marine.daily.wave_height_max, mi) : null,
    sunrise: hhmm(d.sunrise?.[i]),
    sunset: hhmm(d.sunset?.[i]),
    hindcast: hindcastSunset(day, forecast),
  };
}

// ── Readings taken during the day ──

/**
 * A storm reading from the tracker's snapshot, or null when there is nothing
 * usable: no snapshot yet, a demo snapshot, or one too old to trust.
 */
export function stormReading(snapshot, nowMs) {
  if (!snapshot || snapshot.demo) return null;
  const at = Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(at) || nowMs - at > STORM_FRESH_MS) return null;
  if (!snapshot.active || !snapshot.storm) return { level: 'none', name: null, km: null, wind: null };
  const th = snapshot.threat || {};
  return {
    level: LEVEL_RANK[th.level] > 0 ? th.level : 'monitor',
    name: snapshot.storm.name || null,
    km: Number.isFinite(th.currentDistanceKm) ? th.currentDistanceKm : null,
    wind: Number.isFinite(snapshot.storm.windKmh) ? snapshot.storm.windKmh : null,
  };
}

const least = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
const most = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

/**
 * Fold a reading into the day so far. The day keeps its highest level and the
 * storm that caused it, with that storm's nearest distance and peak wind.
 */
export function mergeStorm(cur, r) {
  const next = { ...cur };
  const higher = cur.level == null || LEVEL_RANK[r.level] > LEVEL_RANK[cur.level];
  const sameStorm = r.name != null && r.name === cur.name;
  const nearerRival = !higher && !sameStorm && r.name != null
    && LEVEL_RANK[r.level] === LEVEL_RANK[cur.level] && r.km != null && (cur.km == null || r.km < cur.km);
  if (higher) next.level = r.level;
  if ((higher && !sameStorm) || nearerRival) {
    next.name = r.name; next.km = r.km; next.wind = r.wind;
  } else if (sameStorm) {
    next.km = least(cur.km, r.km); next.wind = most(cur.wind, r.wind);
  }
  return next;
}

/**
 * The sunset rating the site is showing for this evening, or null once the
 * sun has set or when the cached forecast is not for this day.
 */
export function sunsetReading(weatherData, day, nowMs) {
  const w = weatherData?.weather;
  const sunsetISO = w?.daily?.sunset?.[0];
  if (!sunsetISO || sunsetISO.slice(0, 10) !== day) return null;
  const f = sunsetForecast(w, new Date(nowMs));
  if (!f || f.when !== 'today') return null;
  return { score: f.score, level: f.level, time: f.time.slice(0, 5) };
}

// ── The logger ──

/**
 * deps (all optional, all injected so tests need no network or clock):
 *   now()        current time in ms
 *   weather()    cached Open-Meteo data, as peekWeather() returns it
 *   storm()      cached storm snapshot, as peekStormSnapshot() returns it
 *   gear()       Set of MMSIs classed as fishing gear
 *   fetchDay(d)  async, returns { forecast, marine } for one day
 */
export function createDailyLog(db, {
  now = () => Date.now(),
  weather = () => null,
  storm = () => null,
  gear = () => new Set(),
  fetchDay = fetchDayWeather,
  catchUpDays = CATCH_UP_DAYS,
  settleMs = SETTLE_MS,
  log = console,
} = {}) {
  const iso = (ms) => new Date(ms).toISOString();
  const getRow = (day) => db.prepare('SELECT * FROM daily_log WHERE day = ?').get(day);
  const ensureRow = (day) => db.prepare('INSERT OR IGNORE INTO daily_log (day) VALUES (?)').run(day);

  /** Record today's storm level and sunset rating as they stand right now. */
  function sample(t = now()) {
    const day = localDay(t);

    const reading = stormReading(storm(), t);
    if (reading) {
      ensureRow(day);
      const row = getRow(day);
      const merged = mergeStorm(
        { level: row.storm_level, name: row.storm_name, km: row.storm_min_km, wind: row.storm_wind_kmh }, reading,
      );
      db.prepare(`UPDATE daily_log SET storm_level = @level, storm_name = @name, storm_min_km = @km,
        storm_wind_kmh = @wind, storm_checks = storm_checks + 1 WHERE day = @day`).run({ ...merged, day });
    }

    const sun = sunsetReading(weather(), day, t);
    if (sun) {
      ensureRow(day);
      db.prepare(`UPDATE daily_log SET sunset_score = @score, sunset_level = @level, sunset_source = 'forecast',
        sunset = @time WHERE day = @day`).run({ ...sun, day });
    }
  }

  function writeShips(day, t) {
    const s = shipsForDay(db, day, gear());
    db.prepare(`UPDATE daily_log SET transponders = @transponders, ships_seen = @ships_seen, arrivals = @arrivals,
      feed_hours = @feed_hours, largest_mmsi = @largest_mmsi, largest_name = @largest_name,
      largest_length_m = @largest_length_m, largest_width_m = @largest_width_m, largest_type = @largest_type,
      largest_flag = @largest_flag, ships_at = @at WHERE day = @day`).run({ ...s, at: iso(t), day });
  }

  function writeWeather(day, data, t) {
    const { hindcast, ...w } = parseDayWeather(day, data);
    db.prepare(`UPDATE daily_log SET temp_min_c = @temp_min_c, temp_max_c = @temp_max_c, rain_mm = @rain_mm,
      wind_max_kmh = @wind_max_kmh, gust_max_kmh = @gust_max_kmh, wave_max_m = @wave_max_m, sunrise = @sunrise,
      sunset = COALESCE(@sunset, sunset), weather_source = @source, weather_at = @at WHERE day = @day`)
      .run({ ...w, source: WEATHER_SOURCE, at: iso(t), day });
    // Keep the rating the site showed that evening. Score after the fact only
    // when there is none (a day from before this log existed, or an outage).
    if (hindcast) {
      db.prepare(`UPDATE daily_log SET sunset_score = @score, sunset_level = @level, sunset_source = 'hindcast'
        WHERE day = @day AND sunset_score IS NULL`).run({ ...hindcast, day });
    }
  }

  /** Days that are over, have settled, and still have something owed. Oldest first. */
  function pendingDays(t = now()) {
    const today = localDay(t);
    const out = [];
    for (let n = catchUpDays; n >= 1; n--) {
      const day = addDays(today, -n);
      if (t < dayStartMs(day) + DAY_MS + settleMs) continue;
      if (!getRow(day)?.completed_at) out.push(day);
    }
    return out;
  }

  async function completePending(t = now()) {
    // The ship counts scan a day of positions, so at most one day per tick.
    let shipsBudget = 1;
    for (const day of pendingDays(t)) {
      ensureRow(day);
      const row = getRow(day);
      if (!row.ships_at && shipsBudget > 0) {
        writeShips(day, t);
        shipsBudget--;
      }
      if (!row.weather_at) {
        try {
          writeWeather(day, await fetchDay(day), t);
        } catch (err) {
          log.error(`[DailyLog] Weather for ${day} not available yet, will retry: ${err.message}`);
        }
      }
      const done = db.prepare(`UPDATE daily_log SET completed_at = ? WHERE day = ? AND completed_at IS NULL
        AND ships_at IS NOT NULL AND weather_at IS NOT NULL`).run(iso(t), day).changes;
      if (done) {
        const r = getRow(day);
        log.log(`[DailyLog] ${day} recorded: ${r.ships_seen} ships, ${r.arrivals} arrivals, `
          + `${r.temp_min_c} to ${r.temp_max_c} C, ${r.rain_mm} mm rain, sunset ${r.sunset_level || 'not rated'}, `
          + `storm ${r.storm_level || 'not recorded'}`);
      }
    }
  }

  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const t = now();
      try { sample(t); } catch (err) { log.error('[DailyLog] Sampling failed:', err.message); }
      await completePending(t);
    } finally {
      running = false;
    }
  }

  return { tick, sample, pendingDays, completePending };
}

/**
 * Start the 15-minute tick. The first run waits a little so the weather and
 * storm caches have filled after boot. Returns a function that stops it.
 */
export function startDailyLog(db, deps = {}, { intervalMs = 15 * 60 * 1000, firstRunMs = 2 * 60 * 1000 } = {}) {
  const logger = createDailyLog(db, deps);
  const run = () => logger.tick().catch((err) => console.error('[DailyLog] Tick failed:', err.message));
  const first = setTimeout(run, firstRunMs);
  const id = setInterval(run, intervalMs);
  return () => { clearTimeout(first); clearInterval(id); };
}

/** Rows for pages, newest first. Only finished days unless includeOpen is set. */
export function getDailyLog(db, { limit = 30, includeOpen = false } = {}) {
  const where = includeOpen ? '' : 'WHERE completed_at IS NOT NULL';
  return db.prepare(`SELECT * FROM daily_log ${where} ORDER BY day DESC LIMIT ?`).all(limit);
}
