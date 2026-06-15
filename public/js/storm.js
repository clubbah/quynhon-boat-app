import { t, setLang, getLang, getLanguages } from './i18n.js';

// Storm tracker page. Its own MapLibre instance, separate from the home map:
// a light, low-detail basemap framed at regional scale so an approaching storm
// is legible from genesis (out near the Philippines) to Quy Nhon.

const MAPTILER_KEY = 'CKY69E5ib1MMQDfWMRvg';
const STORM_STYLE = `https://api.maptiler.com/maps/dataviz/style.json?key=${MAPTILER_KEY}`;
const QUY_NHON = [109.22, 13.77]; // [lng, lat]
const BASIN_VIEW = { center: [118, 15], zoom: 4.2 }; // South China Sea + W. Pacific

let map;
let mapReady = false;
let lastSnapshot = null;
let qnMarker = null;
let stormMarker = null;

const radar = { host: '', frames: [], idx: 0, timer: null, playing: true };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Boot ──
buildLangSwitcher();
updateDateline();
setInterval(updateDateline, 60 * 60 * 1000);
initStormMap();
fetchStorms();
setInterval(fetchStorms, 15 * 60 * 1000);
fetchLocal();
if (getLang() !== 'en') translatePage();

// ── Language + dateline (mirrors app.js) ──
function buildLangSwitcher() {
  const switcher = document.getElementById('lang-switcher');
  const current = getLang();
  switcher.innerHTML = getLanguages().map((l) =>
    `<img class="lang-flag${l.code === current ? ' active' : ''}" src="https://flagcdn.com/24x18/${l.flag}.png" alt="${l.label}" title="${l.label}" data-lang="${l.code}" />`
  ).join('');
  switcher.addEventListener('click', (e) => {
    const flag = e.target.closest('.lang-flag');
    if (!flag) return;
    setLang(flag.dataset.lang);
    switcher.querySelectorAll('.lang-flag').forEach((f) => f.classList.remove('active'));
    flag.classList.add('active');
    translatePage();
  });
}

function updateDateline() {
  const el = document.getElementById('dateline-date');
  if (!el) return;
  const localeMap = { en: 'en-US', vi: 'vi-VN', ko: 'ko-KR', zh: 'zh-CN', ja: 'ja-JP' };
  const locale = localeMap[getLang()] || 'en-US';
  try {
    el.textContent = new Date().toLocaleDateString(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch (e) {
    el.textContent = new Date().toLocaleDateString();
  }
}

function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  const footer = document.getElementById('footer-text');
  if (footer) footer.textContent = t('footer_text');
  updateDateline();
  // Re-render dynamic content last so it overrides any static data-i18n defaults.
  if (lastSnapshot) render(lastSnapshot);
  renderLocal(localWeather);
}

// ── Map ──
function initStormMap() {
  map = new maplibregl.Map({
    container: 'storm-map',
    style: STORM_STYLE,
    center: BASIN_VIEW.center,
    zoom: BASIN_VIEW.zoom,
    attributionControl: false,
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  map.on('load', () => {
    // Wind impact zone (cone) — added first so it sits under the track lines.
    map.addSource('storm-cone', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'storm-cone-fill',
      type: 'fill',
      source: 'storm-cone',
      paint: {
        'fill-color': ['match', ['get', 'sev'], 'red', '#dc2626', 'orange', '#ea580c', 'green', '#0d9488', '#dc2626'],
        'fill-opacity': 0.12,
      },
    });
    map.addLayer({
      id: 'storm-cone-outline',
      type: 'line',
      source: 'storm-cone',
      paint: {
        'line-color': ['match', ['get', 'sev'], 'red', '#dc2626', 'orange', '#ea580c', 'green', '#0d9488', '#dc2626'],
        'line-width': 1,
        'line-opacity': 0.25,
      },
    });

    // Past track (solid grey) and forecast track (dashed red).
    map.addSource('storm-past', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'storm-past-line',
      type: 'line',
      source: 'storm-past',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#475569', 'line-width': 3, 'line-opacity': 0.85 },
    });
    map.addSource('storm-forecast', { type: 'geojson', data: emptyFC() });
    map.addLayer({
      id: 'storm-forecast-line',
      type: 'line',
      source: 'storm-forecast',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#dc2626', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 1.6] },
    });

    // Rain radar tiles slot beneath the storm vectors.
    addRadarLayer();

    mapReady = true;
    ensureQnMarker();
    if (lastSnapshot) render(lastSnapshot);
  });

  initMapControls();
}

function initMapControls() {
  document.getElementById('storm-focus').addEventListener('click', () => {
    map.flyTo({ center: QUY_NHON, zoom: 8, duration: 800 });
  });
  document.getElementById('storm-fit').addEventListener('click', () => {
    if (lastSnapshot && lastSnapshot.active && lastSnapshot.storm) fitToStorm(lastSnapshot.storm);
    else map.flyTo({ center: BASIN_VIEW.center, zoom: BASIN_VIEW.zoom, duration: 800 });
  });
  document.getElementById('radar-toggle').addEventListener('click', toggleRadar);
}

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function ensureQnMarker() {
  if (qnMarker || !map) return;
  const el = document.createElement('div');
  el.className = 'storm-qn-marker';
  el.innerHTML = '<span class="storm-qn-dot"></span><span class="storm-qn-label">Quy Nhơn</span>';
  qnMarker = new maplibregl.Marker({ element: el, anchor: 'left' }).setLngLat(QUY_NHON).addTo(map);
}

function setStormMarker(storm) {
  if (!storm.current) return;
  const lngLat = [storm.current.lng, storm.current.lat];
  if (!stormMarker) {
    const el = document.createElement('div');
    el.className = 'storm-center-marker';
    el.innerHTML = '<span class="storm-center-icon">🌀</span><span class="storm-center-label"></span>';
    // setLngLat must precede addTo — addTo reads the position immediately.
    stormMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
  } else {
    stormMarker.setLngLat(lngLat);
  }
  const el = stormMarker.getElement();
  el.dataset.alert = (storm.alertlevel || 'green').toLowerCase();
  el.querySelector('.storm-center-label').textContent = storm.name || '';
}

function clearStormMarker() {
  if (stormMarker) { stormMarker.remove(); stormMarker = null; }
}

function fitToStorm(storm) {
  const b = new maplibregl.LngLatBounds();
  b.extend(QUY_NHON);
  if (storm.bbox) { b.extend([storm.bbox[0], storm.bbox[1]]); b.extend([storm.bbox[2], storm.bbox[3]]); }
  if (storm.current) b.extend([storm.current.lng, storm.current.lat]);
  map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 60, right: 60 }, maxZoom: 7, duration: 900 });
}

function renderMap(s) {
  if (!mapReady) return;
  ensureQnMarker();
  if (s.active && s.storm) {
    map.getSource('storm-cone').setData(s.storm.cone || emptyFC());
    map.getSource('storm-past').setData(s.storm.pastTrack || emptyFC());
    map.getSource('storm-forecast').setData(s.storm.forecastTrack || emptyFC());
    setStormMarker(s.storm);
    fitToStorm(s.storm);
  } else {
    map.getSource('storm-cone').setData(emptyFC());
    map.getSource('storm-past').setData(emptyFC());
    map.getSource('storm-forecast').setData(emptyFC());
    clearStormMarker();
    map.flyTo({ center: BASIN_VIEW.center, zoom: BASIN_VIEW.zoom, duration: 800 });
  }
}

// ── RainViewer radar ──
async function addRadarLayer() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    radar.host = data.host;
    radar.frames = [...(data.radar?.past || []), ...(data.radar?.nowcast || [])];
    if (!radar.frames.length) return;
    const past = data.radar?.past || [];
    radar.idx = past.length ? past.length - 1 : 0; // start at "now"
    map.addSource('radar', { type: 'raster', tiles: [frameUrl(radar.frames[radar.idx])], tileSize: 256 });
    map.addLayer({ id: 'radar-layer', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.55 } }, 'storm-cone-fill');
    startRadar();
  } catch (err) {
    console.warn('[Storm] radar load failed:', err.message);
  }
}

function frameUrl(frame) {
  // {host}{path}/{size}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png — color 2, smoothed.
  return `${radar.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

function showRadarFrame(i) {
  radar.idx = i;
  const src = map.getSource('radar');
  if (src && src.setTiles) src.setTiles([frameUrl(radar.frames[i])]);
  updateRadarLabel();
}

function startRadar() {
  stopRadar();
  radar.playing = true;
  radar.timer = setInterval(() => showRadarFrame((radar.idx + 1) % radar.frames.length), 800);
  updateRadarLabel();
}

function stopRadar() {
  if (radar.timer) { clearInterval(radar.timer); radar.timer = null; }
}

function toggleRadar() {
  const btn = document.getElementById('radar-toggle');
  const layer = map.getLayer && map.getLayer('radar-layer');
  if (radar.playing) {
    stopRadar();
    radar.playing = false;
    if (layer) map.setLayoutProperty('radar-layer', 'visibility', 'none');
    btn.setAttribute('aria-pressed', 'false');
    btn.classList.remove('active');
    const label = document.getElementById('storm-radar-label');
    if (label) label.hidden = true;
  } else {
    if (layer) map.setLayoutProperty('radar-layer', 'visibility', 'visible');
    radar.playing = true;
    btn.setAttribute('aria-pressed', 'true');
    btn.classList.add('active');
    startRadar();
  }
}

function updateRadarLabel() {
  const label = document.getElementById('storm-radar-label');
  if (!label || !radar.frames.length) return;
  const frame = radar.frames[radar.idx];
  if (!frame || !frame.time) { label.hidden = true; return; }
  const d = new Date(frame.time * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  label.hidden = false;
  label.textContent = `${t('storm_radar')} · ${hh}:${mm}`;
}

// ── Data ──
async function fetchStorms() {
  try {
    const res = await fetch('/api/storms');
    const data = await res.json();
    render(data);
  } catch (err) {
    console.error('[Storm] fetch failed:', err);
  }
}

function render(s) {
  lastSnapshot = s;
  renderStatus(s);
  renderMeta(s);
  renderMap(s);
  renderUpdated(s);
}

function renderStatus(s) {
  const box = document.getElementById('storm-status');
  const iconEl = document.getElementById('storm-status-icon');
  const titleEl = document.getElementById('storm-status-title');
  const descEl = document.getElementById('storm-status-desc');
  const level = (s && s.active) ? (s.threat?.level || 'monitor') : 'none';
  const name = s && s.storm ? s.storm.name : '';

  box.className = 'storm-status ' + level;
  if (level === 'warning') {
    iconEl.textContent = '⚠️';
    titleEl.textContent = t('storm_warning_title').replace('{name}', name);
    descEl.textContent = t('storm_warning_desc').replace('{name}', name);
  } else if (level === 'watch') {
    iconEl.textContent = '⚠️';
    titleEl.textContent = t('storm_watch_title').replace('{name}', name);
    descEl.textContent = t('storm_watch_desc').replace('{name}', name);
  } else if (level === 'monitor') {
    iconEl.textContent = '🌀';
    titleEl.textContent = t('storm_region_title').replace('{name}', name);
    descEl.textContent = t('storm_region_desc').replace('{name}', name);
  } else {
    iconEl.textContent = '✅';
    titleEl.textContent = t('storm_clear_title');
    descEl.textContent = t('storm_clear_desc');
  }
}

function renderMeta(s) {
  const meta = document.getElementById('storm-meta');
  if (!s || !s.active || !s.storm) { meta.hidden = true; return; }
  meta.hidden = false;
  const st = s.storm;
  const th = s.threat || {};
  setText('sm-category', st.category || t('no_data'));
  setText('sm-wind', st.windKmh != null ? `${st.windKmh} km/h` : t('no_data'));
  setText('sm-distance', kmText(th.currentDistanceKm));
  setText('sm-closest', kmText(th.distanceKm));
  setText('sm-eta', etaText(th.etaHours));
  setText('sm-alert', alertLabel(st.alertlevel));
}

function renderUpdated(s) {
  const el = document.getElementById('storm-updated');
  if (!el || !s || !s.updatedAt) { if (el) el.textContent = ''; return; }
  const d = new Date(s.updatedAt);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  el.textContent = `${t('storm_updated')} ${hh}:${mm}`;
}

// ── Local conditions (Open-Meteo, same endpoint the home page uses) ──
let localWeather = null;
async function fetchLocal() {
  try {
    const res = await fetch('/api/weather');
    localWeather = await res.json();
    renderLocal(localWeather);
  } catch (err) {
    console.warn('[Storm] local weather failed:', err.message);
  }
}

function renderLocal(data) {
  const wrap = document.getElementById('storm-local');
  const vals = document.getElementById('storm-local-values');
  const c = data && data.weather && data.weather.current;
  if (!c) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const parts = [];
  if (c.temperature_2m != null) parts.push(`${Math.round(c.temperature_2m)}°C`);
  if (c.wind_speed_10m != null) parts.push(`${t('storm_local_wind')} ${Math.round(c.wind_speed_10m)} km/h ${windDir(c.wind_direction_10m)}`);
  if (c.precipitation != null) parts.push(`${t('storm_local_rain')} ${c.precipitation} mm`);
  vals.textContent = parts.join('  ·  ');
}

function windDir(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

// ── helpers ──
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function kmText(n) { return n == null ? t('no_data') : `${n} km`; }
function etaText(h) {
  if (h == null) return t('no_data');
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
function alertLabel(level) {
  const k = { Green: 'storm_alert_green', Orange: 'storm_alert_orange', Red: 'storm_alert_red' }[level];
  return k ? t(k) : (level || t('no_data'));
}
