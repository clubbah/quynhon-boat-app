import { describe, it, expect } from 'vitest';
import { parseAisCatcherMessage, isWithinBounds, QN_BOUNDS } from '../server/ais-parser.js';

// A minimal valid in-region vessel position message
function validMsg(over = {}) {
  return {
    mmsi: '574123456', // Vietnam (574), 9 digits, not a nav-aid prefix
    shipname: 'TEST TRADER',
    lat: 13.77,
    lng: 109.22,
    speed: 8.2,
    course: 145,
    shiptype: 70, // cargo
    ...over,
  };
}

describe('isWithinBounds', () => {
  it('accepts a point in Quy Nhon bay', () => {
    expect(isWithinBounds(13.76, 109.23)).toBe(true);
  });
  it('rejects Singapore (far out of region)', () => {
    expect(isWithinBounds(1.29, 103.85)).toBe(false);
  });
  it('rejects null island (0,0)', () => {
    expect(isWithinBounds(0, 0)).toBe(false);
  });
  it('rejects null / NaN / non-finite', () => {
    expect(isWithinBounds(null, 109)).toBe(false);
    expect(isWithinBounds(13.7, undefined)).toBe(false);
    expect(isWithinBounds(NaN, 109)).toBe(false);
    expect(isWithinBounds(13.7, Infinity)).toBe(false);
  });
  it('respects the published box edges', () => {
    expect(isWithinBounds(QN_BOUNDS.minLat, QN_BOUNDS.minLng)).toBe(true);
    expect(isWithinBounds(QN_BOUNDS.maxLat + 0.01, 109)).toBe(false);
  });
});

describe('parseAisCatcherMessage — valid data', () => {
  it('parses an in-region vessel', () => {
    const p = parseAisCatcherMessage(validMsg());
    expect(p).not.toBeNull();
    expect(p.mmsi).toBe('574123456');
    expect(p.name).toBe('TEST TRADER');
    expect(p.lat).toBe(13.77);
    expect(p.vessel_type_label).toBeTruthy();
  });

  it('normalizes field-name variants (latitude/longitude/sog/cog)', () => {
    const p = parseAisCatcherMessage({
      mmsi: '574123456', shipname: 'ALT FIELDS',
      latitude: 13.8, longitude: 109.1, sog: 5, cog: 90,
    });
    expect(p.lat).toBe(13.8);
    expect(p.lng).toBe(109.1);
    expect(p.speed).toBe(5);
    expect(p.course).toBe(90);
  });

  it('accepts a static-only message with no position', () => {
    const p = parseAisCatcherMessage({ mmsi: '574123456', shipname: 'STATIC ONLY', shiptype: 80 });
    expect(p).not.toBeNull();
    expect(p.lat).toBeNull();
    expect(p.lng).toBeNull();
  });
});

describe('parseAisCatcherMessage — anti-spoofing / junk rejection', () => {
  it('rejects a position outside the region (spoofed)', () => {
    expect(parseAisCatcherMessage(validMsg({ lat: 1.29, lng: 103.85 }))).toBeNull();
  });
  it('rejects null island', () => {
    expect(parseAisCatcherMessage(validMsg({ lat: 0, lng: 0 }))).toBeNull();
  });
  it('rejects AtoN / base-station / SART MMSI prefixes', () => {
    for (const mmsi of ['993123456', '003123456', '972123456', '912123456']) {
      expect(parseAisCatcherMessage(validMsg({ mmsi }))).toBeNull();
    }
  });
  it('rejects non-9-digit MMSI', () => {
    expect(parseAisCatcherMessage(validMsg({ mmsi: '12345' }))).toBeNull();
  });
  it('rejects known fake MMSIs', () => {
    expect(parseAisCatcherMessage(validMsg({ mmsi: '123456789' }))).toBeNull();
  });
  it('rejects nav-aid ship types', () => {
    expect(parseAisCatcherMessage(validMsg({ shiptype: 9 }))).toBeNull();
  });
  it('rejects garbled, single-char, and letterless names', () => {
    expect(parseAisCatcherMessage(validMsg({ shipname: 'D1O<17.13L' }))).toBeNull();
    expect(parseAisCatcherMessage(validMsg({ shipname: 'A' }))).toBeNull();
    expect(parseAisCatcherMessage(validMsg({ shipname: '64168--30-48%' }))).toBeNull();
  });
  it('rejects garbled and test call signs', () => {
    expect(parseAisCatcherMessage(validMsg({ callsign: '12[34]' }))).toBeNull();
    expect(parseAisCatcherMessage(validMsg({ callsign: '1234567' }))).toBeNull();
  });
  it('rejects missing MMSI', () => {
    expect(parseAisCatcherMessage({ shipname: 'NO MMSI' })).toBeNull();
  });
});
