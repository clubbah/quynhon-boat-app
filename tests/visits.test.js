import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../server/db.js';
import { createVisitTracker } from '../server/visits.js';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
let db, clock, tracker;

// Write an archive row with a chosen last_seen (upsertArchive always uses the real clock).
function archive(v, lastSeenMs) {
  const ts = new Date(lastSeenMs).toISOString();
  db.prepare(`INSERT OR REPLACE INTO vessel_archive
    (mmsi, imo, name, call_sign, vessel_type, vessel_type_label, flag_country, length, width, first_seen, last_seen, visit_count)
    VALUES (@mmsi, @imo, @name, @call_sign, @vessel_type, @vessel_type_label, NULL, NULL, NULL, @ts, @ts, 1)`)
    .run({ imo: null, call_sign: null, vessel_type_label: null, ...v, ts });
}

const ship = (over = {}) => ({ mmsi: '574012489', name: 'TRAN GIA 09', vessel_type: 70, vessel_type_label: 'Cargo', call_sign: 'XVAU', ...over });
const gear = { mmsi: '574100236', name: 'P2LXUNOIQDAT A18', vessel_type: 0 };

beforeEach(() => {
  db = createDb(':memory:');
  clock = Date.parse('2026-11-20T00:00:00Z');
  tracker = createVisitTracker(db, { now: () => clock });
});
afterEach(() => db.close());

describe('visit tracker', () => {
  it('logs an arrival the first time a ship is heard', () => {
    expect(tracker.observe(ship())).toBe(true);
    expect(tracker.observe(ship())).toBe(false);
  });

  it('never logs fishing gear or unnamed transponders', () => {
    expect(tracker.observe(gear)).toBe(false);
    expect(tracker.observe(ship({ name: null }))).toBe(false);
  });

  it('reads last_seen before the archive upsert (an archive write must not hide a real arrival)', () => {
    // Last seen 8 hours ago. In index.js the arriving message then refreshes
    // the archive; the tracker is consulted first, so it sees the old time.
    archive(ship(), clock - 8 * H);
    expect(tracker.observe(ship())).toBe(true);
  });

  it('does not log an arrival for a ship heard again within the gap after a restart', () => {
    archive(ship(), clock - 2 * H);
    expect(tracker.observe(ship())).toBe(false);
  });

  it('logs a departure after 6 hours of silence, stamped with the last-heard time', () => {
    tracker.observe(ship());
    const heardAt = clock;
    clock += 2 * H;
    expect(tracker.checkDepartures(true)).toEqual([]); // starts the settle timer
    clock += 3 * H;
    expect(tracker.checkDepartures(true)).toEqual([]); // 5h of silence
    clock += 1 * H + M;
    const dep = tracker.checkDepartures(true);
    expect(dep).toHaveLength(1);
    expect(dep[0].name).toBe('TRAN GIA 09');
    expect(dep[0].departedAt).toBe(new Date(heardAt).toISOString());
  });

  it('a short silence produces neither a departure nor a second arrival', () => {
    tracker.observe(ship());
    clock += 3 * H;
    tracker.checkDepartures(true);
    expect(tracker.observe(ship())).toBe(false);
    clock += 4 * H;
    expect(tracker.checkDepartures(true)).toEqual([]);
  });

  it('holds departures while the feed is down and for 30 minutes after it returns', () => {
    tracker.observe(ship());
    tracker.observe(ship({ mmsi: '574012488', name: 'TANHAILOC 136' }));
    clock += 26 * H; // receiver outage
    expect(tracker.checkDepartures(false)).toEqual([]);
    expect(tracker.checkDepartures(true)).toEqual([]); // feed just came back
    // One ship is still here and reports within the settle window...
    clock += 10 * M;
    tracker.observe(ship());
    clock += 25 * M;
    // ...so only the one that really left is logged.
    const dep = tracker.checkDepartures(true);
    expect(dep.map((d) => d.name)).toEqual(['TANHAILOC 136']);
  });

  it('seed() restores ships heard within the gap, but not gear or long-gone ships', () => {
    archive(ship(), clock - 1 * H);
    archive(gear, clock - 1 * H);
    archive(ship({ mmsi: '574012488', name: 'TANHAILOC 136' }), clock - 9 * H);
    expect(tracker.seed()).toBe(1);
    expect(tracker.observe(ship())).toBe(false);
    expect(tracker.observe(ship({ mmsi: '574012488', name: 'TANHAILOC 136' }))).toBe(true);
  });
});
