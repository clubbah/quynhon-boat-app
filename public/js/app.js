import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, setMapClickHandler, flyToVessel, recenterMap } from './map.js';
import { showPanel, hidePanel, initPanel } from './vessel-card.js';
import { t, toggleLang, tType, tStatus } from './i18n.js';

// State
let vessels = {};
let lastDataTime = 0;

// Init
const map = initMap();
initPanel(onPanelClose);
initWebSocket();
initControls();
initSearch();
setMapClickHandler(onPanelClose);

// Live indicator update
setInterval(updateLiveIndicator, 5000);

// Weather + port stats
fetchWeather();
fetchPortStats();
setInterval(fetchWeather, 15 * 60 * 1000); // refresh every 15 min
setInterval(fetchPortStats, 60 * 1000);     // refresh every 1 min

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    lastDataTime = Date.now();

    if (msg.type === 'snapshot') {
      msg.vessels.forEach((v) => {
        vessels[v.mmsi] = v;
        updateVesselMarker(v, onVesselClick);
      });
      updateStats();
    }

    if (msg.type === 'update') {
      const v = msg.vessel;
      vessels[v.mmsi] = { ...vessels[v.mmsi], ...v };
      updateVesselMarker(vessels[v.mmsi], onVesselClick);
      updateStats();

      if (getSelectedMmsi() === v.mmsi) {
        showPanel(vessels[v.mmsi]);
      }
    }
  });

  ws.addEventListener('close', () => {
    console.log('WebSocket closed. Reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  });
}

async function onVesselClick(vessel) {
  setSelectedMmsi(vessel.mmsi);
  const current = vessels[vessel.mmsi] || vessel;
  showPanel(current);

  // Smooth zoom to vessel
  if (current.lat && current.lng) {
    flyToVessel(current.lng, current.lat);
  }

  try {
    const res = await fetch(`/api/vessels/${vessel.mmsi}/track`);
    const track = await res.json();
    showTrack(track);
  } catch (err) {
    console.error('Failed to load track:', err);
    clearTrack();
  }
}

function onPanelClose() {
  hidePanel();
  clearTrack();
  setSelectedMmsi(null);
}

function updateStats() {
  const total = Object.keys(vessels).length;
  document.getElementById('stat-total').textContent = `${total} ${t('vessels')}`;
  updateLiveIndicator();
}

function updateLiveIndicator() {
  const el = document.getElementById('stat-live');
  if (!lastDataTime) {
    el.textContent = '';
    return;
  }
  const ago = Math.round((Date.now() - lastDataTime) / 1000);
  el.className = 'stat-live';
  if (ago < 15) {
    el.innerHTML = '<span class="live-dot"></span> Live Data';
  } else if (ago < 60) {
    el.classList.add('stale-text');
    el.innerHTML = `<span class="live-dot stale"></span> Updated ${ago}s ago`;
  } else {
    el.classList.add('offline-text');
    const mins = Math.round(ago / 60);
    el.innerHTML = `<span class="live-dot offline"></span> Last update ${mins}m ago`;
  }
}

function initControls() {
  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = toggleLang();
    document.getElementById('lang-toggle').textContent = next === 'en' ? 'VI' : 'EN';
    translatePage();
  });
}

function translatePage() {
  // Core elements
  document.getElementById('app-title').textContent = t('app_title');
  document.getElementById('hero-description').textContent = t('hero_description');
  document.getElementById('footer-text').textContent = t('footer_text');
  document.getElementById('search-input').placeholder = t('search_placeholder');

  // All data-i18n elements
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  // Filter dropdown options
  const filterOptions = {
    all: 'filter_all', Cargo: 'filter_cargo', Tanker: 'filter_tanker',
    Passenger: 'filter_passenger', Fishing: 'filter_fishing', Other: 'filter_other',
  };
  document.querySelectorAll('#type-filter option').forEach(opt => {
    const key = filterOptions[opt.value];
    if (key) opt.textContent = t(key);
  });

  // Refresh dynamic content
  updateStats();
  fetchPortStats();

  // Update vessel card if open
  const sel = getSelectedMmsi();
  if (sel && vessels[sel]) showPanel(vessels[sel]);

  document.getElementById('type-filter').addEventListener('change', (e) => {
    filterMarkersByType(e.target.value);
  });

  // Recenter button
  document.getElementById('map-recenter').addEventListener('click', () => {
    recenterMap();
  });
}

function initSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }

    const matches = Object.values(vessels)
      .filter(v => {
        const name = (v.name || '').toLowerCase();
        const mmsi = String(v.mmsi);
        return name.includes(query) || mmsi.includes(query);
      })
      .slice(0, 8);

    if (matches.length === 0) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }

    results.innerHTML = matches.map(v => {
      const typeLabel = v.vessel_type_label || 'Other';
      return `<div class="search-item" data-mmsi="${v.mmsi}">
        <span class="search-name">${v.name || v.mmsi}</span>
        <span class="search-type">${typeLabel}</span>
      </div>`;
    }).join('');

    results.classList.remove('hidden');

    results.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const mmsi = item.dataset.mmsi;
        const vessel = vessels[mmsi];
        if (vessel) {
          onVesselClick(vessel);
          input.value = '';
          results.classList.add('hidden');
        }
      });
    });
  });

  // Close results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-search')) {
      results.classList.add('hidden');
    }
  });

  // Close on Escape
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results.classList.add('hidden');
      input.blur();
    }
  });
}

// WMO weather codes to emoji + description
const WEATHER_CODES = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'],
  3: ['☁️', 'Overcast'], 45: ['🌫️', 'Foggy'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['🌧️', 'Heavy showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm + hail'], 99: ['⛈️', 'Severe storm'],
};

function windDirection(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

async function fetchWeather() {
  try {
    const res = await fetch('/api/weather');
    const data = await res.json();
    const c = data.weather?.current;
    const d = data.weather?.daily;
    const m = data.marine?.current;
    if (!c) return;

    const [icon, desc] = WEATHER_CODES[c.weather_code] || ['🌡️', ''];
    document.getElementById('weather-icon').textContent = icon;
    document.getElementById('weather-temp').textContent = Math.round(c.temperature_2m) + '°C';
    document.getElementById('weather-desc').textContent = desc;

    document.getElementById('weather-wind').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg> ${c.wind_speed_10m} km/h ${windDirection(c.wind_direction_10m)}`;

    document.getElementById('weather-humidity').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg> ${c.relative_humidity_2m}%`;

    if (m && m.wave_height != null) {
      document.getElementById('weather-waves').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg> ${m.wave_height.toFixed(1)}m waves`;
    }

    if (d) {
      const sunrise = d.sunrise?.[0]?.split('T')[1] || '';
      const sunset = d.sunset?.[0]?.split('T')[1] || '';
      document.getElementById('weather-sunrise').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg> ${sunrise}`;
      document.getElementById('weather-sunset').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg> ${sunset}`;
    }
  } catch (err) {
    console.error('Weather fetch failed:', err);
  }
}

async function fetchPortStats() {
  try {
    const res = await fetch('/api/port-stats');
    const data = await res.json();

    document.getElementById('ps-total').textContent = data.total;
    document.getElementById('ps-moving').textContent = data.moving;
    document.getElementById('ps-anchored').textContent = data.anchored;
    document.getElementById('ps-recent').textContent = data.recentCount;

    // Vessel of the day
    if (data.vesselOfDay) {
      const v = data.vesselOfDay;
      const cc = (v.flag_country || '').toLowerCase();
      const flagImg = cc ? `<img src="https://flagcdn.com/20x15/${cc}.png" style="border-radius:2px;vertical-align:middle;margin-right:4px" />` : '';
      document.getElementById('votd-name').innerHTML = flagImg + (v.name || v.mmsi);
      document.getElementById('votd-details').innerHTML = [
        v.vessel_type_label || '',
        v.length && v.width ? `${v.length} x ${v.width}m` : '',
        v.flag_country || '',
        v.destination ? `→ ${v.destination}` : '',
      ].filter(Boolean).join(' · ');
    }

    // Recent activity table
    const tbody = document.getElementById('activity-tbody');
    tbody.innerHTML = data.recentActivity.map(v => {
      const cc = (v.flag_country || '').toLowerCase();
      const flagImg = cc ? `<img src="https://flagcdn.com/20x15/${cc}.png" />` : '';
      const time = v.updated_at ? new Date(v.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<tr>
        <td class="vessel-name-cell">${v.name || v.mmsi}</td>
        <td>${tType(v.vessel_type_label)}</td>
        <td class="flag-cell">${flagImg}</td>
        <td>${tStatus(v.nav_status_label, v.speed)}</td>
        <td>${v.destination || '-'}</td>
        <td class="time-cell">${time}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Port stats fetch failed:', err);
  }
}
