/**
 * Open-Meteo weather + marine cache.
 *
 * /api/weather may wait for a fetch (the browser can cope). Page renders must
 * not, so they call peekWeather(), which returns whatever is cached right now.
 * startWeatherRefresh() fills the cache at boot and keeps it warm, so renders
 * have data without any visitor having to call /api/weather first.
 */

const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=13.76&longitude=109.23&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,apparent_temperature,precipitation&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,precipitation_probability&daily=sunrise,sunset&timezone=Asia/Ho_Chi_Minh&forecast_days=2&models=gfs_seamless';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine?latitude=13.76&longitude=109.23&current=wave_height,wave_direction,wave_period,swell_wave_height&timezone=Asia/Ho_Chi_Minh';

export const WEATHER_TTL = 15 * 60 * 1000;

let weatherCache = { data: null, fetchedAt: 0 };
let inFlight = null;

// Cached data, refreshed when older than the TTL. Returns stale data (or null)
// if the fetch fails.
export async function fetchWeather() {
  const now = Date.now();
  if (weatherCache.data && (now - weatherCache.fetchedAt) < WEATHER_TTL) {
    return weatherCache.data;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const [weatherRes, marineRes] = await Promise.all([fetch(WEATHER_URL), fetch(MARINE_URL)]);
      const weather = await weatherRes.json();
      const marine = await marineRes.json();
      if (weather && weather.current) {
        weatherCache = { data: { weather, marine }, fetchedAt: Date.now() };
      }
      return weatherCache.data;
    } catch (err) {
      console.error('[Weather] Fetch error:', err.message);
      return weatherCache.data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Synchronous: never fetches. May be null just after a restart.
export function peekWeather() {
  return weatherCache.data;
}

export function startWeatherRefresh() {
  fetchWeather();
  // Check every 5 min; fetchWeather only goes upstream once the TTL is up.
  setInterval(fetchWeather, 5 * 60 * 1000).unref?.();
}
