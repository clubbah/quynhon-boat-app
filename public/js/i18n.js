const translations = {
  en: {
    app_title: 'Quy Nhon Life',
    hero_description: 'Live vessel tracking in Quy Nhon Bay',
    vessels: 'vessels',
    filter_all: 'All Types',
    speed: 'Speed',
    destination: 'Destination',
    status: 'Status',
    type: 'Type',
    flag: 'Flag',
    dimensions: 'Dimensions',
    draught: 'Draught',
    imo: 'IMO',
    mmsi: 'MMSI',
    call_sign: 'Call Sign',
    eta: 'ETA',
    course: 'Course',
    heading: 'Heading',
    updated: 'Last Update',
    knots: 'kn',
    meters: 'm',
    no_data: 'N/A',
    position_section: 'Position',
    voyage_section: 'Voyage',
    physical_section: 'Vessel Details',
    cargo: 'Cargo',
    tanker: 'Tanker',
    passenger: 'Passenger',
    fishing: 'Fishing',
    footer_text: 'Quy Nhon Life \u2014 Real-time AIS vessel data',
    search_placeholder: 'Search vessel name...',
  },
  vi: {
    app_title: 'Quy Nh\u01A1n Life',
    hero_description: 'Theo d\u00F5i t\u00E0u tr\u1EF1c ti\u1EBFp t\u1EA1i V\u1ECBnh Quy Nh\u01A1n',
    vessels: 't\u00E0u',
    filter_all: 'T\u1EA5t C\u1EA3',
    speed: 'T\u1ED1c \u0110\u1ED9',
    destination: '\u0110i\u1EC3m \u0110\u1EBFn',
    status: 'Tr\u1EA1ng Th\u00E1i',
    type: 'Lo\u1EA1i',
    flag: 'Qu\u1ED1c K\u1EF3',
    dimensions: 'K\u00EDch Th\u01B0\u1EDBc',
    draught: 'M\u1EDBn N\u01B0\u1EDBc',
    imo: 'IMO',
    mmsi: 'MMSI',
    call_sign: 'H\u00F4 Hi\u1EC7u',
    eta: 'Gi\u1EDD \u0110\u1EBFn D\u1EF1 Ki\u1EBFn',
    course: 'H\u01B0\u1EDBng \u0110i',
    heading: 'H\u01B0\u1EDBng M\u0169i',
    updated: 'C\u1EADp Nh\u1EADt L\u1EA7n Cu\u1ED1i',
    knots: 'h\u1EA3i l\u00FD/h',
    meters: 'm',
    no_data: 'N/A',
    position_section: 'V\u1ECB Tr\u00ED',
    voyage_section: 'H\u00E0nh Tr\u00ECnh',
    physical_section: 'Chi Ti\u1EBFt T\u00E0u',
    cargo: 'H\u00E0ng',
    tanker: 'D\u1EA7u',
    passenger: 'Kh\u00E1ch',
    fishing: 'C\u00E1',
    footer_text: 'Quy Nh\u01A1n Life \u2014 D\u1EEF li\u1EC7u AIS t\u00E0u th\u1EF1c t\u1EBF',
    search_placeholder: 'T\u00ECm t\u00E0u...',
  },
};

let currentLang = localStorage.getItem('lang') || 'en';

export function t(key) {
  return translations[currentLang][key] || translations['en'][key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
}

export function toggleLang() {
  const next = currentLang === 'en' ? 'vi' : 'en';
  setLang(next);
  return next;
}
