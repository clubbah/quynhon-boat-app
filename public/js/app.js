import { initMap, updateVesselMarker, showTrack, clearTrack, setSelectedMmsi, getSelectedMmsi, filterMarkersByType, setMapClickHandler, flyToVessel, recenterMap, highlightVessel, clearHighlight } from './map.js?v=2';
import { showPanel, hidePanel, initPanel } from './vessel-card.js?v=7';
import { t, getLocale, localPath, bindLangSwitcher, tType, tStatus } from './i18n.js?v=35';
import { sunsetForecast, SUNSET_ICONS } from './sunset.js?v=2';
import { flagSrc, getCountryName } from './vessel-icons.js?v=2';

// State
let vessels = {};
let lastDataTime = 0;
let lastStormData = null;   // latest /api/storms snapshot

// Storm banner preview: /?storm=warning|watch|monitor renders a synthetic storm.
// Declared up here so the boot block's fetchStorms() can read it (it would be in
// the temporal dead zone if left next to the rest of the storm code below).
const STORM_DEMO_LEVEL = (() => {
  const v = new URLSearchParams(location.search).get('storm');
  return ['warning', 'watch', 'monitor'].includes(v) ? v : null;
})();

// Escape AIS-supplied strings before they go into innerHTML. The server strips
// angle brackets, but that's one filter away from an injection hole — escape at
// the sink so safety doesn't depend on an upstream coincidence.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Strip the trailing battery indicator that Vietnamese fishing transponders
// append to their name ("TY 15 D37 15%" -> "TY 15 D37"). The parser cleans new
// data, but rows already in the DB keep the % until they re-report, so we also
// strip at display time.
function cleanName(name) {
  if (!name) return name;
  return String(name).replace(/[\s-]*\d{1,3}%\s*$/, '').trim() || name;
}

// Init
const map = initMap();
initPanel(onPanelClose);
initWebSocket();
initControls();
initSearch();
setMapClickHandler(onPanelClose);

// Live indicator update
setInterval(updateLiveIndicator, 5000);

// Masthead dateline (localized date)
updateDateline();
setInterval(updateDateline, 60 * 60 * 1000); // refresh hourly to catch date rollover

// The page arrives already rendered in its language (from the address), with
// live values filled in by the server. The fetches below keep it current.

// Weather + port stats + port pulse
fetchWeather();
fetchPortStats();
fetchPortPulse();
fetchArchiveStats();
fetchStorms();
setInterval(fetchWeather, 15 * 60 * 1000); // refresh every 15 min
setInterval(fetchPortStats, 60 * 1000);     // refresh every 1 min
setInterval(fetchPortPulse, 5 * 60 * 1000); // refresh every 5 min
setInterval(fetchStorms, 5 * 60 * 1000);    // storm threat check every 5 min
setInterval(tickStormFreshness, 60 * 1000); // tick the banner "updated Xm ago" every min

function initWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    lastDataTime = Date.now();

    if (msg.type === 'snapshot') {
      msg.vessels.forEach((v) => {
        v.name = cleanName(v.name);
        vessels[v.mmsi] = v;
        updateVesselMarker(v, onVesselClick);
      });
      updateStats();
    }

    if (msg.type === 'update') {
      const v = msg.vessel;
      v.name = cleanName(v.name);
      vessels[v.mmsi] = { ...vessels[v.mmsi], ...v };
      updateVesselMarker(vessels[v.mmsi], onVesselClick);
      updateStats();

      if (getSelectedMmsi() === v.mmsi) {
        showPanel(vessels[v.mmsi]);
      }
    }

    if (msg.type === 'arrival') {
      // Real-time arrival — prepend to pulse timeline
      const v = msg.vessel;
      prependPulseItem({
        mmsi: v.mmsi,
        name: cleanName(v.name) || v.mmsi,
        vessel_type_label: v.vessel_type_label,
        flag_country: v.flag_country,
        event: 'arrival',
        timestamp: new Date().toISOString(),
      });
    }

    if (msg.type === 'departure') {
      // A departure is logged 6 hours after the ship was last heard and is
      // stamped with that time, so it belongs further down the timeline.
      // Re-fetch rather than prepend it at the top.
      fetchPortPulse();
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

  // Hide map hint after first click
  const hint = document.getElementById('map-hint');
  if (hint) hint.classList.add('hidden');

  // Highlight selected vessel on map
  highlightVessel(vessel.mmsi);

  // Smooth zoom to vessel
  if (current.lat && current.lng) {
    flyToVessel(current.lng, current.lat);
  }

  try {
    const [trackRes, visitRes] = await Promise.all([
      fetch(`/api/vessels/${vessel.mmsi}/track`),
      fetch(`/api/vessels/${vessel.mmsi}/visits`),
    ]);
    const track = await trackRes.json();
    showTrack(track);

    const visitData = await visitRes.json();
    updateCardHistory(visitData);
  } catch (err) {
    console.error('Failed to load track/visits:', err);
    clearTrack();
  }
}

function onPanelClose() {
  hidePanel();
  clearTrack();
  clearHighlight();
  setSelectedMmsi(null);
}

function updateCardHistory(data) {
  const section = document.getElementById('card-history-section');
  const archive = data?.archive;
  if (!archive) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  document.getElementById('card-section-history').textContent = t('card_history');
  document.getElementById('label-first-seen').textContent = t('card_first_seen');
  document.getElementById('label-visits').textContent = t('card_visit_count');

  const locale = getLocale();
  const firstSeen = archive.first_seen
    ? new Date(archive.first_seen).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })
    : t('no_data');
  document.getElementById('card-first-seen').textContent = firstSeen;
  document.getElementById('card-visits').textContent = archive.visit_count || '1';
}

function updateStats() {
  updateLiveIndicator();
}

function updateLiveIndicator() {
  const el = document.getElementById('stat-live');
  if (!lastDataTime) {
    el.textContent = '';
    return;
  }
  // The receiver posts once a minute, so anything under 90s is a normal gap.
  const ago = Math.round((Date.now() - lastDataTime) / 1000);
  el.className = 'stat-live';
  if (ago < 90) {
    el.innerHTML = `<span class="live-dot"></span> ${t('live_data')}`;
  } else if (ago < 300) {
    el.classList.add('stale-text');
    el.innerHTML = `<span class="live-dot stale"></span> ${t('updated_ago').replace('{n}', ago)}`;
  } else {
    el.classList.add('offline-text');
    const mins = Math.round(ago / 60);
    el.innerHTML = `<span class="live-dot offline"></span> ${t('last_update_ago').replace('{n}', mins)}`;
  }
}

function initControls() {
  // Flag switcher: server-rendered links to the same page in each language.
  bindLangSwitcher();

  // Recenter button
  document.getElementById('map-recenter').addEventListener('click', () => {
    recenterMap();
  });
}

// Localized long date for the masthead dateline (e.g. "Sunday, June 7, 2026")
function updateDateline() {
  const el = document.getElementById('dateline-date');
  if (!el) return;
  const locale = getLocale();
  try {
    el.textContent = new Date().toLocaleDateString(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch (e) {
    el.textContent = new Date().toLocaleDateString();
  }
}

function initSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    if (query.length < 2) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }

    const matches = Object.values(vessels)
      .filter(v => {
        const name = (v.name || '').toLowerCase();
        const mmsi = String(v.mmsi);
        return name.includes(query) || mmsi.includes(query);
      })
      .slice(0, 8);

    if (matches.length === 0) {
      results.classList.add('hidden');
      results.innerHTML = '';
      return;
    }

    results.innerHTML = matches.map(v => {
      const typeLabel = v.vessel_type_label || 'Other';
      return `<div class="search-item" data-mmsi="${esc(v.mmsi)}">
        <span class="search-name">${esc(cleanName(v.name) || v.mmsi)}</span>
        <span class="search-type">${esc(typeLabel)}</span>
      </div>`;
    }).join('');

    results.classList.remove('hidden');

    results.querySelectorAll('.search-item').forEach(item => {
      item.addEventListener('click', () => {
        const mmsi = item.dataset.mmsi;
        const vessel = vessels[mmsi];
        if (vessel) {
          onVesselClick(vessel);
          input.value = '';
          results.classList.add('hidden');
        }
      });
    });
  });

  // Close results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.map-search')) {
      results.classList.add('hidden');
    }
  });

  // Close on Escape
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results.classList.add('hidden');
      input.blur();
    }
  });
}

// WMO weather codes to emoji + description (day / night variants)
const WEATHER_CODES_DAY = {
  0: ['☀️', 'Clear sky'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'],
  3: ['☁️', 'Overcast'], 45: ['🌫️', 'Foggy'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['🌧️', 'Heavy showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm + hail'], 99: ['⛈️', 'Severe storm'],
};

const WEATHER_CODES_NIGHT = {
  0: ['🌙', 'Clear night'], 1: ['🌙', 'Mostly clear'], 2: ['☁️', 'Partly cloudy'],
  3: ['☁️', 'Overcast'], 45: ['🌫️', 'Foggy'], 48: ['🌫️', 'Icy fog'],
  51: ['🌧️', 'Light drizzle'], 53: ['🌧️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  61: ['🌧️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  80: ['🌧️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['🌧️', 'Heavy showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm + hail'], 99: ['⛈️', 'Severe storm'],
};

function windDirection(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

async function fetchWeather() {
  try {
    const res = await fetch('/api/weather');
    const data = await res.json();
    const c = data.weather?.current;
    const d = data.weather?.daily;
    const m = data.marine?.current;
    if (!c) return;

    document.getElementById('weather-temp').textContent = Math.round(c.temperature_2m) + '°C';

    document.getElementById('weather-wind').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg> ${c.wind_speed_10m} km/h ${windDirection(c.wind_direction_10m)}`;

    document.getElementById('weather-humidity').innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg> ${c.relative_humidity_2m}%`;

    if (m && m.wave_height != null) {
      document.getElementById('weather-waves').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg> ${m.wave_height.toFixed(1)}m ${t('waves')}`;
    }

    if (d) {
      const sunrise = d.sunrise?.[0]?.split('T')[1] || '';
      const sunset = d.sunset?.[0]?.split('T')[1] || '';
      document.getElementById('weather-sunrise').innerHTML =
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg> ${sunrise}`;
    }

    // Sunset prediction
    updateSunsetPrediction(data);
  } catch (err) {
    console.error('Weather fetch failed:', err);
  }
}

function updateSunsetPrediction(data) {
  // Hour selection and scoring live in sunset.js, shared with the server render.
  const f = sunsetForecast(data.weather);
  if (!f) return;

  document.getElementById('sunset-time').textContent = f.when === 'today' ? `${t('sunset_this_evening')} ${f.time}`
    : f.when === 'tomorrow' ? `${t('sunset_tomorrow')} ${f.time}` : f.time;
  document.getElementById('sunset-rating-icon').textContent = SUNSET_ICONS[f.level];
  const ratingEl = document.getElementById('sunset-rating');
  ratingEl.textContent = t('sunset_' + f.level);
  ratingEl.dataset.level = f.level;
  document.getElementById('sunset-desc').textContent = t('sunset_desc_' + f.level);

  // Factors come back as { key, status }; translate the key for display.
  document.getElementById('sunset-factors').innerHTML = f.factors.map(x =>
    `<span class="sunset-factor"><span class="sunset-factor-dot ${x.status}"></span>${esc(t('sunset_f_' + x.key))}</span>`
  ).join('');
}

async function fetchPortStats() {
  try {
    const res = await fetch('/api/port-stats');
    const data = await res.json();

    document.getElementById('ps-total').textContent = data.total;
    document.getElementById('ps-moving').textContent = data.moving;
    document.getElementById('ps-anchored').textContent = data.anchored;

    // Vessel of the day
    if (data.vesselOfDay) {
      const v = data.vesselOfDay;
      const src = flagSrc(v.flag_country, '20x15');
      const flagImg = src ? `<img src="${src}" alt="" style="border-radius:2px;vertical-align:middle;margin-right:4px" />` : '';
      const nameEl = document.getElementById('votd-name');
      nameEl.innerHTML = flagImg + `<a class="vessel-link" data-mmsi="${esc(v.mmsi)}" href="#">${esc(cleanName(v.name) || v.mmsi)}</a>`;
      nameEl.querySelector('.vessel-link').addEventListener('click', (e) => {
        e.preventDefault();
        const vessel = vessels[v.mmsi];
        if (vessel) {
          onVesselClick(vessel);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
      document.getElementById('votd-details').innerHTML = [
        v.vessel_type_label ? esc(tType(v.vessel_type_label)) : '',
        v.length && v.width ? `${esc(v.length)} x ${esc(v.width)}m` : '',
        esc(getCountryName(v.flag_country)),
        v.destination ? `→ ${esc(v.destination)}` : '',
      ].filter(Boolean).join(' · ');
    }

    // Recent activity table
    const tbody = document.getElementById('activity-tbody');
    tbody.innerHTML = data.recentActivity.map(v => {
      const src = flagSrc(v.flag_country, '20x15');
      const flagImg = src ? `<img src="${src}" alt="" />` : '';
      const time = v.updated_at ? new Date(v.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      return `<tr>
        <td class="vessel-name-cell"><a class="vessel-link" data-mmsi="${esc(v.mmsi)}" href="#">${esc(cleanName(v.name) || v.mmsi)}</a></td>
        <td>${esc(tType(v.vessel_type_label))}</td>
        <td class="flag-cell">${flagImg}</td>
        <td>${esc(tStatus(v.nav_status_label, v.speed))}</td>
        <td>${esc(v.destination || '-')}</td>
        <td class="time-cell">${time}</td>
      </tr>`;
    }).join('');

    // Make vessel names clickable
    tbody.querySelectorAll('.vessel-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const mmsi = link.dataset.mmsi;
        const vessel = vessels[mmsi];
        if (vessel) {
          onVesselClick(vessel);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  } catch (err) {
    console.error('Port stats fetch failed:', err);
  }
}

// ── Port Pulse ──

async function fetchPortPulse() {
  try {
    const res = await fetch('/api/port-pulse?limit=10');
    const visits = await res.json();
    renderPulseTimeline(visits);
  } catch (err) {
    console.error('Port pulse fetch failed:', err);
  }
}

function renderPulseTimeline(visits) {
  const timeline = document.getElementById('pulse-timeline');
  if (!timeline) return;

  if (!visits || visits.length === 0) {
    // Recreate the empty-state placeholder rather than toggling it: a prior
    // non-empty render replaces the timeline's innerHTML, which deletes the
    // original #pulse-empty node and made the old toggle throw on null.
    timeline.innerHTML = `<div class="pulse-empty" id="pulse-empty" data-i18n="pulse_empty">${t('pulse_empty')}</div>`;
    return;
  }

  timeline.innerHTML = visits.map(v => buildPulseItemHTML(v)).join('');
  bindPulseClicks(timeline);
}

function buildPulseItemHTML(v) {
  const src = flagSrc(v.flag_country, '20x15');
  const flagImg = src ? `<img class="pulse-flag" src="${src}" alt="" />` : '';
  const eventLabel = v.event === 'arrival' ? t('pulse_arrival') : t('pulse_departure');
  const eventClass = v.event === 'arrival' ? 'arrival' : 'departure';
  const typeLabel = v.vessel_type_label ? tType(v.vessel_type_label) : '';
  const time = v.timestamp ? formatPulseTime(v.timestamp) : '';

  return `<div class="pulse-item">
    <span class="pulse-event ${eventClass}">${esc(eventLabel)}</span>
    <div class="pulse-vessel">
      ${flagImg}
      <a class="pulse-name vessel-link" data-mmsi="${esc(v.mmsi)}" href="#">${esc(cleanName(v.name) || v.mmsi)}</a>
    </div>
    <span class="pulse-meta">${esc(typeLabel)}</span>
    <span class="pulse-time">${time}</span>
  </div>`;
}

function prependPulseItem(visit) {
  const timeline = document.getElementById('pulse-timeline');
  const empty = document.getElementById('pulse-empty');
  if (empty) empty.style.display = 'none';

  const temp = document.createElement('div');
  temp.innerHTML = buildPulseItemHTML(visit);
  const item = temp.firstElementChild;

  // Insert at top
  if (timeline.firstChild) {
    timeline.insertBefore(item, timeline.firstChild);
  } else {
    timeline.appendChild(item);
  }

  // Limit to 10 visible items
  while (timeline.querySelectorAll('.pulse-item').length > 10) {
    timeline.removeChild(timeline.lastElementChild);
  }

  bindPulseClicks(timeline);
}

function bindPulseClicks(container) {
  container.querySelectorAll('.vessel-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const mmsi = link.dataset.mmsi;
      const vessel = vessels[mmsi];
      if (vessel) {
        onVesselClick(vessel);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });
}

function formatPulseTime(isoStr) {
  const date = new Date(isoStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins < 1) return t('pulse_just_now');
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Archive Stats ──

async function fetchArchiveStats() {
  try {
    const res = await fetch('/api/archive-stats');
    const stats = await res.json();
    const el = document.getElementById('pulse-stat');
    if (el && stats.totalUnique > 0) {
      const label = esc(t('pulse_tracked_total').replace('{n}', stats.totalUnique));
      el.innerHTML = `<a class="pulse-stat-link" href="${localPath('/trends')}">${label} &rarr;</a>`;
    }
  } catch (err) {
    console.error('Archive stats fetch failed:', err);
  }
}

// ── Storm warning banner ──
// Reads the /api/storms snapshot and shows a live banner whenever a tropical
// cyclone is detected near Quy Nhon: red "warning" and amber "watch" for genuine
// threats, calm "tracking" for a storm in the region that is not heading our way.
// The banner shows the storm's current position, ETA, and a freshness line that
// ticks each minute so it reads as a live, constantly-updating announcement.
// Preview it with no live storm via /?storm=warning (or watch / monitor).

async function fetchStorms() {
  try {
    const url = STORM_DEMO_LEVEL ? `/api/storms?demo=${STORM_DEMO_LEVEL}` : '/api/storms';
    const res = await fetch(url);
    // 503 means the server could not check. That is not "no storms": keep the
    // banner as it is rather than hide it.
    if (!res.ok) throw new Error(`storm data unavailable (HTTP ${res.status})`);
    lastStormData = await res.json();
    renderStormBanner(lastStormData);
  } catch (err) {
    console.error('Storm fetch failed:', err);
  }
}

function renderStormBanner(data) {
  const banner = document.getElementById('storm-banner');
  if (!banner) return;
  const level = data && data.active ? (data.threat?.level || 'monitor') : 'none';

  if (level !== 'warning' && level !== 'watch' && level !== 'monitor') {
    banner.classList.remove('show', 'watch', 'monitor');
    banner.setAttribute('aria-hidden', 'true');
    return;
  }

  const storm = data.storm || {};
  const th = data.threat || {};

  // Tier: icon + label + accent. A near threat warns; a distant storm informs.
  const icon = document.getElementById('storm-banner-icon');
  const labelKey = level === 'warning' ? 'storm_banner_warning_label'
    : level === 'watch' ? 'storm_banner_watch_label'
    : 'storm_banner_monitor_label';
  if (icon) icon.textContent = level === 'monitor' ? '🌀' : '⚠️';
  document.getElementById('storm-banner-label').textContent = t(labelKey);

  // Headline: storm name + where it is right now relative to Quy Nhon.
  const dist = th.currentDistanceKm != null ? th.currentDistanceKm : th.distanceKm;
  const headline = t('storm_banner_headline')
    .replace('{name}', storm.name || t('storm_nav'))
    .replace('{dist}', dist != null ? dist : '?')
    .replace('{dir}', stormCompass(th.currentBearing))
    .replace(/\s{2,}/g, ' ').trim();
  document.getElementById('storm-banner-headline').textContent = headline;

  // Detail: ETA for an approaching storm, reassurance for a distant one.
  let detail = '';
  if (level === 'monitor') {
    detail = t('storm_banner_monitor_note');
  } else if (th.etaHours != null) {
    detail = t('storm_banner_eta').replace('{eta}', stormEtaText(th.etaHours));
  }
  setStormMetaText(detail);
  document.getElementById('storm-banner-live-text').textContent = t('storm_banner_live');
  document.getElementById('storm-banner-cta').textContent = t('storm_banner_cta');

  // In preview mode, carry the demo level through to the /storms page.
  banner.setAttribute('href', localPath('/storms') + (STORM_DEMO_LEVEL ? `?storm=${STORM_DEMO_LEVEL}` : ''));

  banner.classList.remove('watch', 'monitor');
  if (level === 'watch') banner.classList.add('watch');
  if (level === 'monitor') banner.classList.add('monitor');
  banner.classList.add('show');
  banner.setAttribute('aria-hidden', 'false');
}

function setStormMetaText(detail) {
  const freshEl = document.getElementById('storm-banner-fresh');
  const detailEl = document.getElementById('storm-banner-detail');
  // Separators come from CSS (::before middots), so set clean text here.
  if (freshEl) freshEl.textContent = lastStormData ? stormFreshText(lastStormData.updatedAt) : '';
  if (detailEl) detailEl.textContent = detail || '';
}

// Re-stamp the "updated X min ago" line every minute so the banner visibly stays
// live between fetches.
function tickStormFreshness() {
  const banner = document.getElementById('storm-banner');
  if (!banner || !banner.classList.contains('show') || !lastStormData) return;
  const freshEl = document.getElementById('storm-banner-fresh');
  if (freshEl) freshEl.textContent = stormFreshText(lastStormData.updatedAt);
}

function stormCompass(bearing) {
  if (bearing == null) return '';
  const arr = t('storm_compass');
  const list = Array.isArray(arr) ? arr : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return list[Math.round(bearing / 45) % 8] || '';
}

function stormFreshText(updatedAt) {
  if (!updatedAt) return '';
  const min = Math.floor(Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 60000));
  if (min < 1) return t('storm_banner_updated_now');
  if (min < 60) return t('storm_banner_updated').replace('{n}', min);
  return t('storm_banner_updated_hr').replace('{n}', Math.floor(min / 60));
}

function stormEtaText(h) {
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
