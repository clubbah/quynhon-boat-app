import { describe, it, expect, vi } from 'vitest';
import { startCleanup } from '../server/cleanup.js';

describe('startCleanup', () => {
  it('calls pruneOldData and compressPositions on the given interval', () => {
    vi.useFakeTimers();
    const mockPrune = vi.fn();
    const mockCompress = vi.fn(() => 0);
    const mockDb = {};

    const stop = startCleanup(mockDb, mockPrune, mockCompress, 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(1);
    expect(mockPrune).toHaveBeenCalledWith(mockDb, 2 * 60 * 60 * 1000);
    expect(mockCompress).toHaveBeenCalledTimes(1);
    expect(mockCompress).toHaveBeenCalledWith(mockDb, 24 * 60 * 60 * 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(2);
    expect(mockCompress).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });

  it('prunes hourly summaries older than 90 days when given a pruner', () => {
    vi.useFakeTimers();
    const mockSummaries = vi.fn(() => 0);
    const stop = startCleanup({}, vi.fn(), vi.fn(() => 0), 1000, mockSummaries);
    vi.advanceTimersByTime(1000);
    expect(mockSummaries).toHaveBeenCalledWith({}, 90 * 24 * 60 * 60 * 1000);
    stop();
    vi.useRealTimers();
  });
});

describe('pruneSummaries', () => {
  it('deletes only summaries older than the window, in batches', async () => {
    const { createDb, pruneSummaries } = await import('../server/db.js');
    const db = createDb(':memory:');
    const ins = db.prepare('INSERT INTO position_summaries (mmsi, lat, lng, speed, course, timestamp) VALUES (?, 0, 0, 0, 0, ?)');
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    const junk = '2006-12-23T18:00:00';
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    for (let i = 0; i < 25; i++) ins.run('574000001', old);
    ins.run('574000001', junk);
    for (let i = 0; i < 3; i++) ins.run('574000001', recent);
    expect(pruneSummaries(db, 90 * 86400000, { batch: 10 })).toBe(26);
    expect(db.prepare('SELECT COUNT(*) c FROM position_summaries').get().c).toBe(3);
    db.close();
  });
});
