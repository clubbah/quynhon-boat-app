import WebSocket from 'ws';
import { getVesselTypeLabel, getNavStatusLabel, getFlagCountry } from './ais-types.js';

// Quy Nhon region (matches the RTL-SDR feed's bounding box). Used only when
// aisstream.io is activated as a failover for the primary antenna feed.
const BOUNDING_BOXES = [
  [[11.5, 107.0], [16.0, 111.5]],
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

// Returns a handle with stop(). Auto-reconnects on drop UNTIL stop() is called,
// so the failover manager can cleanly deactivate it when the primary recovers.
export function connectAisStream(apiKey, onMessage, boundingBoxes = BOUNDING_BOXES) {
  let stopped = false;
  let ws = null;

  function open() {
    if (stopped) return;
    ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    ws.on('open', () => {
      console.log('[AIS] Connected to aisstream.io (failover)');
      ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: boundingBoxes }));
    });

    ws.on('message', (data) => {
      try {
        const parsed = parseAisMessage(JSON.parse(data.toString()));
        if (parsed) onMessage(parsed);
      } catch (err) {
        console.error('[AIS] Parse error:', err.message);
      }
    });

    ws.on('close', () => {
      if (stopped) return;
      console.log('[AIS] aisstream disconnected. Reconnecting in 5s...');
      setTimeout(open, 5000);
    });

    ws.on('error', (err) => {
      console.error('[AIS] aisstream error:', err.message);
    });
  }

  open();

  return {
    stop() {
      stopped = true;
      if (ws) { try { ws.close(); } catch { /* already closed */ } }
    },
  };
}
