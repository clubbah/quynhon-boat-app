import WebSocket from 'ws';
import { getVesselTypeLabel, getVesselTypeColor, getNavStatusLabel, getFlagCountry } from './ais-types.js';

// Multiple bounding boxes: Quy Nhon area + Singapore Strait (known high coverage)
// aisstream.io lacks terrestrial AIS stations in Vietnam, so we include
// nearby high-traffic areas to demonstrate the app with real data.
// TODO: Replace with Quy Nhon-only box once local AIS coverage is available
//       (e.g., via RTL-SDR receiver feeding data to the network)
const BOUNDING_BOXES = [
  [[13.5, 109.0], [14.0, 109.5]],   // Quy Nhon area
  [[1.0, 103.5], [1.5, 104.2]],     // Singapore Strait (high coverage)
];

export function parseAisMessage(raw) {
  const meta = raw.MetaData;
  const mmsi = String(meta.MMSI);
  const name = (meta.ShipName || '').trim() || null;
  const timestamp = meta.time_utc;
  const flag_country = getFlagCountry(mmsi);

  if (raw.MessageType === 'PositionReport') {
    const pos = raw.Message.PositionReport;
    return {
      type: 'position',
      mmsi,
      name,
      flag_country,
      lat: pos.Latitude,
      lng: pos.Longitude,
      speed: pos.Sog,
      course: pos.Cog,
      heading: pos.TrueHeading,
      nav_status: pos.NavigationalStatus,
      nav_status_label: getNavStatusLabel(pos.NavigationalStatus),
      updated_at: timestamp,
    };
  }

  if (raw.MessageType === 'ShipStaticData') {
    const data = raw.Message.ShipStaticData;
    const dim = data.Dimension || {};
    const eta = data.Eta;
    let etaStr = null;
    if (eta && eta.Month && eta.Day) {
      etaStr = `${String(eta.Month).padStart(2, '0')}-${String(eta.Day).padStart(2, '0')} ${String(eta.Hour || 0).padStart(2, '0')}:${String(eta.Minute || 0).padStart(2, '0')}`;
    }

    return {
      type: 'static',
      mmsi,
      name,
      flag_country,
      imo: data.ImoNumber ? String(data.ImoNumber) : null,
      call_sign: data.CallSign || null,
      vessel_type: data.Type,
      vessel_type_label: getVesselTypeLabel(data.Type),
      length: (dim.A || 0) + (dim.B || 0) || null,
      width: (dim.C || 0) + (dim.D || 0) || null,
      draught: data.MaximumStaticDraught || null,
      destination: data.Destination || null,
      eta: etaStr,
      updated_at: timestamp,
    };
  }

  return null;
}

export function connectAisStream(apiKey, onMessage) {
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  ws.on('open', () => {
    console.log('[AIS] Connected to aisstream.io');
    ws.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: BOUNDING_BOXES,
    }));
  });

  ws.on('message', (data) => {
    try {
      const raw = JSON.parse(data.toString());
      const parsed = parseAisMessage(raw);
      if (parsed) onMessage(parsed);
    } catch (err) {
      console.error('[AIS] Parse error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[AIS] Disconnected. Reconnecting in 5s...');
    setTimeout(() => connectAisStream(apiKey, onMessage), 5000);
  });

  ws.on('error', (err) => {
    console.error('[AIS] WebSocket error:', err.message);
  });

  return ws;
}
