const VESSEL_TYPE_RANGES = [
  { min: 20, max: 29, label: 'Wing in Ground' },
  { min: 30, max: 30, label: 'Fishing' },
  { min: 31, max: 32, label: 'Towing' },
  { min: 33, max: 33, label: 'Dredging' },
  { min: 34, max: 34, label: 'Diving' },
  { min: 35, max: 35, label: 'Military' },
  { min: 36, max: 36, label: 'Sailing' },
  { min: 37, max: 37, label: 'Pleasure Craft' },
  { min: 40, max: 49, label: 'High Speed Craft' },
  { min: 50, max: 50, label: 'Pilot Vessel' },
  { min: 51, max: 51, label: 'Search and Rescue' },
  { min: 52, max: 52, label: 'Tug' },
  { min: 53, max: 53, label: 'Port Tender' },
  { min: 55, max: 55, label: 'Law Enforcement' },
  { min: 58, max: 58, label: 'Medical Transport' },
  { min: 60, max: 69, label: 'Passenger' },
  { min: 70, max: 79, label: 'Cargo' },
  { min: 80, max: 89, label: 'Tanker' },
  { min: 90, max: 99, label: 'Other' },
];

const TYPE_COLORS = {
  'Cargo': '#2563eb',
  'Tanker': '#dc2626',
  'Passenger': '#16a34a',
  'Fishing': '#ca8a04',
};
const DEFAULT_COLOR = '#6b7280';

const NAV_STATUS = {
  0: 'Under Way Using Engine',
  1: 'At Anchor',
  2: 'Not Under Command',
  3: 'Restricted Manoeuvrability',
  4: 'Constrained by Draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in Fishing',
  8: 'Under Way Sailing',
  9: 'Reserved (HSC)',
  10: 'Reserved (WIG)',
  14: 'AIS-SART',
};

// MID (first 3 MMSI digits) -> ISO 3166-1 alpha-2 code. The whole app treats
// flag_country as a 2-letter code (flagcdn image URLs, getCountryName lookup),
// and the AIS-catcher feed's `country` field is also a code, so this fallback
// must return a code too — not a display name.
const MID_COUNTRY = {
  '574': 'VN', '416': 'TW', '412': 'CN', '413': 'CN',
  '414': 'CN', '431': 'JP', '432': 'JP', '440': 'KR',
  '441': 'KR', '525': 'ID', '548': 'PH',
  '533': 'MY', '563': 'SG', '567': 'TH',
  '351': 'PA', '352': 'PA', '353': 'PA',
  '354': 'PA', '355': 'PA', '356': 'PA', '357': 'PA',
  '370': 'PA', '371': 'PA', '372': 'PA', '373': 'PA',
  '374': 'PA', '375': 'PA', '376': 'PA', '377': 'PA',
  '378': 'PA', '379': 'PA',
  '636': 'LR', '637': 'LR',
  '538': 'MH',
  '256': 'MT', '229': 'MT', '249': 'MT',
  '209': 'BS', '311': 'BS',
  '477': 'HK',
  '319': 'KY',
  '218': 'DE', '211': 'DE',
  '244': 'NL', '245': 'NL', '246': 'NL',
  '235': 'GB', '232': 'GB',
  '338': 'US', '303': 'US',
  '226': 'FR', '227': 'FR', '228': 'FR',
  '247': 'IT',
  '220': 'DK',
  '230': 'FI', '231': 'FI',
  '257': 'NO', '258': 'NO', '259': 'NO',
  '265': 'SE', '266': 'SE',
  '273': 'RU',
  '512': 'NZ',
  '503': 'AU',
  '419': 'IN',
};

export function getFlagCountry(mmsi) {
  if (!mmsi || mmsi.length < 3) return null;
  const mid = mmsi.substring(0, 3);
  return MID_COUNTRY[mid] || null;
}

export function getVesselTypeLabel(code) {
  if (code == null) return 'Other';
  const match = VESSEL_TYPE_RANGES.find(r => code >= r.min && code <= r.max);
  return match ? match.label : 'Other';
}

export function getVesselTypeColor(code) {
  const label = getVesselTypeLabel(code);
  return TYPE_COLORS[label] || DEFAULT_COLOR;
}

export function getNavStatusLabel(code) {
  if (code == null) return 'Unknown';
  return NAV_STATUS[code] || 'Unknown';
}
