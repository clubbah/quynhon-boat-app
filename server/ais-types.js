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

// MID (Maritime Identification Digits, the first 3 digits of a ship's MMSI) ->
// ISO 3166-1 alpha-2 code. The whole app treats flag_country as a 2-letter code
// (flag image URLs, country-name lookups, trends grouping).
//
// This is the ITU MID allocation as tabulated in AIS-catcher's JSON_MAP_MID
// (Source/JSON/JSONAIS.cpp), which is the same table AIS-catcher uses to fill
// the `country` field it sends us. Deriving the code from the MMSI ourselves
// gives identical results without depending on which field name or format the
// receiver sends (the phone app sends full names such as "Vietnam").
const MID_COUNTRY = {
  201: 'AL', 202: 'AD', 203: 'AT', 204: 'PT', 205: 'BE', 206: 'BY', 207: 'BG', 208: 'VA',
  209: 'CY', 210: 'CY', 211: 'DE', 212: 'CY', 213: 'GE', 214: 'MD', 215: 'MT', 216: 'AM',
  218: 'DE', 219: 'DK', 220: 'DK', 224: 'ES', 225: 'ES', 226: 'FR', 227: 'FR', 228: 'FR',
  229: 'MT', 230: 'FI', 231: 'FO', 232: 'GB', 233: 'GB', 234: 'GB', 235: 'GB', 236: 'GI',
  237: 'GR', 238: 'HR', 239: 'GR', 240: 'GR', 241: 'GR', 242: 'MA', 243: 'HU', 244: 'NL',
  245: 'NL', 246: 'NL', 247: 'IT', 248: 'MT', 249: 'MT', 250: 'IE', 251: 'IS', 252: 'LI',
  253: 'LU', 254: 'MC', 255: 'PT', 256: 'MT', 257: 'NO', 258: 'NO', 259: 'NO', 261: 'PL',
  262: 'ME', 263: 'PT', 264: 'RO', 265: 'SE', 266: 'SE', 267: 'SK', 268: 'SM', 269: 'CH',
  270: 'CZ', 271: 'TR', 272: 'UA', 273: 'RU', 274: 'MK', 275: 'LV', 276: 'EE', 277: 'LT',
  278: 'SI', 279: 'RS', 301: 'AI', 303: 'US', 304: 'AG', 305: 'AG', 306: 'CW', 307: 'AW',
  308: 'BS', 309: 'BS', 310: 'BM', 311: 'BS', 312: 'BZ', 314: 'BB', 316: 'CA', 319: 'KY',
  321: 'CR', 323: 'CU', 325: 'DM', 327: 'DO', 329: 'GP', 330: 'GD', 331: 'GL', 332: 'GT',
  334: 'HN', 336: 'HT', 338: 'US', 339: 'JM', 341: 'KN', 343: 'LC', 345: 'MX', 347: 'MQ',
  348: 'MS', 350: 'NI', 351: 'PA', 352: 'PA', 353: 'PA', 354: 'PA', 355: 'PA', 356: 'PA',
  357: 'PA', 358: 'PR', 359: 'SV', 361: 'PM', 362: 'TT', 364: 'TC', 366: 'US', 367: 'US',
  368: 'US', 369: 'US', 370: 'PA', 371: 'PA', 372: 'PA', 373: 'PA', 374: 'PA', 375: 'VC',
  376: 'VC', 377: 'VC', 378: 'VG', 379: 'VI', 401: 'AF', 403: 'SA', 405: 'BD', 408: 'BH',
  410: 'BT', 412: 'CN', 413: 'CN', 414: 'CN', 416: 'TW', 417: 'LK', 419: 'IN', 422: 'IR',
  423: 'AZ', 425: 'IQ', 428: 'IL', 431: 'JP', 432: 'JP', 434: 'TM', 436: 'KZ', 437: 'UZ',
  438: 'JO', 440: 'KR', 441: 'KR', 443: 'PS', 445: 'KP', 447: 'KW', 450: 'LB', 451: 'KG',
  453: 'MO', 455: 'MV', 457: 'MN', 459: 'NP', 461: 'OM', 463: 'PK', 466: 'QA', 468: 'SY',
  470: 'AE', 471: 'AE', 472: 'TJ', 473: 'YE', 475: 'YE', 477: 'HK', 478: 'BA', 501: 'AQ',
  503: 'AU', 506: 'MM', 508: 'BN', 510: 'FM', 511: 'PW', 512: 'NZ', 514: 'KH', 515: 'KH',
  516: 'CX', 518: 'CK', 520: 'FJ', 523: 'CC', 525: 'ID', 529: 'KI', 531: 'LA', 533: 'MY',
  536: 'MP', 538: 'MH', 540: 'NC', 542: 'NU', 544: 'NR', 546: 'PF', 548: 'PH', 553: 'PG',
  555: 'PN', 557: 'SB', 559: 'AS', 561: 'WS', 563: 'SG', 564: 'SG', 565: 'SG', 566: 'SG',
  567: 'TH', 570: 'TO', 572: 'TV', 574: 'VN', 576: 'VU', 577: 'VU', 578: 'WF', 601: 'ZA',
  603: 'AO', 605: 'DZ', 607: 'TF', 608: 'IO', 609: 'BI', 610: 'BJ', 611: 'BW', 612: 'CF',
  613: 'CM', 615: 'CG', 616: 'KM', 617: 'CV', 618: 'AQ', 619: 'CI', 620: 'KM', 621: 'DJ',
  622: 'EG', 624: 'ET', 625: 'ER', 626: 'GA', 627: 'GH', 629: 'GM', 630: 'GW', 631: 'GQ',
  632: 'GN', 633: 'BF', 634: 'KE', 635: 'AQ', 636: 'LR', 637: 'LR', 642: 'LY', 644: 'LS',
  645: 'MU', 647: 'MG', 649: 'ML', 650: 'MZ', 654: 'MR', 655: 'MW', 656: 'NE', 657: 'NG',
  659: 'NA', 660: 'RE', 661: 'RW', 662: 'SD', 663: 'SN', 664: 'SC', 665: 'SH', 666: 'SO',
  667: 'SL', 668: 'ST', 669: 'SZ', 670: 'TD', 671: 'TG', 672: 'TN', 674: 'TZ', 675: 'UG',
  676: 'CD', 677: 'TZ', 678: 'ZM', 679: 'ZW', 701: 'AR', 710: 'BR', 720: 'BO', 725: 'CL',
  730: 'CO', 735: 'EC', 740: 'FK', 745: 'GF', 750: 'GY', 755: 'PY', 760: 'PE', 765: 'SR',
  770: 'UY', 775: 'VE',
};

// Ship MMSIs are 9 digits starting with 2-7, and the first three are the MID.
// Anything else (SAR aircraft, handhelds, invalid transponders) has no flag.
export function getFlagCountry(mmsi) {
  const s = String(mmsi ?? '');
  if (!/^[2-7]\d{8}$/.test(s)) return null;
  return MID_COUNTRY[s.substring(0, 3)] || null;
}

// Normalise any stored or received country value to a 2-letter code. Prefers
// the MMSI-derived code; falls back to an existing value only if it is already
// a 2-letter code. Names like "Vietnam" are discarded rather than guessed.
export function normalizeFlagCountry(mmsi, existing) {
  const fromMid = getFlagCountry(mmsi);
  if (fromMid) return fromMid;
  const s = String(existing ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
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
