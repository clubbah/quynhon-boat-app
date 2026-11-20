/**
 * Arrival and departure tracking for Port Pulse.
 *
 * The old logic logged a departure after one hour of silence and an arrival
 * whenever the vessel was heard again. Small boats and net markers drift in
 * and out of radio range all day, so the site logged 100 to 140 "arrivals" a
 * day with about 55 transponders in view.
 *
 * One model now drives both events. A visit is a stretch of being heard with
 * no silence of GAP or longer:
 *   - arrival: a named ship heard after GAP or more of silence (or never seen)
 *   - departure: a ship silent for GAP, stamped with the time it was last heard
 * Fishing gear (see vessel-class.js) never produces visit events.
 *
 * Measured against the production log (Nov 2026) with a 6-hour gap, about 93%
 * of the remaining arrivals entered the port or inner bay within 6 hours, so
 * these are real arrivals, not ships passing along the coast.
 *
 * Receiver outages: while the feed is stale every vessel looks silent, so
 * departures are held until the feed has been healthy for SETTLE, giving
 * vessels that are still here time to be heard again.
 */

import { isFishingGear } from './vessel-class.js';

export const VISIT_GAP_MS = 6 * 60 * 60 * 1000;
export const FEED_SETTLE_MS = 30 * 60 * 1000;

function snapshot(v) {
  return {
    mmsi: v.mmsi,
    name: v.name,
    vessel_type_label: v.vessel_type_label || null,
    flag_country: v.flag_country || null,
    length: v.length || null,
    width: v.width || null,
    destination: v.destination || null,
  };
}

export function createVisitTracker(db, {
  gapMs = VISIT_GAP_MS,
  settleMs = FEED_SETTLE_MS,
  now = () => Date.now(),
} = {}) {
  const present = new Map(); // mmsi -> { lastHeard: ms, info }
  let healthySince = null;
  const lastSeenStmt = db.prepare('SELECT last_seen FROM vessel_archive WHERE mmsi = ?');

  /** Rebuild state after a restart: everything heard within the gap is present. */
  function seed() {
    const cutoff = new Date(now() - gapMs).toISOString();
    for (const r of db.prepare('SELECT * FROM vessel_archive WHERE last_seen >= ?').all(cutoff)) {
      if (r.name && !isFishingGear(r)) present.set(r.mmsi, { lastHeard: Date.parse(r.last_seen), info: snapshot(r) });
    }
    // The live table has a fresher timestamp for anything heard in the last 2 hours.
    for (const v of db.prepare('SELECT * FROM vessels').all()) {
      if (!v.name || isFishingGear(v)) continue;
      const t = Date.parse(v.updated_at);
      present.set(v.mmsi, { lastHeard: Number.isFinite(t) ? Math.min(t, now()) : now(), info: snapshot(v) });
    }
    return present.size;
  }

  /**
   * Record that a vessel was heard. Returns true when this is an arrival.
   * Must be called BEFORE the vessel_archive upsert, which overwrites
   * last_seen with the current time.
   */
  function observe(vessel) {
    if (!vessel || !vessel.mmsi || !vessel.name || isFishingGear(vessel)) return false;
    const t = now();
    const entry = present.get(vessel.mmsi);
    if (entry) {
      entry.lastHeard = t;
      entry.info = snapshot(vessel);
      return false;
    }
    const prev = lastSeenStmt.get(vessel.mmsi)?.last_seen;
    const prevMs = prev ? Date.parse(prev) : NaN;
    present.set(vessel.mmsi, { lastHeard: t, info: snapshot(vessel) });
    return !Number.isFinite(prevMs) || (t - prevMs) >= gapMs;
  }

  /**
   * Returns vessels that have now departed, each with `departedAt` set to
   * when it was last heard. Call periodically with whether the feed is
   * currently delivering data.
   */
  function checkDepartures(feedHealthy) {
    const t = now();
    if (!feedHealthy) { healthySince = null; return []; }
    if (healthySince == null) healthySince = t;
    if (t - healthySince < settleMs) return [];
    const departed = [];
    for (const [mmsi, e] of present) {
      if (t - e.lastHeard >= gapMs) {
        present.delete(mmsi);
        departed.push({ ...e.info, departedAt: new Date(e.lastHeard).toISOString() });
      }
    }
    return departed;
  }

  return { seed, observe, checkDepartures, size: () => present.size };
}
