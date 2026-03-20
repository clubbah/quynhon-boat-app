// Creates a rotated arrow SVG icon for Leaflet markers
// color: hex color string, heading: degrees (0 = north)
export function createVesselIcon(color, heading = 0) {
  const svg = `
    <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(${heading}, 12, 12)">
        <polygon points="12,2 6,20 12,16 18,20" fill="${color}" stroke="#1e293b" stroke-width="1.5"/>
      </g>
    </svg>
  `;

  return L.divIcon({
    html: svg,
    className: 'vessel-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}
