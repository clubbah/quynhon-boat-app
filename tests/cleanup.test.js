import { describe, it, expect, vi } from 'vitest';
import { startCleanup } from '../server/cleanup.js';

describe('startCleanup', () => {
  it('calls pruneOldData on the given interval', () => {
    vi.useFakeTimers();
    const mockPrune = vi.fn();
    const mockDb = {};

    const stop = startCleanup(mockDb, mockPrune, 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(1);
    expect(mockPrune).toHaveBeenCalledWith(mockDb, 6 * 60 * 60 * 1000);

    vi.advanceTimersByTime(1000);
    expect(mockPrune).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });
});
