/**
 * Sunset quality model — pure scoring, no DOM, no i18n.
 *
 * Tuned for Quy Nhon's tropical coast: clear skies + humidity still produce
 * warm golden horizons, so clear conditions get a baseline rather than a
 * penalty; clouds at the right altitude boost it; heavy overcast kills it.
 *
 * Returns { score (0-100), level, factors[] } where each factor is
 * { key, status } and key maps to the i18n string `sunset_f_<key>`.
 */
export function scoreSunset({
  cloudLow = 50, cloudMid = 50, cloudHigh = 50, cloudTotal = 50,
  visibility = 20000, precipProb = 0, humidity = 70,
} = {}) {
  let score = 0;
  const factors = [];
  const isClearSky = cloudTotal < 15;

  // Low clouds (15-50% ideal — they light up orange/pink)
  if (cloudLow >= 15 && cloudLow <= 50) {
    score += 25; factors.push({ key: 'clouds', status: 'good' });
  } else if (cloudLow > 50 && cloudLow <= 70) {
    score += 12; factors.push({ key: 'clouds', status: 'neutral' });
  } else if (isClearSky) {
    score += 15; factors.push({ key: 'clouds', status: 'good' }); // clear tropical sky still glows
  } else if (cloudLow < 15) {
    score += 8; factors.push({ key: 'clouds', status: 'neutral' });
  } else {
    factors.push({ key: 'clouds', status: 'poor' });
  }

  // Mid-level clouds (10-40% ideal — catch afterglow)
  if (cloudMid >= 10 && cloudMid <= 40) score += 15;
  else if (cloudMid > 40 && cloudMid <= 60) score += 6;

  // High cirrus adds wispy drama
  if (cloudHigh >= 10 && cloudHigh <= 50) score += 8;

  // Overcast penalty
  if (cloudTotal > 85) {
    score -= 40; factors.push({ key: 'overcast', status: 'poor' });
  }

  // Visibility / atmospheric haze
  const visKm = visibility / 1000;
  if (visKm >= 5 && visKm <= 20) {
    score += 15; factors.push({ key: 'haze', status: 'good' });
  } else if (visKm > 20 && visKm <= 30) {
    score += 10; factors.push({ key: 'haze', status: 'good' });
  } else if (visKm > 30) {
    score += 6; factors.push({ key: 'haze', status: 'neutral' });
  } else {
    score += 2; factors.push({ key: 'haze', status: 'poor' });
  }

  // No rain
  if (precipProb <= 10) {
    score += 15; factors.push({ key: 'clear', status: 'good' });
  } else if (precipProb <= 30) {
    score += 8; factors.push({ key: 'clear', status: 'neutral' });
  } else {
    factors.push({ key: 'clear', status: 'poor' });
  }

  // Tropical humidity — key for Quy Nhon's golden sunsets
  if (humidity >= 60 && humidity <= 85) {
    score += 15; factors.push({ key: 'humidity', status: 'good' });
  } else if (humidity > 85) {
    score += 6; factors.push({ key: 'humidity', status: 'neutral' });
  } else {
    score += 2; factors.push({ key: 'humidity', status: 'neutral' });
  }

  score = Math.max(0, Math.min(100, score));

  let level;
  if (score >= 80) level = 'spectacular';
  else if (score >= 60) level = 'vivid';
  else if (score >= 40) level = 'nice';
  else level = 'ordinary';

  return { score, level, factors };
}

export const SUNSET_ICONS = { spectacular: '🔥', vivid: '✨', nice: '🌅', ordinary: '🌥️' };

/**
 * Tonight's (or tomorrow's) sunset rating from an Open-Meteo forecast, shared
 * by the browser (app.js) and the server render so both pick the same hour.
 *
 * Open-Meteo times are Quy Nhon wall-clock with no offset. Vietnam is UTC+7
 * all year, so '+07:00' turns them into real instants wherever this runs.
 * The hourly bucket is matched on the raw "HH" of the sunset string, with no
 * timezone math, falling back to the hour before.
 *
 * Returns null when the data is incomplete, otherwise
 * { score, level, factors, when: 'today' | 'tomorrow' | 'past', time: 'HH:MM' }.
 */
export function sunsetForecast(weather, now = new Date()) {
  const w = weather;
  if (!w || !w.hourly || !w.daily) return null;
  const sunsetISO = w.daily.sunset && w.daily.sunset[0];
  if (!sunsetISO) return null;

  const sunsetTimeStr = sunsetISO.split('T')[1] || '';
  const sunsetHH = sunsetTimeStr.slice(0, 2);
  const prevHH = String((parseInt(sunsetHH, 10) + 23) % 24).padStart(2, '0');
  const times = w.hourly.time || [];
  const hourOf = (s) => (String(s).split('T')[1] || '').slice(0, 2);
  let idx = times.findIndex((s) => hourOf(s) === sunsetHH);
  if (idx < 0) idx = times.findIndex((s) => hourOf(s) === prevHH);
  if (idx < 0) return null;

  const h = w.hourly;
  const pick = (arr, fallback) => (arr && arr[idx] != null ? arr[idx] : fallback);
  const { score, level, factors } = scoreSunset({
    cloudLow: pick(h.cloud_cover_low, 50),
    cloudMid: pick(h.cloud_cover_mid, 50),
    cloudHigh: pick(h.cloud_cover_high, 50),
    cloudTotal: pick(h.cloud_cover, 50),
    visibility: pick(h.visibility, 20000),
    precipProb: pick(h.precipitation_probability, 0),
    humidity: (w.current && w.current.relative_humidity_2m != null) ? w.current.relative_humidity_2m : 70,
  });

  const sunsetAt = new Date(sunsetISO + '+07:00'); // daily.sunset is "YYYY-MM-DDTHH:MM"
  if (now > sunsetAt) {
    const tomorrow = w.daily.sunset[1];
    if (tomorrow) return { score, level, factors, when: 'tomorrow', time: tomorrow.split('T')[1] || '' };
    return { score, level, factors, when: 'past', time: sunsetTimeStr };
  }
  return { score, level, factors, when: 'today', time: sunsetTimeStr };
}
