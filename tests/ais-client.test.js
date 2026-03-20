import { describe, it, expect } from 'vitest';
import { parseAisMessage } from '../server/ais-client.js';

describe('parseAisMessage', () => {
  it('parses a PositionReport message', () => {
    const raw = {
      MessageType: 'PositionReport',
      Message: {
        PositionReport: {
          Cog: 180.5, NavigationalStatus: 0, RateOfTurn: 0,
          Sog: 12.3, TrueHeading: 179, Latitude: 13.76, Longitude: 109.23, UserID: 123456789,
        }
      },
      MetaData: { MMSI: 123456789, ShipName: 'TEST VESSEL', time_utc: '2026-03-20T10:00:00Z' }
    };
    const result = parseAisMessage(raw);
    expect(result).not.toBeNull();
    expect(result.mmsi).toBe('123456789');
    expect(result.lat).toBe(13.76);
    expect(result.lng).toBe(109.23);
    expect(result.speed).toBe(12.3);
    expect(result.course).toBe(180.5);
    expect(result.heading).toBe(179);
    expect(result.nav_status).toBe(0);
    expect(result.name).toBe('TEST VESSEL');
  });

  it('parses a ShipStaticData message', () => {
    const raw = {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          ImoNumber: 9876543, CallSign: 'ABCD', Type: 70,
          Dimension: { A: 100, B: 50, C: 10, D: 10 },
          MaximumStaticDraught: 8.5, Destination: 'HO CHI MINH',
          Eta: { Month: 3, Day: 25, Hour: 14, Minute: 0 }, UserID: 123456789,
        }
      },
      MetaData: { MMSI: 123456789, ShipName: 'TEST VESSEL', time_utc: '2026-03-20T10:00:00Z' }
    };
    const result = parseAisMessage(raw);
    expect(result).not.toBeNull();
    expect(result.mmsi).toBe('123456789');
    expect(result.imo).toBe('9876543');
    expect(result.call_sign).toBe('ABCD');
    expect(result.vessel_type).toBe(70);
    expect(result.vessel_type_label).toBe('Cargo');
    expect(result.length).toBe(150);
    expect(result.width).toBe(20);
    expect(result.draught).toBe(8.5);
    expect(result.destination).toBe('HO CHI MINH');
    expect(result.name).toBe('TEST VESSEL');
  });

  it('returns null for unknown message types', () => {
    const raw = {
      MessageType: 'SomethingElse', Message: {},
      MetaData: { MMSI: 123, time_utc: '2026-03-20T10:00:00Z' },
    };
    expect(parseAisMessage(raw)).toBeNull();
  });
});
