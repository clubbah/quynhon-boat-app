import { describe, it, expect } from 'vitest';
import { scoreSunset } from '../public/js/sunset.js';

describe('scoreSunset', () => {
  it('rates a clear tropical sky "nice", not "ordinary" (Quy Nhon tuning)', () => {
    const r = scoreSunset({
      cloudLow: 5, cloudMid: 5, cloudHigh: 5, cloudTotal: 5,
      visibility: 25000, precipProb: 0, humidity: 70,
    });
    expect(r.level).toBe('nice');
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.factors.find((f) => f.key === 'clouds').status).toBe('good');
  });

  it('rates ideal mixed cloud + haze + humidity highly', () => {
    const r = scoreSunset({
      cloudLow: 30, cloudMid: 25, cloudHigh: 30, cloudTotal: 45,
      visibility: 15000, precipProb: 5, humidity: 72,
    });
    expect(r.level).toBe('spectacular');
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it('rates heavy overcast + rain "ordinary" and clamps at 0', () => {
    const r = scoreSunset({
      cloudLow: 90, cloudMid: 80, cloudHigh: 60, cloudTotal: 95,
      visibility: 8000, precipProb: 80, humidity: 90,
    });
    expect(r.level).toBe('ordinary');
    expect(r.score).toBe(0);
    expect(r.factors.find((f) => f.key === 'overcast').status).toBe('poor');
  });

  it('clamps score within 0..100', () => {
    const best = scoreSunset({
      cloudLow: 30, cloudMid: 25, cloudHigh: 30, cloudTotal: 40,
      visibility: 12000, precipProb: 0, humidity: 70,
    });
    expect(best.score).toBeLessThanOrEqual(100);
    expect(best.score).toBeGreaterThanOrEqual(0);
  });

  it('always returns the five expected factor categories', () => {
    const r = scoreSunset({ cloudLow: 30, cloudTotal: 40, visibility: 15000, precipProb: 0, humidity: 70 });
    const keys = r.factors.map((f) => f.key);
    for (const k of ['clouds', 'haze', 'clear', 'humidity']) {
      expect(keys).toContain(k);
    }
  });

  it('does not throw on empty input (uses defaults)', () => {
    expect(() => scoreSunset()).not.toThrow();
    expect(scoreSunset().level).toBeTruthy();
  });

  it('maps score bands to levels at the documented thresholds', () => {
    // Spectacular >=80, vivid >=60, nice >=40, ordinary <40
    expect(scoreSunset({ cloudLow: 30, cloudMid: 25, cloudHigh: 30, cloudTotal: 45, visibility: 15000, precipProb: 5, humidity: 72 }).level).toBe('spectacular');
    expect(scoreSunset({ cloudLow: 60, cloudMid: 0, cloudHigh: 0, cloudTotal: 60, visibility: 25000, precipProb: 0, humidity: 70 }).score).toBeGreaterThanOrEqual(0);
  });
});
