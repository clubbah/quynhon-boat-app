import { describe, it, expect } from 'vitest';
import { getVesselTypeLabel, getVesselTypeColor, getNavStatusLabel, getFlagCountry } from '../server/ais-types.js';

describe('getVesselTypeLabel', () => {
  it('maps cargo type codes to "Cargo"', () => {
    expect(getVesselTypeLabel(70)).toBe('Cargo');
    expect(getVesselTypeLabel(79)).toBe('Cargo');
  });
  it('maps tanker type codes to "Tanker"', () => {
    expect(getVesselTypeLabel(80)).toBe('Tanker');
    expect(getVesselTypeLabel(89)).toBe('Tanker');
  });
  it('maps passenger type codes to "Passenger"', () => {
    expect(getVesselTypeLabel(60)).toBe('Passenger');
    expect(getVesselTypeLabel(69)).toBe('Passenger');
  });
  it('maps fishing type code to "Fishing"', () => {
    expect(getVesselTypeLabel(30)).toBe('Fishing');
  });
  it('returns "Other" for unknown codes', () => {
    expect(getVesselTypeLabel(0)).toBe('Other');
    expect(getVesselTypeLabel(999)).toBe('Other');
    expect(getVesselTypeLabel(undefined)).toBe('Other');
  });
});

describe('getVesselTypeColor', () => {
  it('returns blue for cargo', () => { expect(getVesselTypeColor(70)).toBe('#2563eb'); });
  it('returns red for tanker', () => { expect(getVesselTypeColor(80)).toBe('#dc2626'); });
  it('returns green for passenger', () => { expect(getVesselTypeColor(60)).toBe('#16a34a'); });
  it('returns yellow for fishing', () => { expect(getVesselTypeColor(30)).toBe('#ca8a04'); });
  it('returns gray for unknown', () => { expect(getVesselTypeColor(0)).toBe('#6b7280'); });
});

describe('getNavStatusLabel', () => {
  it('maps status 0 to "Under Way Using Engine"', () => { expect(getNavStatusLabel(0)).toBe('Under Way Using Engine'); });
  it('maps status 1 to "At Anchor"', () => { expect(getNavStatusLabel(1)).toBe('At Anchor'); });
  it('maps status 5 to "Moored"', () => { expect(getNavStatusLabel(5)).toBe('Moored'); });
  it('returns "Unknown" for undefined status', () => {
    expect(getNavStatusLabel(99)).toBe('Unknown');
    expect(getNavStatusLabel(undefined)).toBe('Unknown');
  });
});

describe('getFlagCountry', () => {
  it('maps Vietnamese MMSI to Vietnam', () => { expect(getFlagCountry('574001234')).toBe('Vietnam'); });
  it('maps Panamanian MMSI to Panama', () => { expect(getFlagCountry('351234567')).toBe('Panama'); });
  it('returns null for unknown MID', () => { expect(getFlagCountry('999000000')).toBeNull(); });
  it('returns null for null/short MMSI', () => {
    expect(getFlagCountry(null)).toBeNull();
    expect(getFlagCountry('12')).toBeNull();
  });
});
