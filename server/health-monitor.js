/**
 * Health Monitor
 *
 * Watches the AIS data pipeline. If no vessel updates have arrived in
 * the last STALE_THRESHOLD_MIN minutes, it sends an alert via:
 *   - Email (Resend) if RESEND_API_KEY is set
 *   - Push notification (ntfy.sh) if NTFY_TOPIC is set
 *
 * Tracks alert state in memory so we don't spam alerts every check.
 * Sends a "recovery" notification when data resumes.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CHECK_INTERVAL_MS = 15 * 60 * 1000;         // Check every 15 min
const STALE_THRESHOLD_MIN = 30;                    // Alert if no data for 30 min
const ALERT_REMINDER_HOURS = 24;                   // Re-alert after 24h of continued downtime
const STATE_FILE = path.join(__dirname, '.health-state.json');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'langbroker@gmail.com';
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const SITE_URL = 'https://quynhonlife.com';

// Load persisted state (so restarts don't trigger re-alerts)
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { inAlert: false, lastAlertAt: null, alertCount: 0 };
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[Health] Failed to save state:', err.message);
  }
}

// Health snapshot — uses both DB and live feed stats
//
// We distinguish between two failure modes:
//   1. RELAY DOWN     — no POST to /api/ais-feed at all (antenna laptop issue)
//   2. PARSER STUCK   — POSTs arriving but no vessels being upserted (data format issue)
//
// The relay-side stat (feedStats.lastReceivedAt) is the real signal for the
// "antenna setup" being healthy. The DB updated_at tells us whether vessels
// are flowing through the parser.
export function getHealthSnapshot(db, feedStats = {}) {
  const startTime = process.uptime();
  const now = Date.now();

  // Most recent vessel update (DB)
  const lastUpdateRow = db.prepare(
    'SELECT MAX(updated_at) as last_update FROM vessels'
  ).get();
  const lastUpdate = lastUpdateRow?.last_update || null;

  // Vessel counts
  const totalRow = db.prepare('SELECT COUNT(*) as n FROM vessels').get();
  const total = totalRow?.n || 0;
  const movingRow = db.prepare(
    'SELECT COUNT(*) as n FROM vessels WHERE speed > 0.5'
  ).get();
  const moving = movingRow?.n || 0;

  // Time since last DB update
  const minutesSinceUpdate = lastUpdate
    ? Math.floor((now - new Date(lastUpdate).getTime()) / 60000)
    : null;

  // Time since last relay POST (this is the REAL antenna health signal)
  const minutesSinceFeed = feedStats.lastReceivedAt
    ? Math.floor((now - new Date(feedStats.lastReceivedAt).getTime()) / 60000)
    : null;

  // Determine status based on relay activity first, DB second
  // If the relay is still POSTing, the antenna is fine — even if the parser
  // is filtering everything out (we'd want a different alert for that case).
  let status;
  let statusReason;

  if (minutesSinceFeed == null) {
    // No POST seen since server start
    if (process.uptime() < 600) {
      // Server only just started — give it time
      status = 'degraded';
      statusReason = 'server warming up';
    } else {
      status = 'down';
      statusReason = 'no relay activity since server start';
    }
  } else if (minutesSinceFeed >= STALE_THRESHOLD_MIN) {
    // Relay stopped POSTing
    status = 'down';
    statusReason = `no relay POST for ${minutesSinceFeed} min`;
  } else if (minutesSinceFeed >= 5) {
    // Relay slow but not dead
    status = 'degraded';
    statusReason = `relay slow (last POST ${minutesSinceFeed} min ago)`;
  } else if (total === 0) {
    // Relay pushing but nothing in DB
    status = 'down';
    statusReason = 'relay active but no vessels in DB';
  } else {
    status = 'healthy';
    statusReason = 'relay active, vessels flowing';
  }

  return {
    status,
    status_reason: statusReason,
    timestamp: new Date().toISOString(),
    server_uptime_seconds: Math.floor(startTime),
    vessels: {
      total,
      moving,
      anchored: total - moving,
      last_update: lastUpdate,
      minutes_since_update: minutesSinceUpdate,
    },
    ais_feed: {
      last_received: feedStats.lastReceivedAt || null,
      last_processed: feedStats.lastProcessedAt || null,
      minutes_since_received: minutesSinceFeed,
      total_requests: feedStats.totalRequests || 0,
      total_vessels_processed: feedStats.totalVesselsProcessed || 0,
      stale_threshold_minutes: STALE_THRESHOLD_MIN,
      is_stale: status === 'down',
    },
  };
}

// Send alert via Resend (email)
async function sendEmail(subject, htmlBody) {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Quy Nhon Life <onboarding@resend.dev>',
        to: ALERT_EMAIL,
        subject,
        html: htmlBody,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Health] Resend failed:', res.status, errText);
      return false;
    }
    console.log('[Health] Email sent:', subject);
    return true;
  } catch (err) {
    console.error('[Health] Email error:', err.message);
    return false;
  }
}

// Send alert via ntfy.sh (push notification)
async function sendPush(title, message, priority = 'high') {
  if (!NTFY_TOPIC) return false;
  try {
    const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': 'warning',
        'Click': SITE_URL + '/status',
      },
      body: message,
    });
    if (!res.ok) {
      console.error('[Health] ntfy failed:', res.status);
      return false;
    }
    console.log('[Health] Push sent:', title);
    return true;
  } catch (err) {
    console.error('[Health] Push error:', err.message);
    return false;
  }
}

// Compose alert content
function buildDownAlert(snapshot) {
  const minutes = snapshot.vessels.minutes_since_update;
  const lastUpdate = snapshot.vessels.last_update || 'never';
  const total = snapshot.vessels.total;

  let durationText;
  if (minutes === null) durationText = 'no data ever received';
  else if (minutes < 60) durationText = `${minutes} minutes`;
  else if (minutes < 1440) durationText = `${(minutes / 60).toFixed(1)} hours`;
  else durationText = `${(minutes / 1440).toFixed(1)} days`;

  const subject = `[Quy Nhon Life] AIS feed is DOWN — no data for ${durationText}`;
  const pushTitle = 'Quy Nhon Life AIS Down';
  const pushMessage = `No vessel data for ${durationText}. Total vessels: ${total}. Check antenna laptop.`;

  const html = `
<!DOCTYPE html>
<html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1a2e35;">
  <div style="background: #dc2626; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">AIS Feed is Down</h1>
  </div>
  <div style="padding: 24px; background: #fafafa;">
    <p>No vessel data has been received for <strong>${durationText}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;">Last update:</td><td style="padding: 8px; border-bottom: 1px solid #ddd;"><code>${lastUpdate}</code></td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;">Vessels in DB:</td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${total}</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #ddd;">Server uptime:</td><td style="padding: 8px; border-bottom: 1px solid #ddd;">${Math.floor(snapshot.server_uptime_seconds / 3600)}h</td></tr>
    </table>
    <h3>Troubleshooting checklist:</h3>
    <ol>
      <li>Check the antenna laptop — is the AIS-catcher cmd window still open?</li>
      <li>Check the relay window — is it showing <code>[Relay] N ships</code> messages?</li>
      <li>If both stopped: re-run <code>scripts/start-antenna.bat</code></li>
      <li>If laptop went to sleep: wake it up and restart the .bat</li>
      <li>Verify <a href="${SITE_URL}/status" style="color: #0d9488;">status page</a></li>
    </ol>
    <p style="margin-top: 24px; color: #5a7d87; font-size: 13px;">
      You'll receive a recovery email when data starts flowing again.
    </p>
  </div>
</body></html>`;

  return { subject, pushTitle, pushMessage, html };
}

function buildRecoveryAlert(snapshot, downtimeMinutes) {
  const total = snapshot.vessels.total;
  let durationText;
  if (downtimeMinutes < 60) durationText = `${downtimeMinutes} minutes`;
  else if (downtimeMinutes < 1440) durationText = `${(downtimeMinutes / 60).toFixed(1)} hours`;
  else durationText = `${(downtimeMinutes / 1440).toFixed(1)} days`;

  const subject = `[Quy Nhon Life] AIS feed RESTORED — back online after ${durationText}`;
  const pushTitle = 'Quy Nhon Life AIS Restored';
  const pushMessage = `Data flowing again. ${total} vessels live. Was down ${durationText}.`;

  const html = `
<!DOCTYPE html>
<html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #1a2e35;">
  <div style="background: #16a34a; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">AIS Feed Restored</h1>
  </div>
  <div style="padding: 24px; background: #fafafa;">
    <p>Vessel data is flowing again after <strong>${durationText}</strong> of downtime.</p>
    <p>Currently tracking <strong>${total} vessels</strong>.</p>
    <p><a href="${SITE_URL}" style="color: #0d9488;">View live map</a></p>
  </div>
</body></html>`;

  return { subject, pushTitle, pushMessage, html };
}

// Main check function
async function runHealthCheck(db, feedStats) {
  const snapshot = getHealthSnapshot(db, feedStats);
  const state = loadState();
  const now = Date.now();

  if (snapshot.status === 'down') {
    // Currently down
    const lastAlert = state.lastAlertAt ? new Date(state.lastAlertAt).getTime() : 0;
    const hoursSinceLastAlert = (now - lastAlert) / 3600000;

    // Send alert if: not already in alert state, OR it's been >24h since last reminder
    const shouldAlert = !state.inAlert || hoursSinceLastAlert >= ALERT_REMINDER_HOURS;

    if (shouldAlert) {
      const alert = buildDownAlert(snapshot);
      const emailOk = await sendEmail(alert.subject, alert.html);
      const pushOk = await sendPush(alert.pushTitle, alert.pushMessage);

      saveState({
        inAlert: true,
        lastAlertAt: new Date().toISOString(),
        downSince: state.downSince || new Date().toISOString(),
        alertCount: (state.alertCount || 0) + 1,
        emailDelivered: emailOk,
        pushDelivered: pushOk,
      });

      console.log(`[Health] DOWN alert sent (email=${emailOk}, push=${pushOk})`);
    } else {
      console.log(`[Health] Still down, alert already sent ${hoursSinceLastAlert.toFixed(1)}h ago`);
    }
  } else {
    // Currently healthy
    if (state.inAlert) {
      // Send recovery
      const downSince = state.downSince ? new Date(state.downSince).getTime() : now;
      const downtimeMinutes = Math.floor((now - downSince) / 60000);

      const alert = buildRecoveryAlert(snapshot, downtimeMinutes);
      await sendEmail(alert.subject, alert.html);
      await sendPush(alert.pushTitle, alert.pushMessage, 'default');

      saveState({ inAlert: false, lastAlertAt: null, alertCount: 0 });
      console.log(`[Health] RECOVERY alert sent (downtime: ${downtimeMinutes} min)`);
    } else {
      console.log(`[Health] Healthy: ${snapshot.vessels.total} vessels, relay ${snapshot.ais_feed.minutes_since_received}m ago, DB ${snapshot.vessels.minutes_since_update}m ago`);
    }
  }
}

// Public API
export function startHealthMonitor(db, feedStats) {
  if (!RESEND_API_KEY && !NTFY_TOPIC) {
    console.log('[Health] No alert channels configured (RESEND_API_KEY or NTFY_TOPIC). Status endpoint still active.');
  } else {
    const channels = [];
    if (RESEND_API_KEY) channels.push('email');
    if (NTFY_TOPIC) channels.push('push');
    console.log(`[Health] Monitor started. Channels: ${channels.join(', ')}. Check every ${CHECK_INTERVAL_MS / 60000} min.`);
  }

  // Run first check after 5 min (give server time to receive data on startup)
  setTimeout(() => runHealthCheck(db, feedStats), 5 * 60 * 1000);
  setInterval(() => runHealthCheck(db, feedStats), CHECK_INTERVAL_MS);
}
