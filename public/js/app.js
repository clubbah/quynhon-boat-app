import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, setMapClickHandler, flyToVessel, recenterMap } from './map.js';
import { showPanel, hidePanel, initPanel } from './vessel-card.js';
import { t, toggleLang } from './i18n.js';

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
    document.getElementById('app-title').textContent = t('app_title');
    document.getElementById('hero-description').textContent = t('hero_description');
    document.getElementById('footer-text').textContent = t('footer_text');
    document.getElementById('search-input').placeholder = t('search_placeholder');
    updateStats();

    const filterAll = document.querySelector('#type-filter option[value="all"]');
    if (filterAll) filterAll.textContent = t('filter_all');

    const sel = getSelectedMmsi();
    if (sel && vessels[sel]) showPanel(vessels[sel]);
  });

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
