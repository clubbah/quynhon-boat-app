import { describe, it, expect } from 'vitest';
import { isFishingGear, isValidCallSign } from '../server/vessel-class.js';

// Rows modelled on real transponders seen in Quy Nhon (production archive).
const row = (over) => ({ mmsi: '574100236', name: 'X', vessel_type: 0, call_sign: null, imo: null, length: 10, ...over });

describe('isValidCallSign', () => {
  it('accepts real call signs', () => {
    for (const cs of ['XVDP7', '3WBF9', '9V6016', '3E8852', '3EIQ']) expect(isValidCallSign(cs)).toBe(true);
  });
  it('rejects junk seen on net markers', () => {
    for (const cs of ['99%', '66%', 'LUOIRUT', 'BO12345', '1234', '345678', 'SSD', 'LR', '100200', '', null]) {
      expect(isValidCallSign(cs)).toBe(false);
    }
  });
});

describe('isFishingGear', () => {
  it('classes net markers with no type and no identity as gear', () => {
    expect(isFishingGear(row({ name: 'P2LXUNOIQDAT A18' }))).toBe(true);
    expect(isFishingGear(row({ name: 'NHAT LINH', length: 20 }))).toBe(true);
  });
  it('catches markers that declare themselves as fishing boats', () => {
    expect(isFishingGear(row({ name: 'PHAO 07 LANH', vessel_type: 30, call_sign: '35%' }))).toBe(true);
    expect(isFishingGear(row({ mmsi: '412927657', name: 'TIELONG69276-5', vessel_type: 30 }))).toBe(true);
    expect(isFishingGear(row({ name: 'LXNOI-THANHDAT C38', vessel_type: 30, call_sign: '1234567' }))).toBe(true);
    expect(isFishingGear(row({ mmsi: '330812975', name: 'XYY12975-33_7.6V' }))).toBe(true);
    expect(isFishingGear(row({ mmsi: '242611898', name: 'HSD-NET', vessel_type: 30 }))).toBe(true);
  });
  it('keeps real fishing boats as ships', () => {
    expect(isFishingGear(row({ name: '92 D34-TIN', vessel_type: 30, length: 26 }))).toBe(false);
    expect(isFishingGear(row({ name: '28 MIEN C31', vessel_type: 30, call_sign: '100200', length: 19 }))).toBe(false);
  });
  it('keeps cargo ships as ships', () => {
    expect(isFishingGear(row({ mmsi: '370368000', name: 'FIRST ANGEL', vessel_type: 70, call_sign: '3EIQ', length: 200 }))).toBe(false);
  });
  it('keeps a ship with no declared type when it has a call sign or IMO', () => {
    expect(isFishingGear(row({ name: 'HOA BINH 45', call_sign: '3WBF9', length: 93 }))).toBe(false);
    expect(isFishingGear(row({ name: 'SOME SHIP', imo: '9587697' }))).toBe(false);
  });
  it('leaves unnamed transponders as ships (static data not received yet)', () => {
    expect(isFishingGear(row({ name: null, vessel_type: null }))).toBe(false);
  });
});
