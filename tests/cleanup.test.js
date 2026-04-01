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
    expect(mockPrune).toHaveBeenCalledWith(mockDb, 6 * 60 * 60 * 1000);
    expect(mockCompress).toHaveBeenCalledTimes(1);
    expect(mockCompress).toHaveBeenCalledWith(mockDb, 24 * 60 * 60 * 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(2);
    expect(mockCompress).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
