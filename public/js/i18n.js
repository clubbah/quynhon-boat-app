const translations = {
  en: {
    app_title: 'Quy Nhon Vessel Tracker',
    vessels: 'vessels',
    filter_all: 'All Types',
    show_details: 'Show Details',
    hide_details: 'Hide Details',
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
  },
  vi: {
    app_title: 'Theo Dõi Tàu Quy Nhơn',
    vessels: 'tàu',
    filter_all: 'Tất Cả',
    show_details: 'Xem Chi Tiết',
    hide_details: 'Ẩn Chi Tiết',
    speed: 'Tốc Độ',
    destination: 'Điểm Đến',
    status: 'Trạng Thái',
    type: 'Loại',
    flag: 'Quốc Kỳ',
    dimensions: 'Kích Thước',
    draught: 'Mớn Nước',
    imo: 'IMO',
    mmsi: 'MMSI',
    call_sign: 'Hô Hiệu',
    eta: 'Giờ Đến Dự Kiến',
    course: 'Hướng Đi',
    heading: 'Hướng Mũi',
    updated: 'Cập Nhật Lần Cuối',
    knots: 'hải lý/h',
    meters: 'm',
    no_data: 'N/A',
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
