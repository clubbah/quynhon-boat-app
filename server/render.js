/**
 * Server-side page rendering.
 *
 * The four public pages (home, /storms, /trends, /spot) are HTML templates in
 * server/views/. For each request we fill in:
 *   - every data-i18n string in the page's language,
 *   - the live values (weather, vessel counts, sunset, storm status, Port
 *     Pulse, recent activity, trends) from data that is already in memory or
 *     in SQLite,
 *   - per-language <title>, description, canonical, hreflang and Open Graph.
 * The browser scripts then take over and keep the page live, as before.
 *
 * Rules:
 *   - Rendering never waits on Open-Meteo, GDACS or anything else outside the
 *     process. Callers pass what is cached; anything missing keeps the
 *     template's "--" placeholder (for example just after a restart).
 *   - No framework and no HTML parser dependency. The templates are our own,
 *     so a small tag matcher (findClose) is enough. Every data-i18n element is
 *     located by its opening tag and its matching close tag.
 *   - Everything that came from AIS or GDACS is escaped. Only dictionary
 *     strings marked data-i18n-html (sp_calibration, sp_no_match) go in raw.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  translations, LANGUAGES, LOCALES, STATUS_MAP, TYPE_MAP, translate, typeFor, statusFor,
} from '../public/js/i18n-data.js';
import { sunsetForecast, SUNSET_ICONS } from '../public/js/sunset.js';
import { trendsSections } from '../public/js/trends-view.js';
import { PAGES, LANGS, pathFor, urlFor, localizeLinks } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VIEWS_DIR = path.join(__dirname, 'views');
const TZ = 'Asia/Ho_Chi_Minh';
const OG_IMAGE = 'https://quynhonlife.com/img/og-image.png';
const OG_LOCALES = { en: 'en_US', vi: 'vi_VN', ko: 'ko_KR', zh: 'zh_CN', ja: 'ja_JP' };

// ── Small HTML helpers ──

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * Given the index just after an opening <tag ...>, find its matching close
 * tag, counting nested tags of the same name. Returns { innerEnd, closeEnd }
 * or null.
 */
export function findClose(html, from, tag) {
  if (VOID_TAGS.has(tag.toLowerCase())) return null;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) depth--;
    else if (!m[0].endsWith('/>')) depth++;
    if (depth === 0) return { innerEnd: m.index, closeEnd: m.index + m[0].length };
  }
  return null;
}

function findById(html, id) {
  const re = new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\sid="${id}"[^>]*>`);
  const m = re.exec(html);
  if (!m) return null;
  return { tag: m[1], start: m.index, openEnd: m.index + m[0].length, openTag: m[0] };
}

// Replace the inner HTML of the element with this id. No-op if not found.
export function setInner(html, id, inner) {
  const el = findById(html, id);
  if (!el) return html;
  const close = findClose(html, el.openEnd, el.tag);
  if (!close) return html;
  return html.slice(0, el.openEnd) + inner + html.slice(close.innerEnd);
}

// Rewrite the opening tag of the element with this id.
function editOpenTag(html, id, fn) {
  const el = findById(html, id);
  if (!el) return html;
  return html.slice(0, el.start) + fn(el.openTag) + html.slice(el.openEnd);
}

function setAttr(tag, name, value) {
  const v = escapeHtml(value);
  const re = new RegExp(`\\s${name}="[^"]*"`);
  if (re.test(tag)) return tag.replace(re, ` ${name}="${v}"`);
  return tag.replace(/\s*(\/?)>$/, ` ${name}="${v}"$1>`);
}

function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${name}(="[^"]*")?(?=[\\s/>])`), '');
}

function setClass(html, id, cls) {
  return editOpenTag(html, id, (tag) => setAttr(tag, 'class', cls));
}

function unhide(html, id) {
  return editOpenTag(html, id, (tag) => removeAttr(tag, 'hidden'));
}

/**
 * Fill every data-i18n element and data-i18n-* attribute with the page
 * language. data-i18n is escaped text; data-i18n-html is trusted dictionary
 * HTML. Attributes: data-i18n-title, data-i18n-placeholder, data-i18n-aria.
 */
export function applyI18n(html, lang) {
  const re = /<([a-zA-Z][\w-]*)\b[^>]*?\sdata-i18n(-html)?="(\w+)"[^>]*>/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = re.exec(html))) {
    const openEnd = m.index + m[0].length;
    const close = findClose(html, openEnd, m[1]);
    if (!close) continue;
    const value = translate(lang, m[3]);
    out += html.slice(pos, openEnd) + (m[2] ? value : escapeHtml(value));
    pos = close.innerEnd;
    re.lastIndex = close.innerEnd;
  }
  out += html.slice(pos);

  const ATTRS = { title: 'title', placeholder: 'placeholder', aria: 'aria-label' };
  return out.replace(/<[a-zA-Z][^>]*\sdata-i18n-(?:title|placeholder|aria)="[^"]*"[^>]*>/g, (tag) => {
    let result = tag;
    for (const [suffix, attr] of Object.entries(ATTRS)) {
      const km = new RegExp(`\\sdata-i18n-${suffix}="(\\w+)"`).exec(tag);
      if (km) result = setAttr(result, attr, translate(lang, km[1]));
    }
    return result;
  });
}

// ── Head: title, description, canonical, hreflang, Open Graph ──

// A visitor who picked a language earlier and lands on an English address is
// sent to the same page in their language. The server cannot see
// localStorage, so this has to run in the browser, before anything loads.
// Crawlers have no saved language and always get English here.
const LANG_REDIRECT = '<script>(function(){try{var l=localStorage.getItem(\'lang\');'
  + 'if(l&&/^(vi|ko|zh|ja)$/.test(l)){var p=location.pathname;'
  + 'location.replace(\'/\'+l+(p===\'/\'?\'/\':p)+location.search+location.hash);}}catch(e){}})();</script>';

export function headTags(page, lang) {
  const t = (k) => escapeHtml(translate(lang, k));
  const title = t(`meta_${page}_title`);
  const desc = t(`meta_${page}_desc`);
  const url = urlFor(page, lang);
  const lines = [];
  if (lang === 'en') lines.push(LANG_REDIRECT);
  lines.push(
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<link rel="canonical" href="${url}">`,
  );
  for (const l of LANGS) lines.push(`<link rel="alternate" hreflang="${l}" href="${urlFor(page, l)}">`);
  lines.push(
    `<link rel="alternate" hreflang="x-default" href="${urlFor(page, 'en')}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Quy Nhon Life">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${t('og_image_alt')}">`,
    `<meta property="og:locale" content="${OG_LOCALES[lang]}">`,
  );
  for (const l of LANGS) {
    if (l !== lang) lines.push(`<meta property="og:locale:alternate" content="${OG_LOCALES[l]}">`);
  }
  lines.push(
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${OG_IMAGE}">`,
  );
  return lines.map((l) => '  ' + l).join('\n');
}

// Flag switcher as real links to the same page in each language.
export function langSwitcher(page, lang) {
  return LANGUAGES.map((l) => {
    const active = l.code === lang;
    return `<a href="${pathFor(page, l.code)}" hreflang="${l.code}" lang="${l.code}" data-lang="${l.code}" title="${escapeHtml(l.label)}"${active ? ' aria-current="page"' : ''}>`
      + `<img class="lang-flag${active ? ' active' : ''}" src="https://flagcdn.com/24x18/${l.flag}.png" alt="${escapeHtml(l.label)}" width="28" height="20"></a>`;
  }).join('');
}

// ── Formatting ──

const cleanName = (name) => (name ? String(name).replace(/[\s-]*\d{1,3}%\s*$/, '').trim() || name : name);

function flagSrc(code, size) {
  const c = String(code || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(c) ? `https://flagcdn.com/${size}/${c}.png` : '';
}

function countryName(code, lang) {
  if (!code) return '';
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return String(code);
  try { return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(c) || c; } catch { return c; }
}

function fmtTime(date, lang) {
  return new Date(date).toLocaleTimeString(LOCALES[lang], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
}

function fmtDateLong(date, lang) {
  return new Date(date).toLocaleDateString(LOCALES[lang], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ });
}

function windDirection(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}

// Same icons app.js draws into the weather bar.
const ICONS = {
  wind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>',
  humidity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
  waves: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>',
  sunrise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/></svg>',
};

// ── Page fillers. Each takes the filled-in template and returns it updated. ──

function fillWeatherBar(html, lang, weather) {
  const c = weather?.weather?.current;
  if (!c) return html;
  const d = weather.weather.daily;
  const m = weather.marine?.current;
  html = setInner(html, 'weather-temp', escapeHtml(Math.round(c.temperature_2m) + '°C'));
  html = setInner(html, 'weather-wind', `${ICONS.wind} ${escapeHtml(c.wind_speed_10m)} km/h ${windDirection(c.wind_direction_10m)}`);
  html = setInner(html, 'weather-humidity', `${ICONS.humidity} ${escapeHtml(c.relative_humidity_2m)}%`);
  if (m && m.wave_height != null) {
    html = setInner(html, 'weather-waves', `${ICONS.waves} ${Number(m.wave_height).toFixed(1)}m ${escapeHtml(translate(lang, 'waves'))}`);
  }
  const sunrise = d?.sunrise?.[0]?.split('T')[1];
  if (sunrise) html = setInner(html, 'weather-sunrise', `${ICONS.sunrise} ${escapeHtml(sunrise)}`);
  return html;
}

function fillSunset(html, lang, weather, now) {
  const f = sunsetForecast(weather?.weather, now);
  if (!f) return html;
  const t = (k) => translate(lang, k);
  const time = f.when === 'today' ? `${t('sunset_this_evening')} ${f.time}`
    : f.when === 'tomorrow' ? `${t('sunset_tomorrow')} ${f.time}` : f.time;
  html = setInner(html, 'sunset-time', escapeHtml(time));
  html = setInner(html, 'sunset-rating-icon', SUNSET_ICONS[f.level]);
  html = setInner(html, 'sunset-rating', escapeHtml(t('sunset_' + f.level)));
  html = editOpenTag(html, 'sunset-rating', (tag) => setAttr(tag, 'data-level', f.level));
  html = setInner(html, 'sunset-desc', escapeHtml(t('sunset_desc_' + f.level)));
  html = setInner(html, 'sunset-factors', f.factors.map((x) =>
    `<span class="sunset-factor"><span class="sunset-factor-dot ${x.status}"></span>${escapeHtml(t('sunset_f_' + x.key))}</span>`).join(''));
  return html;
}

function vesselLink(v, cls = 'vessel-link') {
  return `<a class="${cls}" data-mmsi="${escapeHtml(v.mmsi)}" href="#">${escapeHtml(cleanName(v.name) || v.mmsi)}</a>`;
}

function fillPortStats(html, lang, stats) {
  if (!stats) return html;
  html = setInner(html, 'ps-total', escapeHtml(stats.total));
  html = setInner(html, 'ps-moving', escapeHtml(stats.moving));
  html = setInner(html, 'ps-anchored', escapeHtml(stats.anchored));

  const v = stats.vesselOfDay;
  if (v) {
    const src = flagSrc(v.flag_country, '20x15');
    const flagImg = src ? `<img src="${src}" alt="" style="border-radius:2px;vertical-align:middle;margin-right:4px" />` : '';
    html = setInner(html, 'votd-name', flagImg + vesselLink(v));
    html = setInner(html, 'votd-details', [
      v.vessel_type_label ? escapeHtml(typeFor(lang, v.vessel_type_label)) : '',
      v.length && v.width ? `${escapeHtml(v.length)} x ${escapeHtml(v.width)}m` : '',
      escapeHtml(countryName(v.flag_country, lang)),
      v.destination ? `→ ${escapeHtml(v.destination)}` : '',
    ].filter(Boolean).join(' · '));
  }

  html = setInner(html, 'activity-tbody', (stats.recentActivity || []).map((r) => {
    const src = flagSrc(r.flag_country, '20x15');
    return `<tr>
        <td class="vessel-name-cell">${vesselLink(r)}</td>
        <td>${escapeHtml(typeFor(lang, r.vessel_type_label))}</td>
        <td class="flag-cell">${src ? `<img src="${src}" alt="" />` : ''}</td>
        <td>${escapeHtml(statusFor(lang, r.nav_status_label, r.speed))}</td>
        <td>${escapeHtml(r.destination || '-')}</td>
        <td class="time-cell">${r.updated_at ? fmtTime(r.updated_at, lang) : ''}</td>
      </tr>`;
  }).join(''));
  return html;
}

function pulseTime(iso, lang, now) {
  const mins = Math.round((now - new Date(iso)) / 60000);
  if (mins < 1) return translate(lang, 'pulse_just_now');
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString(LOCALES[lang], { month: 'short', day: 'numeric', timeZone: TZ });
}

function fillPortPulse(html, lang, pulse, archive, now) {
  if (Array.isArray(pulse) && pulse.length) {
    html = setInner(html, 'pulse-timeline', pulse.map((v) => {
      const src = flagSrc(v.flag_country, '20x15');
      const arrival = v.event === 'arrival';
      return `<div class="pulse-item">
    <span class="pulse-event ${arrival ? 'arrival' : 'departure'}">${escapeHtml(translate(lang, arrival ? 'pulse_arrival' : 'pulse_departure'))}</span>
    <div class="pulse-vessel">
      ${src ? `<img class="pulse-flag" src="${src}" alt="" />` : ''}
      ${vesselLink(v, 'pulse-name vessel-link')}
    </div>
    <span class="pulse-meta">${escapeHtml(v.vessel_type_label ? typeFor(lang, v.vessel_type_label) : '')}</span>
    <span class="pulse-time">${v.timestamp ? escapeHtml(pulseTime(v.timestamp, lang, now)) : ''}</span>
  </div>`;
    }).join(''));
  }
  if (archive && archive.totalUnique > 0) {
    const label = escapeHtml(translate(lang, 'pulse_tracked_total').replace('{n}', archive.totalUnique));
    html = setInner(html, 'pulse-stat', `<a class="pulse-stat-link" href="/trends">${label} &rarr;</a>`);
  }
  return html;
}

function stormCompass(lang, bearing) {
  if (bearing == null) return '';
  const list = translations[lang]?.storm_compass || translations.en.storm_compass;
  return list[Math.round(bearing / 45) % 8] || '';
}

const stormEta = (h) => (h < 48 ? `${h}h` : `${Math.round(h / 24)}d`);

function stormLevel(s) {
  return s && s.active ? (s.threat?.level || 'monitor') : 'none';
}

function fillStormBanner(html, lang, storm, now) {
  const level = stormLevel(storm);
  if (!['warning', 'watch', 'monitor'].includes(level)) return html;
  const t = (k) => translate(lang, k);
  const st = storm.storm || {};
  const th = storm.threat || {};
  const dist = th.currentDistanceKm != null ? th.currentDistanceKm : th.distanceKm;
  const label = level === 'warning' ? 'storm_banner_warning_label'
    : level === 'watch' ? 'storm_banner_watch_label' : 'storm_banner_monitor_label';
  const headline = t('storm_banner_headline')
    .replace('{name}', st.name || t('storm_nav'))
    .replace('{dist}', dist != null ? dist : '?')
    .replace('{dir}', stormCompass(lang, th.currentBearing))
    .replace(/\s{2,}/g, ' ').trim();
  let detail = '';
  if (level === 'monitor') detail = t('storm_banner_monitor_note');
  else if (th.etaHours != null) detail = t('storm_banner_eta').replace('{eta}', stormEta(th.etaHours));
  let fresh = '';
  if (storm.updatedAt) {
    const min = Math.floor(Math.max(0, (now - new Date(storm.updatedAt)) / 60000));
    fresh = min < 1 ? t('storm_banner_updated_now')
      : min < 60 ? t('storm_banner_updated').replace('{n}', min)
        : t('storm_banner_updated_hr').replace('{n}', Math.floor(min / 60));
  }

  html = setInner(html, 'storm-banner-icon', level === 'monitor' ? '🌀' : '⚠️');
  html = setInner(html, 'storm-banner-label', escapeHtml(t(label)));
  html = setInner(html, 'storm-banner-headline', escapeHtml(headline));
  html = setInner(html, 'storm-banner-live-text', escapeHtml(t('storm_banner_live')));
  html = setInner(html, 'storm-banner-fresh', escapeHtml(fresh));
  html = setInner(html, 'storm-banner-detail', escapeHtml(detail));
  html = setInner(html, 'storm-banner-cta', escapeHtml(t('storm_banner_cta')));
  const cls = ['storm-banner', level === 'watch' ? 'watch' : '', level === 'monitor' ? 'monitor' : '', 'show'].filter(Boolean).join(' ');
  return editOpenTag(html, 'storm-banner', (tag) => setAttr(setAttr(tag, 'class', cls), 'aria-hidden', 'false'));
}

function fillStormPage(html, lang, storm, weather) {
  const t = (k) => translate(lang, k);
  if (storm) {
    const level = stormLevel(storm);
    const name = storm.storm?.name || '';
    const STATUS = {
      warning: ['⚠️', 'storm_warning_title', 'storm_warning_desc'],
      watch: ['⚠️', 'storm_watch_title', 'storm_watch_desc'],
      monitor: ['🌀', 'storm_region_title', 'storm_region_desc'],
      none: ['✅', 'storm_clear_title', 'storm_clear_desc'],
    };
    const [icon, titleKey, descKey] = STATUS[level] || STATUS.none;
    html = setClass(html, 'storm-status', 'storm-status ' + level);
    html = setInner(html, 'storm-status-icon', icon);
    html = setInner(html, 'storm-status-title', escapeHtml(t(titleKey).replace('{name}', name)));
    html = setInner(html, 'storm-status-desc', escapeHtml(t(descKey).replace('{name}', name)));

    if (storm.active && storm.storm) {
      const st = storm.storm;
      const th = storm.threat || {};
      const km = (n) => (n == null ? t('no_data') : `${n} km`);
      const alertKey = { Green: 'storm_alert_green', Orange: 'storm_alert_orange', Red: 'storm_alert_red' }[st.alertlevel];
      html = unhide(html, 'storm-meta');
      html = setInner(html, 'sm-category', escapeHtml(st.category || t('no_data')));
      html = setInner(html, 'sm-wind', escapeHtml(st.windKmh != null ? `${st.windKmh} km/h` : t('no_data')));
      html = setInner(html, 'sm-distance', escapeHtml(km(th.currentDistanceKm)));
      html = setInner(html, 'sm-closest', escapeHtml(km(th.distanceKm)));
      html = setInner(html, 'sm-eta', escapeHtml(th.etaHours == null ? t('no_data') : stormEta(th.etaHours)));
      html = setInner(html, 'sm-alert', escapeHtml(alertKey ? t(alertKey) : (st.alertlevel || t('no_data'))));
    }
    if (storm.updatedAt) {
      html = setInner(html, 'storm-updated', escapeHtml(`${t('storm_updated')} ${fmtTime(storm.updatedAt, lang)}`));
    }
  }

  const c = weather?.weather?.current;
  if (c) {
    const parts = [];
    if (c.temperature_2m != null) parts.push(`${Math.round(c.temperature_2m)}°C`);
    if (c.wind_speed_10m != null) parts.push(`${t('storm_local_wind')} ${Math.round(c.wind_speed_10m)} km/h ${windDirection(c.wind_direction_10m)}`);
    if (c.precipitation != null) parts.push(`${t('storm_local_rain')} ${c.precipitation} mm`);
    html = unhide(html, 'storm-local');
    html = setInner(html, 'storm-local-values', escapeHtml(parts.join('  ·  ')));
  }
  return html;
}

function fillTrends(html, lang, trends, now) {
  if (!trends) return html;
  const tr = { lang, t: (k) => translate(lang, k), tType: (l) => typeFor(lang, l) };
  for (const [id, inner] of Object.entries(trendsSections(trends, tr, now))) html = setInner(html, id, inner);
  return html;
}

// The spot page keeps its classic inline script; give it this language's
// strings from the shared dictionary.
function spotI18nScript(lang) {
  const s = {};
  for (const key of Object.keys(translations.en)) {
    if (key.startsWith('sp_')) s[key.slice(3)] = translate(lang, key);
  }
  const statuses = {};
  for (const label of Object.keys(STATUS_MAP)) statuses[label] = statusFor(lang, label);
  const types = {};
  for (const label of Object.keys(TYPE_MAP)) types[label] = typeFor(lang, label);
  const json = JSON.stringify({ lang, s, statuses, types }).replace(/</g, '\\u003c');
  return `<script>window.SPOT_I18N = ${json};</script>`;
}

// ── Templates ──

const templateCache = new Map();
export function loadView(file) {
  if (!templateCache.has(file)) templateCache.set(file, fs.readFileSync(path.join(VIEWS_DIR, file), 'utf8'));
  return templateCache.get(file);
}

/**
 * Render one page in one language from already-gathered data.
 * data: { stats, pulse, archive, weather, storm, trends } (any may be missing)
 * Returns { html, complete } where complete is false if a live value had to
 * fall back to a placeholder.
 */
export function renderPage(page, lang, data = {}, { now = new Date(), template } = {}) {
  let html = template ?? loadView(PAGES[page].view);
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);
  html = applyI18n(html, lang);
  html = setInner(html, 'dateline-date', escapeHtml(fmtDateLong(now, lang)));

  let complete = true;
  if (page === 'home') {
    html = fillWeatherBar(html, lang, data.weather);
    html = fillSunset(html, lang, data.weather, now);
    html = fillPortStats(html, lang, data.stats);
    html = fillPortPulse(html, lang, data.pulse, data.archive, now);
    html = fillStormBanner(html, lang, data.storm, now);
    // The storm banner is simply hidden without data, so it does not count here.
    complete = !!(data.weather?.weather?.current && data.stats);
  } else if (page === 'storms') {
    html = fillStormPage(html, lang, data.storm, data.weather);
    complete = !!(data.storm && data.weather?.weather?.current);
  } else if (page === 'trends') {
    html = fillTrends(html, lang, data.trends, now);
    complete = !!data.trends;
  } else if (page === 'spot') {
    html = html.replace('<!--@spot-i18n-->', spotI18nScript(lang));
  }

  // Links first, so the switcher's English link ("/") is not prefixed.
  html = localizeLinks(html, lang);
  html = html.replace(/ *<!--@head[^>]*-->/, headTags(page, lang));
  html = html.replace('<!--@langs-->', langSwitcher(page, lang));
  return { html, complete };
}

/**
 * Per-language page cache in front of renderPage. `sources` holds functions
 * that return data synchronously from memory or SQLite (never a network call):
 * { stats(), pulse(), archive(), weather(), storm(), trends() }.
 * Complete pages are kept ttlMs; pages with placeholders only briefly, so the
 * real values appear as soon as the caches warm up after a restart.
 */
export function createPageRenderer(sources, { ttlMs = 60 * 1000, incompleteTtlMs = 5 * 1000, now = () => new Date() } = {}) {
  const cache = new Map();
  const NEEDS = {
    home: ['stats', 'pulse', 'archive', 'weather', 'storm'],
    storms: ['storm', 'weather'],
    trends: ['trends'],
    spot: [],
  };

  function gather(page) {
    const data = {};
    for (const key of NEEDS[page]) {
      try {
        data[key] = sources[key]?.();
      } catch (err) {
        console.error(`[Render] ${page}: ${key} failed:`, err.message);
      }
    }
    return data;
  }

  function get(page, lang) {
    const key = `${page}:${lang}`;
    const t = now();
    const hit = cache.get(key);
    if (hit && hit.expires > t.getTime()) return hit.html;

    let result;
    try {
      result = renderPage(page, lang, gather(page), { now: t });
    } catch (err) {
      console.error(`[Render] ${key} failed, serving placeholders:`, err.message);
      result = { ...renderPage(page, lang, {}, { now: t }), complete: false };
    }
    cache.set(key, { html: result.html, expires: t.getTime() + (result.complete ? ttlMs : incompleteTtlMs) });
    return result.html;
  }

  return { get, clear: () => cache.clear() };
}
