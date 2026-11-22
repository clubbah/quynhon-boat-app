/**
 * Vessel class: ship or fishing gear.
 *
 * A large share of the AIS transponders the antenna hears are not ships. They
 * are markers on fishing nets and buoys ("LXNOI" is a floating gill net, "PHAO"
 * is a buoy), plus some small craft with unconfigured transponders. They were
 * inflating the vessel count and filling Port Pulse with arrivals.
 *
 * Measured on the production archive (2026-11-20): name patterns alone caught
 * about a quarter of them, so the rule is structural. A transponder counts as
 * fishing gear when it has a name, has no ship identity (no valid call sign,
 * no IMO number), and either declares no ship type, carries a marker-style
 * name, or uses an MMSI that is not a ship identity.
 *
 * Unnamed transponders are left as ships: those are usually real ships whose
 * name and type message has not arrived yet.
 *
 * This is derived from the row every time, never stored, so the rule can
 * change without a database migration.
 */

// Call signs that turn up on net markers and test transponders.
const JUNK_CALL_SIGNS = new Set(['BO12345', '1234567', '0000000', 'ABCDEFG']);

// Real call signs are either 4 letters (HPLG, XVXZ) or 4-7 letters and digits
// mixed (3WBF9, 9V6016). All-letter values longer than 4 are words that small
// transponders put in the field (LUOIRUT, VIETNAM, FISHING, TAUCA).
export function isValidCallSign(cs) {
  const s = String(cs ?? '').trim().toUpperCase();
  if (JUNK_CALL_SIGNS.has(s)) return false;
  if (/^[A-Z]{4}$/.test(s)) return true;
  return /^[A-Z0-9]{4,7}$/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

export function hasValidImo(imo) {
  const s = String(imo ?? '').trim();
  return /^\d{7}$/.test(s) && s !== '0000000';
}

// Names that only appear on gear:
//  - PHAO ...                        Vietnamese "buoy"
//  - LXNOI / LX NOI                  "luoi xu noi", a floating gill net
//  - ...7.6V / ..._7.5V              battery voltage suffix on Chinese net buoys
//  - NET as a word (HSD-NET)
//  - TIELONG69276-5, MINXIAYU08899-16  Chinese net-buoy serial format
const MARKER_NAME = /^PHAO\b|LX\s?NOI|\d(\.\d)?V$|(^|[\s_.-])NET($|[\s_.-])|^[A-Z]{4,}\d{4,}-\d{1,3}$/i;

export function isFishingGear(v) {
  if (!v || !v.name) return false;
  if (isValidCallSign(v.call_sign) || hasValidImo(v.imo)) return false;
  const noType = v.vessel_type == null || v.vessel_type === 0;
  const nonShipMmsi = !/^[2-7]\d{8}$/.test(String(v.mmsi ?? ''));
  return noType || nonShipMmsi || MARKER_NAME.test(String(v.name).trim());
}

/** Adds is_gear to a vessel row for API and WebSocket payloads. */
export function withClass(v) {
  if (!v) return v;
  return { ...v, is_gear: isFishingGear(v) };
}
