import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, upsertVessel, appendPosition, getVesselsByArea, getTrack, pruneOldData } from '../server/db.js';

let db;

beforeEach(() => {
  db = createDb(':memory:');
});

afterEach(() => {
  db.close();
});

describe('upsertVessel', () => {
  it('inserts a new vessel', () => {
    upsertVessel(db, {
      mmsi: '123456789',
      name: 'Test Ship',
      vessel_type: 70,
      vessel_type_label: 'Cargo',
      lat: 13.76,
      lng: 109.23,
      speed: 5.2,
      course: 180,
      heading: 179,
      nav_status: 0,
      nav_status_label: 'Under Way Using Engine',
      updated_at: new Date().toISOString(),
    });

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].mmsi).toBe('123456789');
    expect(vessels[0].name).toBe('Test Ship');
  });

  it('updates existing vessel on re-insert', () => {
    const base = {
      mmsi: '123456789',
      name: 'Test Ship',
      vessel_type: 70,
      vessel_type_label: 'Cargo',
      lat: 13.76,
      lng: 109.23,
      speed: 5.2,
      course: 180,
      heading: 179,
      nav_status: 0,
      nav_status_label: 'Under Way Using Engine',
      updated_at: new Date().toISOString(),
    };

    upsertVessel(db, base);
    upsertVessel(db, { ...base, speed: 10.0, name: 'Updated Ship' });

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(1);
    expect(vessels[0].speed).toBe(10.0);
    expect(vessels[0].name).toBe('Updated Ship');
  });
});

describe('appendPosition + getTrack', () => {
  it('stores and retrieves position history', () => {
    appendPosition(db, { mmsi: '123', lat: 13.76, lng: 109.23, speed: 5, course: 180, timestamp: '2026-03-20T10:00:00Z' });
    appendPosition(db, { mmsi: '123', lat: 13.77, lng: 109.24, speed: 6, course: 185, timestamp: '2026-03-20T10:05:00Z' });

    const track = getTrack(db, '123');
    expect(track).toHaveLength(2);
    expect(track[0].lat).toBe(13.76);
    expect(track[1].lat).toBe(13.77);
  });
});

describe('pruneOldData', () => {
  it('does not delete position history (handled by compressPositions now)', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();

    appendPosition(db, { mmsi: '123', lat: 13.76, lng: 109.23, speed: 5, course: 180, timestamp: old });
    appendPosition(db, { mmsi: '123', lat: 13.77, lng: 109.24, speed: 6, course: 185, timestamp: recent });

    pruneOldData(db, 6 * 60 * 60 * 1000);

    const track = getTrack(db, '123');
    expect(track).toHaveLength(2); // positions are preserved, not deleted
  });

  it('removes vessels not updated within maxAgeMs', () => {
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    upsertVessel(db, {
      mmsi: '123', name: 'Old Ship', vessel_type: 70, vessel_type_label: 'Cargo',
      lat: 13.76, lng: 109.23, speed: 0, course: 0, heading: 0,
      nav_status: 5, nav_status_label: 'Moored', updated_at: old,
    });

    pruneOldData(db, 6 * 60 * 60 * 1000);

    const vessels = getVesselsByArea(db);
    expect(vessels).toHaveLength(0);
  });
});
