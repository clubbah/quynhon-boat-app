/**
 * Filling in history that already exists somewhere, used by
 * scripts/backfill-history.js. Two separate jobs, both insert-only:
 *
 *   1. weather_archive: past weather and sea for Quy Nhon from Open-Meteo's
 *      historical archive, back to 2016. This feeds the month-by-month table.
 *      It is reference data from a different model (ERA5 reanalysis) than the
 *      forecast model the live pages show, so it lives in its own table.
 *
 *   2. daily_log: ship counts for the days before the daily record started,
 *      as far back as the site's own position data goes (hourly summaries are
 *      kept 90 days). Weather for those days is copied from weather_archive.
 *      They get no sunset rating: the archive has no visibility or rain
 *      probability to score one honestly.
 *
 * Nothing here overwrites a value that is already there.
 *
 * OPEN-METEO TERMS (read 2026-11-22, open-meteo.com/en/terms): the free API
 * is for non-commercial use, under 10,000 calls a day, and the data is CC BY
 * 4.0, so any page that shows it must credit Open-Meteo. A site that shows
 * ads or has subscriptions counts as commercial and needs a paid plan.
 * quynhonlife.com has neither today. REVISIT THIS if ads, affiliate links or
 * paid features are ever added: the same applies to weather.js and
 * daily-log.js.
 */

import { localDay, dayStartMs, addDays, shipsForDay, CATCH_UP_DAYS } from './daily-log.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACE = 'latitude=13.76&longitude=109.23&timezone=Asia%2FHo_Chi_Minh';

export const ARCHIVE_START = '2016-01-01';
export const ARCHIVE_SOURCE = 'open-meteo archive era5_seamless, marine era5_ocean';

// ── Weather archive ──

// One request each covers the whole range (checked: ten years of daily values
// come back in a single call). The models are pinned so every year comes from
// the same reanalysis: era5_seamless for weather, era5_ocean for waves.
export function archiveUrls(from, to) {
  const range = `start_date=${from}&end_date=${to}`;
  return {
    weather: `https://archive-api.open-meteo.com/v1/archive?${PLACE}&${range}&models=era5_seamless`
      + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset',
    marine: `https://marine-api.open-meteo.com/v1/marine?${PLACE}&${range}&models=era5_ocean&daily=wave_height_max`,
  };
}

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** Raw archive responses for a date range: { weather, marine }. */
export async function fetchArchive(from, to, fetchImpl = fetch) {
  const urls = archiveUrls(from, to);
  const [weather, marine] = await Promise.all([fetchJson(urls.weather, fetchImpl), fetchJson(urls.marine, fetchImpl)]);
  return { weather, marine };
}

const hhmm = (iso) => (typeof iso === 'string' && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : null);
const num = (arr, i) => (arr && Number.isFinite(arr[i]) ? arr[i] : null);

/**
 * Archive responses as weather_archive rows. The archive runs about six days
 * behind, so the last days of a range come back empty: a day with no
 * temperature is left out and picked up by a later run.
 */
export function parseArchive({ weather, marine } = {}) {
  const d = weather?.daily;
  if (!d || !Array.isArray(d.time)) throw new Error('Open-Meteo archive returned no daily values');
  const waves = new Map();
  (marine?.daily?.time || []).forEach((day, i) => waves.set(day, num(marine.daily.wave_height_max, i)));
  const rows = [];
  d.time.forEach((day, i) => {
    const max = num(d.temperature_2m_max, i);
    const min = num(d.temperature_2m_min, i);
    if (max == null || min == null) return;
    rows.push({
      day,
      temp_min_c: min,
      temp_max_c: max,
      rain_mm: num(d.precipitation_sum, i),
      wind_max_kmh: num(d.wind_speed_10m_max, i),
      gust_max_kmh: num(d.wind_gusts_10m_max, i),
      wave_max_m: waves.get(day) ?? null,
      sunrise: hhmm(d.sunrise?.[i]),
      sunset: hhmm(d.sunset?.[i]),
    });
  });
  return rows;
}

/** Insert archive rows that are not there yet. Returns how many were added. */
export function storeArchive(db, rows, { now = Date.now() } = {}) {
  const ins = db.prepare(`INSERT OR IGNORE INTO weather_archive
    (day, temp_min_c, temp_max_c, rain_mm, wind_max_kmh, gust_max_kmh, wave_max_m, sunrise, sunset, source, fetched_at)
    VALUES (@day, @temp_min_c, @temp_max_c, @rain_mm, @wind_max_kmh, @gust_max_kmh, @wave_max_m, @sunrise, @sunset, @source, @at)`);
  const at = new Date(now).toISOString();
  let added = 0;
  // Writes only, and the write lock is taken up front, so this waits its turn
  // behind the live server instead of failing part-way.
  db.transaction(() => {
    for (const r of rows) added += ins.run({ ...r, source: ARCHIVE_SOURCE, at }).changes;
  }).immediate();
  return added;
}

/** The day after the newest one stored, or ARCHIVE_START for an empty table. */
export function archiveResumeDay(db) {
  const last = db.prepare('SELECT MAX(day) AS d FROM weather_archive').get()?.d;
  return last ? addDays(last, 1) : ARCHIVE_START;
}

// ── Ship counts for the days before the daily record ──

/**
 * The first Quy Nhon day the position data covers from its very start. The
 * oldest day on file is cut off part-way by the 90-day prune, and counting it
 * would under-report, so it is skipped. Null when there is no position data.
 */
export function firstFullDay(db, now = Date.now()) {
  // Nothing real is older than the summary window. This also steps over the
  // odd row with a junk timestamp (one from 2006 was seen in production).
  const floor = new Date(now - 100 * DAY_MS).toISOString().slice(0, 19);
  let earliest = null;
  for (const table of ['position_summaries', 'position_history']) {
    const t = db.prepare(`SELECT MIN(timestamp) AS t FROM ${table} WHERE timestamp >= ?`).get(floor)?.t;
    if (t && (!earliest || t.slice(0, 19) < earliest)) earliest = t.slice(0, 19);
  }
  if (!earliest) return null;
  const ms = Date.parse(`${earliest}Z`);
  const day = localDay(ms);
  return dayStartMs(day) >= ms ? day : addDays(day, 1);
}

/**
 * Work out, and with `apply` write, daily_log rows for every finished day the
 * position data still covers and the live writer will not reach (it fills
 * the last `catchUpDays` days itself).
 *
 * Returns one entry per day touched: { day, ships: {...} | null, weather }.
 * `ships` is null for a day whose counts were already there and only needed
 * weather.
 */
export function backfillShips(db, { gear = new Set(), now = Date.now(), catchUpDays = CATCH_UP_DAYS, apply = false } = {}) {
  const first = firstFullDay(db, now);
  const last = addDays(localDay(now), -(catchUpDays + 1));
  const at = new Date(now).toISOString();
  const getRow = db.prepare('SELECT ships_at, weather_at, completed_at FROM daily_log WHERE day = ?');
  const getArchive = db.prepare('SELECT * FROM weather_archive WHERE day = ?');

  const writeShips = db.prepare(`UPDATE daily_log SET transponders = @transponders, ships_seen = @ships_seen,
    arrivals = @arrivals, feed_hours = @feed_hours, largest_mmsi = @largest_mmsi, largest_name = @largest_name,
    largest_length_m = @largest_length_m, largest_width_m = @largest_width_m, largest_type = @largest_type,
    largest_flag = @largest_flag, ships_at = @at WHERE day = @day AND ships_at IS NULL`);
  const writeWeather = db.prepare(`UPDATE daily_log SET temp_min_c = @temp_min_c, temp_max_c = @temp_max_c,
    rain_mm = @rain_mm, wind_max_kmh = @wind_max_kmh, gust_max_kmh = @gust_max_kmh, wave_max_m = @wave_max_m,
    sunrise = @sunrise, sunset = COALESCE(sunset, @sunset), weather_source = @source, weather_at = @at
    WHERE day = @day AND weather_at IS NULL`);
  const complete = db.prepare(`UPDATE daily_log SET completed_at = ? WHERE day = ? AND completed_at IS NULL
    AND ships_at IS NOT NULL AND weather_at IS NOT NULL`);

  const days = [];
  // Rows whose counts are in but whose weather was not in the archive yet.
  const owed = db.prepare('SELECT day FROM daily_log WHERE ships_at IS NOT NULL AND weather_at IS NULL AND day <= ? ORDER BY day')
    .all(last).map((r) => r.day);
  const todo = new Set(owed);
  if (first) for (let day = first; day <= last; day = addDays(day, 1)) todo.add(day);

  // Step 1: work everything out with plain reads, outside any transaction.
  // Counting a day scans that day's positions (about 70 ms each on the
  // production data), and the live server is writing to this file the whole
  // time. Doing this inside the write transaction either fails outright (a
  // transaction that has read cannot start writing once another connection
  // has committed) or holds the write lock for many seconds.
  const plan = [];
  for (const day of [...todo].sort()) {
    const row = getRow.get(day);
    const needShips = !row?.ships_at;
    const needWeather = !row?.weather_at;
    if (!needShips && !needWeather) continue;
    // Counts can only come from days the position data covers in full.
    if (needShips && (!first || day < first)) continue;
    const ships = needShips ? shipsForDay(db, day, gear) : null;
    const w = needWeather ? getArchive.get(day) : null;
    if (!ships && !w) continue;
    plan.push({ day, ships, w });
    days.push({ day, ships, weather: !!w });
  }

  // Step 2: write it all in one short transaction that takes the write lock
  // up front (BEGIN IMMEDIATE), so it waits its turn instead of failing. The
  // updates only fill columns that are still empty, so anything the live
  // writer recorded in the meantime is left alone.
  let writeMs = 0;
  if (apply && plan.length) {
    const ensure = db.prepare('INSERT OR IGNORE INTO daily_log (day) VALUES (?)');
    const t0 = Date.now();
    db.transaction(() => {
      for (const { day, ships, w } of plan) {
        ensure.run(day);
        if (ships) writeShips.run({ ...ships, at, day });
        if (w) {
          writeWeather.run({
            temp_min_c: w.temp_min_c, temp_max_c: w.temp_max_c, rain_mm: w.rain_mm, wind_max_kmh: w.wind_max_kmh,
            gust_max_kmh: w.gust_max_kmh, wave_max_m: w.wave_max_m, sunrise: w.sunrise, sunset: w.sunset,
            source: w.source, at, day,
          });
        }
        complete.run(at, day);
      }
    }).immediate();
    writeMs = Date.now() - t0;
  }
  return { first, last, days, writeMs };
}
