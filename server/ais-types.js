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

const MID_COUNTRY = {
  '574': 'Vietnam', '416': 'Taiwan', '412': 'China', '413': 'China',
  '414': 'China', '431': 'Japan', '432': 'Japan', '440': 'South Korea',
  '441': 'South Korea', '525': 'Indonesia', '548': 'Philippines',
  '533': 'Malaysia', '563': 'Singapore', '567': 'Thailand',
  '351': 'Panama', '352': 'Panama', '353': 'Panama',
  '354': 'Panama', '355': 'Panama', '356': 'Panama', '357': 'Panama',
  '370': 'Panama', '371': 'Panama', '372': 'Panama', '373': 'Panama',
  '374': 'Panama', '375': 'Panama', '376': 'Panama', '377': 'Panama',
  '378': 'Panama', '379': 'Panama',
  '636': 'Liberia', '637': 'Liberia',
  '538': 'Marshall Islands',
  '256': 'Malta', '229': 'Malta', '249': 'Malta',
  '209': 'Bahamas', '311': 'Bahamas',
  '477': 'Hong Kong',
  '319': 'Cayman Islands',
  '218': 'Germany', '211': 'Germany',
  '244': 'Netherlands', '245': 'Netherlands', '246': 'Netherlands',
  '235': 'United Kingdom', '232': 'United Kingdom',
  '338': 'United States', '303': 'United States',
  '226': 'France', '227': 'France', '228': 'France',
  '247': 'Italy',
  '220': 'Denmark',
  '230': 'Finland', '231': 'Finland',
  '257': 'Norway', '258': 'Norway', '259': 'Norway',
  '265': 'Sweden', '266': 'Sweden',
  '273': 'Russia',
  '512': 'New Zealand',
  '503': 'Australia',
  '419': 'India',
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
