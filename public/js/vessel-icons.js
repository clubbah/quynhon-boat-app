const SHIP_PATHS = {
  Cargo: 'M16,2 L20,8 L20,28 L19,32 L13,32 L12,28 L12,8 Z',
  Tanker: 'M16,2 L21,9 L21,28 L19,32 L13,32 L11,28 L11,9 Z',
  Passenger: 'M16,3 L20,8 L20,14 L22,14 L22,26 L20,30 L12,30 L10,26 L10,14 L12,14 L12,8 Z',
  Fishing: 'M16,4 L18,10 L18,26 L17,30 L15,30 L14,26 L14,10 Z',
  Other: 'M16,3 L19,9 L19,27 L18,31 L14,31 L13,27 L13,9 Z',
};

const TYPE_COLORS = {
  Cargo: '#2563eb',
  Tanker: '#dc2626',
  Passenger: '#16a34a',
  Fishing: '#ca8a04',
};
const DEFAULT_COLOR = '#6b7280';

const COUNTRY_FLAGS = {
  VN: '\u{1F1FB}\u{1F1F3}', Vietnam: '\u{1F1FB}\u{1F1F3}',
  CN: '\u{1F1E8}\u{1F1F3}', China: '\u{1F1E8}\u{1F1F3}',
  TW: '\u{1F1F9}\u{1F1FC}', Taiwan: '\u{1F1F9}\u{1F1FC}',
  JP: '\u{1F1EF}\u{1F1F5}', Japan: '\u{1F1EF}\u{1F1F5}',
  KR: '\u{1F1F0}\u{1F1F7}', 'South Korea': '\u{1F1F0}\u{1F1F7}',
  SG: '\u{1F1F8}\u{1F1EC}', Singapore: '\u{1F1F8}\u{1F1EC}',
  ID: '\u{1F1EE}\u{1F1E9}', Indonesia: '\u{1F1EE}\u{1F1E9}',
  PH: '\u{1F1F5}\u{1F1ED}', Philippines: '\u{1F1F5}\u{1F1ED}',
  MY: '\u{1F1F2}\u{1F1FE}', Malaysia: '\u{1F1F2}\u{1F1FE}',
  TH: '\u{1F1F9}\u{1F1ED}', Thailand: '\u{1F1F9}\u{1F1ED}',
  PA: '\u{1F1F5}\u{1F1E6}', Panama: '\u{1F1F5}\u{1F1E6}',
  LR: '\u{1F1F1}\u{1F1F7}', Liberia: '\u{1F1F1}\u{1F1F7}',
  MH: '\u{1F1F2}\u{1F1ED}', 'Marshall Islands': '\u{1F1F2}\u{1F1ED}',
  MT: '\u{1F1F2}\u{1F1F9}', Malta: '\u{1F1F2}\u{1F1F9}',
  BS: '\u{1F1E7}\u{1F1F8}', Bahamas: '\u{1F1E7}\u{1F1F8}',
  HK: '\u{1F1ED}\u{1F1F0}', 'Hong Kong': '\u{1F1ED}\u{1F1F0}',
  US: '\u{1F1FA}\u{1F1F8}', 'United States': '\u{1F1FA}\u{1F1F8}',
  GB: '\u{1F1EC}\u{1F1E7}', 'United Kingdom': '\u{1F1EC}\u{1F1E7}',
  DE: '\u{1F1E9}\u{1F1EA}', Germany: '\u{1F1E9}\u{1F1EA}',
  NL: '\u{1F1F3}\u{1F1F1}', Netherlands: '\u{1F1F3}\u{1F1F1}',
  FR: '\u{1F1EB}\u{1F1F7}', France: '\u{1F1EB}\u{1F1F7}',
  NO: '\u{1F1F3}\u{1F1F4}', Norway: '\u{1F1F3}\u{1F1F4}',
  DK: '\u{1F1E9}\u{1F1F0}', Denmark: '\u{1F1E9}\u{1F1F0}',
  RU: '\u{1F1F7}\u{1F1FA}', Russia: '\u{1F1F7}\u{1F1FA}',
  IN: '\u{1F1EE}\u{1F1F3}', India: '\u{1F1EE}\u{1F1F3}',
  AU: '\u{1F1E6}\u{1F1FA}', Australia: '\u{1F1E6}\u{1F1FA}',
};

const COUNTRY_NAMES = {
  VN: 'Vietnam', CN: 'China', TW: 'Taiwan', JP: 'Japan', KR: 'South Korea',
  SG: 'Singapore', ID: 'Indonesia', PH: 'Philippines', MY: 'Malaysia', TH: 'Thailand',
  PA: 'Panama', LR: 'Liberia', MH: 'Marshall Islands', MT: 'Malta', BS: 'Bahamas',
  HK: 'Hong Kong', US: 'United States', GB: 'United Kingdom', DE: 'Germany',
  NL: 'Netherlands', FR: 'France', NO: 'Norway', DK: 'Denmark', RU: 'Russia',
  IN: 'India', AU: 'Australia', KH: 'Cambodia', MM: 'Myanmar', LA: 'Laos',
  BD: 'Bangladesh', LK: 'Sri Lanka', AE: 'UAE', SA: 'Saudi Arabia',
  GR: 'Greece', IT: 'Italy', ES: 'Spain', TR: 'Turkey', BR: 'Brazil',
  CY: 'Cyprus', BZ: 'Belize', AG: 'Antigua', KN: 'St Kitts', VC: 'St Vincent',
  TO: 'Tonga', WS: 'Samoa', PW: 'Palau', FJ: 'Fiji', NZ: 'New Zealand',
};

export function getFlagEmoji(country) {
  if (!country) return '\u{1F6A2}';
  return COUNTRY_FLAGS[country] || '\u{1F6A2}';
}

export function getCountryName(code) {
  if (!code) return '';
  return COUNTRY_NAMES[code] || code;
}

export function getColorForType(typeLabel) {
  return TYPE_COLORS[typeLabel] || DEFAULT_COLOR;
}

function getSizeForLength(length) {
  if (!length || length <= 0) return { w: 24, h: 30 };
  if (length < 50) return { w: 20, h: 26 };
  if (length <= 150) return { w: 28, h: 36 };
  return { w: 34, h: 42 };
}

function getShipPath(typeLabel) {
  return SHIP_PATHS[typeLabel] || SHIP_PATHS.Other;
}

export function createVesselElement(vessel) {
  const typeLabel = vessel.vessel_type_label || 'Other';
  const color = getColorForType(typeLabel);
  const heading = vessel.heading ?? vessel.course ?? 0;
  const size = getSizeForLength(vessel.length);
  const isMoving = vessel.speed != null && vessel.speed > 0.5;
  const path = getShipPath(typeLabel);

  const el = document.createElement('div');
  el.className = 'vessel-marker' + (isMoving ? ' vessel-moving' : '');
  el.style.width = size.w + 'px';
  el.style.height = size.h + 'px';

  el.innerHTML = `<svg viewBox="0 0 32 34" width="${size.w}" height="${size.h}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${heading}, 16, 17)">
      <path d="${path}" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
    </g>
  </svg>`;

  return el;
}
