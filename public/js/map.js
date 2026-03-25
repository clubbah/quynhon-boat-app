import { getFlagEmoji, getColorForType } from './vessel-icons.js';

const MAPTILER_KEY = 'CKY69E5ib1MMQDfWMRvg';
const MAP_CENTER = [109.23, 13.76];
const DEFAULT_ZOOM = 13;

let map;
let vesselData = {};    // mmsi → vessel
let trackSource = null;
let selectedMmsi = null;
let mapReady = false;
let pendingUpdates = [];
let onVesselClickFn = null;

// Ship icon SVGs as data URLs for the map
const SHIP_ICONS = {};
const ICON_COLORS = {
  cargo: '#2563eb',
  tanker: '#dc2626',
  passenger: '#16a34a',
  fishing: '#ca8a04',
  other: '#6b7280',
};

function createShipIconUrl(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">
    <path d="M12,1 L17,7 L17,26 L16,30 L8,30 L7,26 L7,7 Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`,
    center: MAP_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: 0,
    bearing: 0,
    attributionControl: false,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

  map.on('load', () => {
    // Load ship icons for each type
    const iconPromises = Object.entries(ICON_COLORS).map(([type, color]) => {
      return new Promise((resolve) => {
        const img = new Image(24, 32);
        img.onload = () => {
          map.addImage(`ship-${type}`, img);
          resolve();
        };
        img.src = createShipIconUrl(color);
      });
    });

    Promise.all(iconPromises).then(() => {
      // Vessel source
      map.addSource('vessels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Vessel layer — icons rotate with heading
      map.addLayer({
        id: 'vessel-icons',
        type: 'symbol',
        source: 'vessels',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['get', 'length'],
            0, 0.7,
            50, 0.85,
            150, 1.1,
            300, 1.4
          ],
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

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

      // Process buffered updates
      for (const { vessel } of pendingUpdates) {
        vesselData[vessel.mmsi] = vessel;
      }
      pendingUpdates = [];
      refreshVesselSource();
    });

    // Click on vessel
    map.on('click', 'vessel-icons', (e) => {
      if (e.features && e.features[0] && onVesselClickFn) {
        const mmsi = e.features[0].properties.mmsi;
        const vessel = vesselData[mmsi];
        if (vessel) onVesselClickFn(vessel);
      }
    });

    // Hover cursor
    map.on('mouseenter', 'vessel-icons', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'vessel-icons', () => {
      map.getCanvas().style.cursor = '';
    });

    // Tooltip popup on hover
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'vessel-popup',
    });

    map.on('mouseenter', 'vessel-icons', (e) => {
      if (!e.features || !e.features[0]) return;
      const props = e.features[0].properties;
      const flag = getFlagEmoji(props.flag_country);
      const name = props.name || props.mmsi;
      const typeLabel = props.vessel_type_label || '';
      popup.setLngLat(e.lngLat)
        .setHTML(`<span style="margin-right:4px">${flag}</span><strong>${name}</strong>${typeLabel ? ` <span style="color:#64748b;font-size:12px">${typeLabel}</span>` : ''}`)
        .addTo(map);
    });

    map.on('mouseleave', 'vessel-icons', () => {
      popup.remove();
    });

    // Click on map (not vessel) to close card
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['vessel-icons'] });
      if (features.length === 0 && map._onMapClick) {
        map._onMapClick();
      }
    });
  });

  return map;
}

export function getMap() { return map; }

function getIconType(typeLabel) {
  const label = (typeLabel || '').toLowerCase();
  if (label.includes('cargo') || label.includes('container')) return 'ship-cargo';
  if (label.includes('tanker')) return 'ship-tanker';
  if (label.includes('passenger')) return 'ship-passenger';
  if (label.includes('fishing')) return 'ship-fishing';
  return 'ship-other';
}

function refreshVesselSource() {
  if (!mapReady) return;
  const source = map.getSource('vessels');
  if (!source) return;

  const features = Object.values(vesselData)
    .filter(v => v.lat != null && v.lng != null)
    .map(v => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: {
        mmsi: v.mmsi,
        name: v.name || '',
        flag_country: v.flag_country || '',
        vessel_type_label: v.vessel_type_label || 'Other',
        icon: getIconType(v.vessel_type_label),
        heading: v.heading ?? v.course ?? 0,
        speed: v.speed ?? 0,
        length: v.length ?? 0,
      },
    }));

  source.setData({ type: 'FeatureCollection', features });
}

export function updateVesselMarker(vessel, onClick) {
  if (!onVesselClickFn) onVesselClickFn = onClick;

  if (!mapReady) {
    pendingUpdates.push({ vessel });
    return;
  }

  vesselData[vessel.mmsi] = vessel;
  refreshVesselSource();
}

export function removeVesselMarker(mmsi) {
  delete vesselData[mmsi];
  refreshVesselSource();
}

export function getAllMarkers() { return vesselData; }

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
  if (!mapReady) return;
  if (typeLabel === 'all') {
    map.setFilter('vessel-icons', null);
  } else {
    map.setFilter('vessel-icons', ['==', ['get', 'vessel_type_label'], typeLabel]);
  }
}

export function setMapClickHandler(fn) {
  map._onMapClick = fn;
}
