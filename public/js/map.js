import { createVesselElement, getFlagEmoji, getColorForType } from './vessel-icons.js';

const MAPTILER_KEY = 'CKY69E5ib1MMQDfWMRvg';
const MAP_CENTER = [109.23, 13.76]; // [lng, lat] — MapLibre order
const DEFAULT_ZOOM = 13;
const DEFAULT_PITCH = 0;
const DEFAULT_BEARING = 0;

let map;
let markers = {};       // mmsi → { marker, vessel }
let trackSource = null;
let selectedMmsi = null;
let mapReady = false;
let pendingUpdates = []; // buffer updates until map loads

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
    center: MAP_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    maxPitch: 60,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  map.on('load', () => {
    // Track line source
    map.addSource('vessel-track', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'vessel-track-line',
      type: 'line',
      source: 'vessel-track',
      paint: {
        'line-color': '#3b82f6',
        'line-width': 3,
        'line-opacity': 0.7,
      },
    });

    trackSource = map.getSource('vessel-track');
    mapReady = true;

    // Process any buffered updates
    for (const { vessel, onClick } of pendingUpdates) {
      addOrUpdateMarker(vessel, onClick);
    }
    pendingUpdates = [];
  });

  // Close card on map click (not on marker)
  map.on('click', (e) => {
    if (!e.originalEvent.target.closest('.vessel-marker')) {
      if (selectedMmsi && map._onMapClick) {
        map._onMapClick();
      }
    }
  });

  return map;
}

export function getMap() { return map; }

export function updateVesselMarker(vessel, onClick) {
  if (!mapReady) {
    pendingUpdates.push({ vessel, onClick });
    return;
  }
  addOrUpdateMarker(vessel, onClick);
}

function addOrUpdateMarker(vessel, onClick) {
  const { mmsi, lat, lng } = vessel;
  if (lat == null || lng == null) return;

  if (markers[mmsi]) {
    // Update position — remove old marker, create new one
    markers[mmsi].marker.remove();
  }

  const el = createVesselElement(vessel);
  attachTooltip(el, vessel);

  const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng, lat])
    .addTo(map);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(vessel);
  });

  markers[mmsi] = { marker, vessel };
}

function attachTooltip(el, vessel) {
  const name = vessel.name || vessel.mmsi;
  const flag = getFlagEmoji(vessel.flag_country);
  const typeLabel = vessel.vessel_type_label || '';

  el.addEventListener('mouseenter', () => {
    if (el.querySelector('.vessel-tooltip')) return;
    const tip = document.createElement('div');
    tip.className = 'vessel-tooltip';
    tip.innerHTML = `<span class="tooltip-flag">${flag}</span><span class="tooltip-name">${name}</span>${typeLabel ? `<span class="tooltip-type">${typeLabel}</span>` : ''}`;
    el.appendChild(tip);
  });

  el.addEventListener('mouseleave', () => {
    const tip = el.querySelector('.vessel-tooltip');
    if (tip) tip.remove();
  });
}

export function removeVesselMarker(mmsi) {
  if (markers[mmsi]) {
    markers[mmsi].marker.remove();
    delete markers[mmsi];
  }
}

export function getAllMarkers() { return markers; }

export function showTrack(positions) {
  clearTrack();
  if (!positions || positions.length === 0 || !trackSource) return;

  const coordinates = positions.map(p => [p.lng, p.lat]);

  trackSource.setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
  });
}

export function clearTrack() {
  if (trackSource) {
    trackSource.setData({ type: 'FeatureCollection', features: [] });
  }
}

export function setSelectedMmsi(mmsi) { selectedMmsi = mmsi; }
export function getSelectedMmsi() { return selectedMmsi; }

export function filterMarkersByType(typeLabel) {
  for (const [mmsi, entry] of Object.entries(markers)) {
    const label = entry.vessel.vessel_type_label || 'Other';
    if (typeLabel === 'all' || label === typeLabel) {
      entry.marker.getElement().style.display = '';
    } else {
      entry.marker.getElement().style.display = 'none';
    }
  }
}

export function setMapClickHandler(fn) {
  map._onMapClick = fn;
}
