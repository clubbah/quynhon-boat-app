import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, setMapClickHandler } from './map.js';
import { showPanel, hidePanel, initPanel } from './vessel-card.js';
import { t, toggleLang } from './i18n.js';

// State
let vessels = {};

// Init
const map = initMap();
initPanel(onPanelClose);
initWebSocket();
initControls();
setMapClickHandler(onPanelClose);

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);

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
  const all = Object.values(vessels);
  const total = all.length;

  document.getElementById('stat-total').textContent = `${total} ${t('vessels')}`;

  const counts = { Cargo: 0, Tanker: 0, Passenger: 0, Fishing: 0 };
  for (const v of all) {
    const label = v.vessel_type_label || 'Other';
    if (counts[label] !== undefined) counts[label]++;
  }

  document.getElementById('stat-cargo').textContent = counts.Cargo ? `${counts.Cargo} ${t('cargo')}` : '';
  document.getElementById('stat-tanker').textContent = counts.Tanker ? `${counts.Tanker} ${t('tanker')}` : '';
  document.getElementById('stat-passenger').textContent = counts.Passenger ? `${counts.Passenger} ${t('passenger')}` : '';
  document.getElementById('stat-fishing').textContent = counts.Fishing ? `${counts.Fishing} ${t('fishing')}` : '';
}

function initControls() {
  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = toggleLang();
    document.getElementById('lang-toggle').textContent = next === 'en' ? 'VI' : 'EN';
    document.getElementById('app-title').textContent = t('app_title');
    document.getElementById('hero-description').textContent = t('hero_description');
    document.getElementById('footer-text').textContent = t('footer_text');
    updateStats();

    const filterAll = document.querySelector('#type-filter option[value="all"]');
    if (filterAll) filterAll.textContent = t('filter_all');

    const sel = getSelectedMmsi();
    if (sel && vessels[sel]) showPanel(vessels[sel]);
  });

  document.getElementById('type-filter').addEventListener('change', (e) => {
    filterMarkersByType(e.target.value);
  });
}
