import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, upsertVessel, getArchiveStats, getPortTrends } from '../server/db.js';
import { computePortStats } from '../server/port-data.js';
import { canBeLargest } from '../server/vessel-class.js';

let db;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => db.close());

const now = () => new Date().toISOString();

// Rows as they sit in production (Nov 2026): two real ships and three small
// boats whose transponders report impossible sizes. None of the boats has an
// IMO number.
const REAL = [
  { mmsi: '636000001', name: 'YM WONDERLAND', imo: '9708435', call_sign: 'D5AB2', vessel_type: 70, vessel_type_label: 'Cargo', flag_country: 'LR', length: 366, width: 51 },
  { mmsi: '538000002', name: 'FIRST ANGEL', imo: '9357901', call_sign: 'V7AB3', vessel_type: 70, vessel_type_label: 'Cargo', flag_country: 'PA', length: 200, width: 32 },
];
const JUNK = [
  { mmsi: '574000011', name: 'THONGTIN', imo: null, call_sign: '3WAB1', vessel_type: 30, vessel_type_label: 'Fishing', flag_country: 'VN', length: 343, width: 57 },
  { mmsi: '574000012', name: '66B1 GIA CAO GE LUI', imo: '0000000', call_sign: '3WAB2', vessel_type: 50, vessel_type_label: 'Pilot Vessel', flag_country: 'VN', length: 330, width: 16 },
  { mmsi: '574000013', name: 'QUYNH NHU', imo: '', call_sign: '3WAB3', vessel_type: 20, vessel_type_label: 'Wing in Ground', flag_country: 'VN', length: 282, width: 10 },
];

function archive(v) {
  db.prepare(`INSERT INTO vessel_archive (mmsi, imo, name, call_sign, vessel_type, vessel_type_label, flag_country, length, width, first_seen, last_seen, visit_count)
    VALUES (@mmsi, @imo, @name, @call_sign, @vessel_type, @vessel_type_label, @flag_country, @length, @width, @t, @t, 1)`).run({ ...v, t: now() });
}
const live = (v) => upsertVessel(db, { ...v, lat: 13.76, lng: 109.23, speed: 0, updated_at: now() });

describe('canBeLargest', () => {
  it('believes a size only from a named ship with an IMO number', () => {
    for (const v of REAL) expect(canBeLargest(v)).toBe(true);
    for (const v of JUNK) expect(canBeLargest(v)).toBe(false);
    expect(canBeLargest({ ...REAL[0], name: null })).toBe(false);
    expect(canBeLargest({ ...REAL[0], length: 511 })).toBe(false);
    expect(canBeLargest({ ...REAL[0], length: null })).toBe(false);
    expect(canBeLargest(null)).toBe(false);
  });
});

describe('largest vessel on the home page (computePortStats)', () => {
  it('is the largest ship with an IMO number, not a boat with a mis-set transponder', () => {
    [...JUNK, REAL[1]].forEach(live);
    const stats = computePortStats(db);
    expect(stats.vesselOfDay.name).toBe('FIRST ANGEL');
    expect(stats.total).toBe(4);              // the boats are still counted as vessels in view
  });

  it('is empty when no ship in view has an IMO number', () => {
    JUNK.forEach(live);
    const stats = computePortStats(db);
    expect(stats.vesselOfDay).toBeNull();
    expect(stats.total).toBe(3);
  });
});

describe('largest vessels on Port in Numbers (getPortTrends, getArchiveStats)', () => {
  beforeEach(() => { [...JUNK, ...REAL].forEach(archive); });

  it('lists only ships with an IMO number, largest first', () => {
    const { largest, totalUnique } = getPortTrends(db);
    expect(largest.map((r) => r.name)).toEqual(['YM WONDERLAND', 'FIRST ANGEL']);
    expect(largest[0]).toMatchObject({ length: 366, width: 51, flag_country: 'LR', vessel_type_label: 'Cargo' });
    expect(totalUnique).toBe(5);              // the boats stay in every other figure
  });

  it('picks the same kind of ship as the largest ever', () => {
    expect(getArchiveStats(db).largestEver.name).toBe('YM WONDERLAND');
  });
});
