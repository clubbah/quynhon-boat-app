import { getFlagEmoji, getColorForType, getCountryName } from './vessel-icons.js';

const MAPTILER_KEY = 'CKY69E5ib1MMQDfWMRvg';
const MAP_CENTER = [109.22, 13.77]; // Quy Nhon port area
const DEFAULT_ZOOM = window.innerWidth < 768 ? 11.5 : 13;

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

// Top-down ship SVG paths — different hull shapes per type
const SHIP_SVGS = {
  // Cargo: wide rectangular hull, squared stern, bridge block near back
  cargo: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="36" viewBox="0 0 20 36">
    <path d="M10,1 L14,5 L15,8 L15,28 L14,32 L6,32 L5,28 L5,8 L6,5 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="7" y="24" width="6" height="4" rx="0.5" fill="white" opacity="0.35"/>
    <line x1="7" y1="14" x2="13" y2="14" stroke="white" opacity="0.2" stroke-width="0.8"/>
    <line x1="7" y1="18" x2="13" y2="18" stroke="white" opacity="0.2" stroke-width="0.8"/>
  </svg>`,

  // Tanker: rounded wide hull, pipeline detail
  tanker: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="36" viewBox="0 0 22 36">
    <path d="M11,1 L15,5 L16,9 L16,28 L15,32 L7,32 L6,28 L6,9 L7,5 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="11" cy="13" r="2.5" fill="white" opacity="0.2"/>
    <circle cx="11" cy="20" r="2.5" fill="white" opacity="0.2"/>
    <rect x="8" y="26" width="6" height="3" rx="0.5" fill="white" opacity="0.35"/>
  </svg>`,

  // Passenger: multi-deck, wider body, rounded
  passenger: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="36" viewBox="0 0 20 36">
    <path d="M10,1 L14,4 L15,8 L15,30 L13,33 L7,33 L5,30 L5,8 L6,4 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="6.5" y="9" width="7" height="2" rx="0.5" fill="white" opacity="0.3"/>
    <rect x="6.5" y="13" width="7" height="2" rx="0.5" fill="white" opacity="0.3"/>
    <rect x="6.5" y="17" width="7" height="2" rx="0.5" fill="white" opacity="0.3"/>
    <rect x="7.5" y="27" width="5" height="3" rx="0.5" fill="white" opacity="0.35"/>
  </svg>`,

  // Fishing: small narrow hull, mast line
  fishing: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="32" viewBox="0 0 16 32">
    <path d="M8,1 L11,5 L12,9 L12,24 L11,28 L5,28 L4,24 L4,9 L5,5 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <line x1="8" y1="3" x2="8" y2="12" stroke="white" opacity="0.4" stroke-width="0.8"/>
    <line x1="5" y1="8" x2="11" y2="8" stroke="white" opacity="0.25" stroke-width="0.6"/>
    <rect x="6" y="22" width="4" height="3" rx="0.5" fill="white" opacity="0.35"/>
  </svg>`,

  // Other: generic simple hull
  other: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="32" viewBox="0 0 18 32">
    <path d="M9,1 L13,6 L13,26 L12,30 L6,30 L5,26 L5,6 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>
    <rect x="6.5" y="23" width="5" height="3" rx="0.5" fill="white" opacity="0.35"/>
  </svg>`,
};

function createShipIconUrl(type, color) {
  const svgFn = SHIP_SVGS[type] || SHIP_SVGS.other;
  const svg = svgFn(color);
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
    // Load ship icons for each type — each has unique hull shape
    const sizes = { cargo: [20,36], tanker: [22,36], passenger: [20,36], fishing: [16,32], other: [18,32] };
    const iconPromises = Object.entries(ICON_COLORS).map(([type, color]) => {
      return new Promise((resolve) => {
        const [w, h] = sizes[type] || [18, 32];
        const img = new Image(w, h);
        img.onload = () => {
          map.addImage(`ship-${type}`, img);
          resolve();
        };
        img.src = createShipIconUrl(type, color);
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

    // Tooltip popup on hover — use mousemove to update between adjacent vessels
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
      className: 'vessel-popup',
    });
    let hoveredMmsi = null;

    function buildTooltipHtml(props) {
      const countryCode = (props.flag_country || '').toLowerCase();
      const countryName = getCountryName(props.flag_country);
      const name = props.name || props.mmsi;
      const typeLabel = props.vessel_type_label || '';
      const typeColor = ICON_COLORS[typeLabel.toLowerCase()] || ICON_COLORS.other;
      const flagImg = countryCode
        ? `<img class="vt-flag" src="https://flagcdn.com/24x18/${countryCode}.png" alt="${countryCode}" />`
        : '<span class="vt-flag">\u{1F6A2}</span>';

      return `<div class="vt-row1">
        ${flagImg}
        <span class="vt-name">${name}</span>
      </div>
      <div class="vt-row2">
        ${countryName ? `<span class="vt-country">${countryName}</span>` : ''}
        ${countryName && typeLabel ? '<span class="vt-sep">&middot;</span>' : ''}
        ${typeLabel ? `<span class="vt-type"><span class="vt-dot" style="background:${typeColor}"></span>${typeLabel}</span>` : ''}
      </div>`;
    }

    map.on('mousemove', 'vessel-icons', (e) => {
      if (!e.features || !e.features[0]) return;
      const props = e.features[0].properties;
      if (props.mmsi !== hoveredMmsi) {
        hoveredMmsi = props.mmsi;
        popup.setLngLat(e.lngLat).setHTML(buildTooltipHtml(props)).addTo(map);
      }
    });

    map.on('mouseleave', 'vessel-icons', () => {
      hoveredMmsi = null;
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

export function flyToVessel(lng, lat) {
  if (!map) return;
  map.flyTo({ center: [lng, lat], zoom: 15, duration: 1000 });
}

export function recenterMap() {
  if (!map) return;
  map.flyTo({ center: MAP_CENTER, zoom: DEFAULT_ZOOM, duration: 800 });
}
