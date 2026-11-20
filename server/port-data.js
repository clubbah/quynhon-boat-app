/**
 * Port numbers shared by the JSON APIs and the server-rendered pages, so a
 * page and the /api/ endpoint the browser later polls always agree.
 * All synchronous SQLite reads, cheap enough to run per render.
 */
import { getRecentVisits } from './db.js';
import { isFishingGear } from './vessel-class.js';

// Current ships, arrivals-free summary for the home page header and tables.
// Fishing gear (net markers and buoys) stays on the map but is left out of
// every count and list here.
export function computePortStats(db, now = new Date()) {
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];

  const allVessels = db.prepare('SELECT * FROM vessels').all().filter((v) => !isFishingGear(v));

  // Ships seen in last 24h
  const recentVessels = allVessels.filter((v) => v.updated_at > yesterday + 'T00:00:00');

  // Speed-based movement detection (more reliable than AIS nav_status)
  const moving = allVessels.filter((v) => v.speed != null && v.speed > 0.5);
  const anchored = allVessels.filter((v) => v.speed == null || v.speed <= 0.5);

  // Vessel of the day: largest vessel currently visible
  const vesselOfDay = allVessels
    .filter((v) => v.name && v.length)
    .sort((a, b) => (b.length || 0) - (a.length || 0))[0] || null;

  // Recent activity: last 10 updates
  const recentActivity = [...allVessels]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, 10)
    .map(({ mmsi, name, vessel_type_label, flag_country, speed, nav_status_label, destination, updated_at }) =>
      ({ mmsi, name, vessel_type_label, flag_country, speed, nav_status_label, destination, updated_at }));

  return {
    total: allVessels.length,
    moving: moving.length,
    anchored: anchored.length,
    recentCount: recentVessels.length,
    vesselOfDay,
    recentActivity,
  };
}

// Port Pulse: recent arrivals and departures. Older history contains gear
// events, so over-fetch and filter.
export function getPortPulse(db, gear, limit = 20) {
  return getRecentVisits(db, limit * 6).filter((v) => !gear.has(v.mmsi)).slice(0, limit);
}
