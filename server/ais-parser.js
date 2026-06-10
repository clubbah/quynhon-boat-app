/**
 * AIS-catcher message parser + validation.
 *
 * Extracted from index.js so it can be unit-tested in isolation (index.js
 * boots the server on import, which makes it untestable directly).
 *
 * Two jobs:
 *   1. Normalize the many AIS-catcher field-name variants into one shape.
 *   2. Reject junk: non-vessel MMSI ranges, garbled names/call signs, and
 *      positions that fall outside the Quy Nhon region (anti-spoofing).
 */

import { getVesselTypeLabel, getNavStatusLabel, getFlagCountry } from './ais-types.js';

// Quy Nhon is at ~13.76N, 109.23E. The antenna reaches ~50-70km, but AIS can
// occasionally be heard farther, so this box is generous (~200km). Its job is
// to reject globally-spoofed or garbage coordinates, not to tightly geofence.
export const QN_BOUNDS = { minLat: 11.5, maxLat: 16.0, minLng: 107.0, maxLng: 111.5 };

export function isWithinBounds(lat, lng) {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false; // "null island" — bad fix
  return (
    lat >= QN_BOUNDS.minLat && lat <= QN_BOUNDS.maxLat &&
    lng >= QN_BOUNDS.minLng && lng <= QN_BOUNDS.maxLng
  );
}

// AIS ship types reserved for navigation aids / non-vessels
const NAV_AID_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const GARBLED = /[<>\\[\]{}|^]/;

// Non-vessel / junk MMSI check, shared by both the RTL-SDR and aisstream feeds:
// 99x=AtoN, 98x=craft assoc w/ parent, 97x=SART/MOB/EPIRB, 96x=Diver,
// 94x=local, 93x=AIS-SART, 91x/85x=unassigned, 00x=base stations.
export function isNonVesselMmsi(mmsi) {
  mmsi = String(mmsi);
  if (mmsi.length !== 9) return true;
  if (/^(99|98|97|96|94|93|91|85|00)/.test(mmsi)) return true;
  if (mmsi === '123456789' || mmsi === '000000000' || mmsi === '111111111') return true;
  return false;
}

export function parseAisCatcherMessage(msg) {
  const mmsi = String(msg.mmsi || msg.MMSI);
  if (!mmsi || mmsi === 'undefined') return null;
  if (isNonVesselMmsi(mmsi)) return null;
  // AIS ship types for navigation aids
  if (msg.shiptype != null && NAV_AID_TYPES.has(msg.shiptype)) return null;

  // Position (may be absent on static-only messages)
  const lat = msg.lat ?? msg.latitude ?? null;
  const lng = msg.lon ?? msg.lng ?? msg.longitude ?? null;
  // If a position is present, it MUST be within the region. This neuters
  // position-spoofing even if the feed secret leaks.
  if (lat != null && lng != null && !isWithinBounds(lat, lng)) return null;

  // Filter garbled names: special chars that real AIS names never contain
  const rawName = (msg.shipname || msg.name || '').trim();
  const name = rawName || null;
  if (rawName && GARBLED.test(rawName)) return null;
  if (rawName && rawName.length === 1) return null;            // placeholder
  if (rawName && !/[A-Za-z]/.test(rawName)) return null;       // no letters = junk transponder

  // Filter invalid call signs
  const rawCallsign = (msg.callsign ?? msg.call_sign ?? '').trim();
  if (rawCallsign && GARBLED.test(rawCallsign)) return null;
  if (rawCallsign === '1234567') return null;

  const flag_country = msg.country || getFlagCountry(mmsi);
  const updated_at = msg.timestamp || new Date().toISOString();

  // Build ETA string from separate fields if available
  let eta = msg.eta ?? null;
  if (!eta && msg.eta_month && msg.eta_day) {
    const m = String(msg.eta_month).padStart(2, '0');
    const d = String(msg.eta_day).padStart(2, '0');
    const h = String(msg.eta_hour || 0).padStart(2, '0');
    const min = String(msg.eta_minute || 0).padStart(2, '0');
    eta = `${m}-${d} ${h}:${min}`;
  }

  const draught = msg.draught != null && msg.draught >= 0 ? msg.draught : null;

  return {
    mmsi, name, flag_country, updated_at,
    lat, lng,
    speed: msg.speed ?? msg.sog ?? null,
    course: msg.course ?? msg.cog ?? null,
    heading: msg.heading ?? null,
    nav_status: msg.status ?? msg.nav_status ?? null,
    nav_status_label: msg.status != null ? getNavStatusLabel(msg.status) : null,
    imo: msg.imo ? String(msg.imo) : null,
    call_sign: (msg.callsign ?? msg.call_sign ?? '').trim() || null,
    vessel_type: msg.shiptype ?? msg.vessel_type ?? null,
    vessel_type_label: msg.shiptype != null ? getVesselTypeLabel(msg.shiptype) : null,
    length: msg.to_bow != null && msg.to_stern != null ? msg.to_bow + msg.to_stern : (msg.length ?? null),
    width: msg.to_port != null && msg.to_starboard != null ? msg.to_port + msg.to_starboard : (msg.width ?? null),
    draught,
    destination: (msg.destination ?? '').trim() || null,
    eta,
  };
}
