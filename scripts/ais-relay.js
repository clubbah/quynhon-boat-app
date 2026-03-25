/**
 * AIS Relay Script
 * Fetches from AIS-catcher and pushes to vessel tracker.
 * Strips receiver-specific fields (signal strength, location, etc.)
 */

const AIS_CATCHER_URL = 'http://localhost:8100/api/ships.json';
const REMOTE_URL = 'https://quynhonlife.com/api/ais-feed/9b63b8fc0e7d17224a6749c6456b8469';
const INTERVAL_MS = 5000;

// Fields to remove — these expose receiver info
const STRIP_FIELDS = [
  'level', 'ppm', 'distance', 'bearing', 'count',
  'group_mask', 'approx', 'validated', 'msg_type',
  'channels', 'mmsi_type', 'shipclass',
];

function cleanShip(ship) {
  const clean = { ...ship };
  for (const field of STRIP_FIELDS) {
    delete clean[field];
  }
  return clean;
}

async function fetchAndRelay() {
  try {
    const res = await fetch(AIS_CATCHER_URL);
    if (!res.ok) {
      console.error(`[Relay] AIS-catcher returned ${res.status}`);
      return;
    }

    const data = await res.json();
    const ships = (data.ships || []).map(cleanShip);
    if (ships.length === 0) {
      console.log('[Relay] No ships');
      return;
    }

    const pushRes = await fetch(REMOTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ships),
    });

    const text = await pushRes.text();
    try {
      const result = JSON.parse(text);
      console.log(`[Relay] ${ships.length} ships -> ${result.processed || 0} processed`);
    } catch {
      console.error(`[Relay] Server returned (${pushRes.status}): ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error('[Relay] Error:', err.message);
  }
}

console.log('[Relay] AIS data relay started');
console.log(`[Relay] Pushing every ${INTERVAL_MS / 1000}s`);
console.log('');

fetchAndRelay();
setInterval(fetchAndRelay, INTERVAL_MS);
