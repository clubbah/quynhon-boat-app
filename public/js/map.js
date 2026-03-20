import { createVesselIcon } from './vessel-icons.js';
import { t } from './i18n.js';

const QUY_NHON_CENTER = [13.76, 109.23];
const DEFAULT_ZOOM = 12;

let map;
let markers = {};       // mmsi → L.marker
let currentTrack = null; // L.polyline
let selectedMmsi = null;

export function initMap() {
  map = L.map('map').setView(QUY_NHON_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(map);
  return map;
}

export function getMap() {
  return map;
}

export function updateVesselMarker(vessel, onClick) {
  const { mmsi, lat, lng, heading, vessel_type, vessel_type_label, name } = vessel;
  if (lat == null || lng == null) return;

  const color = getColorForType(vessel_type_label || vessel_type);
  const icon = createVesselIcon(color, heading || 0);

  if (markers[mmsi]) {
    markers[mmsi].setLatLng([lat, lng]);
    markers[mmsi].setIcon(icon);
    markers[mmsi]._vesselData = vessel;
  } else {
    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .bindTooltip(name || mmsi, { direction: 'top', offset: [0, -12] });
    marker._vesselData = vessel;
    marker.on('click', () => onClick(vessel));
    markers[mmsi] = marker;
  }
}

export function removeVesselMarker(mmsi) {
  if (markers[mmsi]) {
    map.removeLayer(markers[mmsi]);
    delete markers[mmsi];
  }
}

export function getAllMarkers() {
  return markers;
}

export function showTrack(positions) {
  clearTrack();
  if (!positions || positions.length === 0) return;

  const latlngs = positions.map(p => [p.lat, p.lng]);

  const totalPoints = latlngs.length;
  const segments = [];
  for (let i = 1; i < totalPoints; i++) {
    const opacity = 0.2 + (0.8 * i / totalPoints);
    segments.push(
      L.polyline([latlngs[i - 1], latlngs[i]], {
        color: '#3b82f6',
        weight: 3,
        opacity,
      })
    );
  }

  currentTrack = L.layerGroup(segments).addTo(map);
}

export function clearTrack() {
  if (currentTrack) {
    map.removeLayer(currentTrack);
    currentTrack = null;
  }
}

export function setSelectedMmsi(mmsi) {
  selectedMmsi = mmsi;
}

export function getSelectedMmsi() {
  return selectedMmsi;
}

function getColorForType(typeOrCode) {
  const typeColors = {
    'Cargo': '#2563eb',
    'Tanker': '#dc2626',
    'Passenger': '#16a34a',
    'Fishing': '#ca8a04',
  };
  if (typeof typeOrCode === 'string') return typeColors[typeOrCode] || '#6b7280';
  if (typeOrCode >= 70 && typeOrCode <= 79) return '#2563eb';
  if (typeOrCode >= 80 && typeOrCode <= 89) return '#dc2626';
  if (typeOrCode >= 60 && typeOrCode <= 69) return '#16a34a';
  if (typeOrCode === 30) return '#ca8a04';
  return '#6b7280';
}

export function filterMarkersByType(typeLabel) {
  for (const [mmsi, marker] of Object.entries(markers)) {
    const data = marker._vesselData;
    if (typeLabel === 'all') {
      marker.addTo(map);
    } else {
      const label = data.vessel_type_label || 'Other';
      if (label === typeLabel) {
        marker.addTo(map);
      } else {
        map.removeLayer(marker);
      }
    }
  }
}
