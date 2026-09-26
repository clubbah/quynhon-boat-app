import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb, upsertVessel } from '../server/db.js';
import { getHealthSnapshot } from '../server/health-monitor.js';

let db;

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

beforeEach(() => {
  db = createDb(':memory:');
  upsertVessel(db, {
    mmsi: '574123456',
    name: 'Test Ship',
    lat: 13.76,
    lng: 109.23,
    speed: 0,
    updated_at: new Date().toISOString(),
  });
  // Pretend the server has been up for an hour, past the warm-up window
  vi.spyOn(process, 'uptime').mockReturnValue(3600);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('getHealthSnapshot', () => {
  it('is healthy when POSTs arrive with vessels', () => {
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(0), lastProcessedAt: minutesAgo(0) });
    expect(s.status).toBe('healthy');
    expect(s.ais_feed.minutes_since_processed).toBe(0);
  });

  it('flags a stalled receiver when POSTs arrive but carry no vessels for 15+ min', () => {
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(0), lastProcessedAt: minutesAgo(20) });
    expect(s.status).toBe('down');
    expect(s.status_reason).toMatch(/receiver stalled/);
    expect(s.ais_feed.is_stale).toBe(true);
  });

  it('does not flag a stall under 15 min', () => {
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(0), lastProcessedAt: minutesAgo(10) });
    expect(s.status).toBe('healthy');
  });

  it('flags a stall when nothing has been processed since startup', () => {
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(0), lastProcessedAt: null });
    expect(s.status).toBe('down');
    expect(s.status_reason).toMatch(/receiver stalled/);
    expect(s.ais_feed.minutes_since_processed).toBeNull();
  });

  it('does not flag a stall right after startup', () => {
    process.uptime.mockReturnValue(120);
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(0), lastProcessedAt: null });
    expect(s.status).toBe('healthy');
  });

  it('still reports relay down when POSTs stop entirely', () => {
    const s = getHealthSnapshot(db, { lastReceivedAt: minutesAgo(40), lastProcessedAt: minutesAgo(40) });
    expect(s.status).toBe('down');
    expect(s.status_reason).toMatch(/no relay POST/);
  });
});
