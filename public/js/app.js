import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, getAllMarkers } from './map.js';
import { showPanel, hidePanel, initPanel } from './panel.js';
import { t, toggleLang, getLang } from './i18n.js';

// State
let vessels = {}; // mmsi → vessel data

// Init
const map = initMap();
window._map = map; // expose for debugging
initPanel(onPanelClose);
initWebSocket();
initControls();

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
      updateVesselCount();
    }

    if (msg.type === 'update') {
      const v = msg.vessel;
      vessels[v.mmsi] = { ...vessels[v.mmsi], ...v };
      updateVesselMarker(vessels[v.mmsi], onVesselClick);
      updateVesselCount();

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

function updateVesselCount() {
  const count = Object.keys(vessels).length;
  document.getElementById('vessel-count').textContent = `${count} ${t('vessels')}`;
}

function initControls() {
  document.getElementById('lang-toggle').addEventListener('click', () => {
    const next = toggleLang();
    document.getElementById('lang-toggle').textContent = next === 'en' ? 'VI' : 'EN';
    document.getElementById('app-title').textContent = t('app_title');
    document.getElementById('panel-expand-btn').textContent = t('show_details');
    updateVesselCount();

    const filterAll = document.querySelector('#type-filter option[value="all"]');
    if (filterAll) filterAll.textContent = t('filter_all');

    const sel = getSelectedMmsi();
    if (sel && vessels[sel]) {
      showPanel(vessels[sel]);
    }
  });

  document.getElementById('type-filter').addEventListener('change', (e) => {
    filterMarkersByType(e.target.value);
  });
}
